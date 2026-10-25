import {fittingLocation} from './cooperation.service';
import {model, models, Schema} from 'mongoose';
import Joi = require('joi');
import {parseDateOnly, formatDateOnly} from '../utils/date-only';

export interface FittingSettings {enabled:boolean; address:string; weekly:Array<{day:number; enabled:boolean; start:string; end:string}>; blockedDates:string[];}
export const defaultFittingSettings = (): FittingSettings => ({enabled:false,address:'',weekly:Array.from({length:7},(_,day)=>({day,enabled:false,start:'09:00',end:'17:00'})),blockedDates:[]});
const schema = new Schema({_id:String, enabled:Boolean,address:String,weekly:[{_id:false,day:Number,enabled:Boolean,start:String,end:String}],blockedDates:[String]}, {collection:'v2_fitting_settings',timestamps:true,strict:'throw'});
export const FittingSettingsModel = models.FittingSettings ?? model('FittingSettings',schema);
const clock = Joi.string().pattern(/^(?:[01]\d|2[0-3]):(?:00|30)$/).required();
const validator = Joi.object({enabled:Joi.boolean().strict().required(),address:Joi.string().trim().max(500).allow('').required(),weekly:Joi.array().length(7).items(Joi.object({day:Joi.number().integer().min(0).max(6).required(),enabled:Joi.boolean().strict().required(),start:clock,end:clock}).unknown(false)).required(),blockedDates:Joi.array().max(366).unique().items(Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)).required()}).unknown(false);
export function parseFittingSettings(body:unknown): FittingSettings | null {
  const {value,error}=validator.validate(body,{convert:false});if(error)return null;
  const v=value as FittingSettings;
  if(new Set(v.weekly.map(d=>d.day)).size!==7 || v.weekly.some(d=>d.start>=d.end))return null;
  try{v.blockedDates.forEach(parseDateOnly);}catch{return null;}
  if(v.enabled&&(!v.address.trim()||!v.weekly.some(d=>d.enabled)))return null;
  return {...v,address:v.address.trim(),weekly:[...v.weekly].sort((a,b)=>a.day-b.day)};
}
export async function getFittingSettings():Promise<FittingSettings>{
 const doc=await FittingSettingsModel.findById('fittings').lean().exec() as any;
 return {...(doc?{enabled:doc.enabled,address:doc.address,weekly:doc.weekly,blockedDates:doc.blockedDates}:defaultFittingSettings()), address:(await fittingLocation()).address};
}
export async function saveFittingSettings(settings:FittingSettings){
 await FittingSettingsModel.updateOne({_id:'fittings'},{$set:settings},{upsert:true,runValidators:true}).exec();return settings;
}
const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function pragueDate(now=new Date()){return formatter.format(now).slice(0,10);}
export function fittingSlots(date:string,settings:FittingSettings,now=new Date()):Array<{time:string;startAt:Date}>{
 const midnight=parseDateOnly(date),today=pragueDate(now);
 if(date<today||date>formatDateOnly(new Date(parseDateOnly(today).getTime()+90*86400000))||!settings.enabled||settings.blockedDates.includes(date))return [];
 const day=settings.weekly.find(d=>d.day===midnight.getUTCDay());if(!day?.enabled)return [];
 // Enumerate instants: nonexistent and duplicated local clocks at DST changes are not bookable.
 const times=new Map<string,Date[]>();
 for(let ms=midnight.getTime()-3*3600000;ms<midnight.getTime()+26*3600000;ms+=1800000){
  const instant=new Date(ms),local=formatter.format(instant),time=local.slice(11,16);
  if(local.slice(0,10)===date)times.set(time,[...(times.get(time)||[]),instant]);
 }
 return [...times].filter(([time,values])=>values.length===1&&time>=day.start&&time<day.end&&values[0].getTime()>=now.getTime()+2*3600000)
 .map(([time,values])=>({time,startAt:values[0]})).sort((a,b)=>a.time.localeCompare(b.time));
}
