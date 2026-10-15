import {createHash,randomUUID} from 'crypto';
import {Types} from 'mongoose';
import Joi = require('joi');
import {FittingModel} from '../models/fitting.model';
import {ProductV2Model} from '../models/product-v2.model';
import {ReservationV2Model} from '../models/reservation-v2.model';
import {BOOKING_POLICY} from './booking-policy';
import {getFittingSettings,fittingSlots} from './fitting-settings.service';
import {paymentSummary,recordPayment} from './payment.service';
import {parseDateOnly} from '../utils/date-only';
export class FittingError extends Error{constructor(public code:string,public status=409){super(code);}}
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const createSchema=Joi.object({operationId:Joi.string().guid({version:['uuidv4']}).required(),token:Joi.string().pattern(/^[a-f0-9]{64}$/).required(),date:Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),time:Joi.string().pattern(/^(?:[01]\d|2[0-3]):(?:00|30)$/).required(),name:Joi.string().trim().min(2).max(160).required(),email:Joi.string().email({tlds:{allow:false}}).max(254).required(),phone:Joi.string().trim().pattern(/^\+?[\d ()-]{5,32}$/).required(),productId:Joi.string().hex().length(24)}).unknown(false);
export function parseFittingCreate(body:unknown){const {value,error}=createSchema.validate(body);if(error)throw new FittingError('VALIDATION_ERROR',400);try{parseDateOnly(value.date);}catch{throw new FittingError('VALIDATION_ERROR',400);}return {...value,email:value.email.toLowerCase().trim(),operationId:value.operationId.toLowerCase()} as {operationId:string;token:string;date:string;time:string;name:string;email:string;phone:string;productId?:string};}
export async function expireFittings(now=new Date()){
 await FittingModel.updateMany({status:'pending',expiresAt:{$lte:now}},{$set:{status:'expired'},$unset:{slotKey:1,activeEmail:1},$inc:{revision:1}}).exec();
}
export async function availableFittingSlots(date:string,now=new Date()){
 try{parseDateOnly(date);}catch{throw new FittingError('VALIDATION_ERROR',400);}
 const settings=await getFittingSettings();await expireFittings(now);
 const busy=await FittingModel.find({date,slotKey:{$exists:true}}).select('time').lean().exec();
 return {enabled:settings.enabled,durationMinutes:30,price:200,date,slots:fittingSlots(date,settings,now).filter(s=>!busy.some((b:any)=>b.time===s.time)).map(s=>s.time)};
}
export async function createFitting(body:unknown,now=new Date()){
 const v=parseFittingCreate(body),requestHash=hash(JSON.stringify([v.operationId,v.date,v.time,v.name,v.email,v.phone,v.productId||'']));
 await FittingModel.createIndexes();
 const replay=await FittingModel.findOne({operationId:v.operationId}).select('+tokenHash +requestHash').lean().exec() as any;
 if(replay){if(replay.tokenHash!==hash(v.token)||replay.requestHash!==requestHash)throw new FittingError('IDEMPOTENCY_CONFLICT');return publicFitting(replay,now);}
 const settings=await getFittingSettings(),slot=fittingSlots(v.date,settings,now).find(s=>s.time===v.time);
 if(!slot)throw new FittingError('SLOT_UNAVAILABLE');
 let product: {id:string;name:string;slug:string}|undefined;
 if(v.productId){const p=await ProductV2Model.findOne({_id:new Types.ObjectId(v.productId),status:'active'}).lean().exec();if(!p)throw new FittingError('PRODUCT_UNAVAILABLE');product={id:v.productId,name:p.name,slug:p.slug};}
 await expireFittings(now);
 try{
  const doc=await FittingModel.create({operationId:v.operationId,tokenHash:hash(v.token),requestHash,number:'ZK-'+randomUUID().replace(/-/g,'').slice(0,12).toUpperCase(),date:v.date,time:v.time,startAt:slot.startAt,address:settings.address,slotKey:v.date+'T'+v.time,activeEmail:hash(v.email),expiresAt:new Date(now.getTime()+30*60000),status:'pending',paymentStatus:'unpaid',customer:{name:v.name,email:v.email,phone:v.phone},product,creditOperationId:randomUUID(),revision:0,audit:[{action:'created',at:now,by:'customer'}]});
  return publicFitting(doc.toObject(),now);
 }catch(error){
  if((error as any).code===11000){const winner=await FittingModel.findOne({operationId:v.operationId}).select('+tokenHash +requestHash').lean().exec() as any;if(winner&&winner.tokenHash===hash(v.token)&&winner.requestHash===requestHash)return publicFitting(winner,now);throw new FittingError('SLOT_OR_PENDING_CONFLICT');}throw error;
 }
}
export function publicFitting(doc:any,now=new Date()){
 const expired=doc.status==='pending'&&new Date(doc.expiresAt)<=now;
 const status=expired?'expired':doc.status;
 return {number:doc.number,date:doc.date,time:doc.time,durationMinutes:30,price:200,address:doc.address,status,paymentStatus:doc.paymentStatus,expiresAt:doc.expiresAt,product:doc.product,
 paymentInstructions:status==='pending'&&doc.paymentStatus==='unpaid'?{...BOOKING_POLICY.bank,amount:200,message:doc.number,qrPayload:`SPD*1.0*ACC:${BOOKING_POLICY.bank.iban}*AM:200.00*CC:CZK*MSG:${doc.number}*PT:IP`}:null};
}
export async function readFitting(number:string,token:string,now=new Date()){
 if(!/^ZK-[A-F0-9]{12}$/.test(number)||!/^[a-f0-9]{64}$/.test(token))throw new FittingError('FITTING_NOT_FOUND',404);
 await expireFittings(now);
 const doc=await FittingModel.findOne({number,tokenHash:hash(token)}).lean().exec();if(!doc)throw new FittingError('FITTING_NOT_FOUND',404);return publicFitting(doc,now);
}
export async function reportFittingPayment(number:string,token:string,now=new Date()){
 await readFitting(number,token,now);
 await FittingModel.updateOne({number,tokenHash:hash(token),status:'pending',expiresAt:{$gt:now}},{$set:{status:'review'},$inc:{revision:1},$push:{audit:{action:'payment_reported',at:now,by:'customer'}}}).exec();
 return readFitting(number,token,now);
}
export async function cancelPublicFitting(number:string,token:string,now=new Date()){
 await readFitting(number,token,now);
 await FittingModel.updateOne({number,tokenHash:hash(token),status:{$in:['pending','review','confirmed']}},{$set:{status:'cancelled'},$unset:{slotKey:1,activeEmail:1},$inc:{revision:1},$push:{audit:{action:'cancelled',at:now,by:'customer'}}}).exec();
 return readFitting(number,token,now);
}
export async function adminFittings(from:string,to:string){
 try{if(parseDateOnly(to).getTime()-parseDateOnly(from).getTime()>93*86400000||to<from)throw Error();}catch{throw new FittingError('VALIDATION_ERROR',400);}
 await expireFittings();
 const docs=await FittingModel.find({date:{$gte:from,$lte:to}}).sort({date:1,time:1}).limit(501).lean().exec();
 const credits=await ReservationV2Model.find({fittingCreditId:{$in:docs.map((d:any)=>d._id.toString())}}).select('fittingCreditId reservationNumber').lean().exec();
 return {truncated:docs.length>500,items:docs.slice(0,500).map((d:any)=>({...publicFitting(d),id:d._id.toString(),revision:d.revision,customer:d.customer,audit:d.audit,credit:credits.find(c=>c.fittingCreditId===d._id.toString())?{reservationId:credits.find(c=>c.fittingCreditId===d._id.toString())!._id.toString(),reservationNumber:credits.find(c=>c.fittingCreditId===d._id.toString())!.reservationNumber}:null}))};
}
export async function actOnFitting(id:string,body:any,actor:string,now=new Date()){
 if(!Types.ObjectId.isValid(id)||!Number.isSafeInteger(body?.revision)||body.revision<0)throw new FittingError('VALIDATION_ERROR',400);
 const doc=await FittingModel.findById(id).lean().exec() as any;if(!doc)throw new FittingError('FITTING_NOT_FOUND',404);
 if(body.action==='credit'){
  if(doc.status!=='completed'||doc.paymentStatus!=='paid')throw new FittingError('FITTING_NOT_CREDITABLE');
  const number=String(body.reservationNumber||'').trim().toUpperCase();
  const reservation=await ReservationV2Model.findOne({reservationNumber:number}).lean().exec();if(!reservation)throw new FittingError('RESERVATION_NOT_FOUND',404);
  // Unique top-level index + the ledger's one-document CAS make a fitting usable once,
  // even when two admins choose different reservations at the same time.
  await ReservationV2Model.collection.createIndex({fittingCreditId:1},{unique:true,partialFilterExpression:{fittingCreditId:{$type:'string'}}});
  if(reservation.fittingCreditId===id)return {ok:true};
  if(reservation.fittingCreditId||!['pending','confirmed','prepared'].includes(reservation.status)||(reservation.status==='pending'&&(!reservation.expiresAt||new Date(reservation.expiresAt)<=now))||reservation.customerSnapshot.email.toLowerCase()!==doc.customer.email)throw new FittingError('CREDIT_RESERVATION_MISMATCH');
  const summary=paymentSummary(reservation);if(summary.rentalBalance<200)throw new FittingError('CREDIT_BALANCE_TOO_LOW');
  try{await recordPayment(reservation._id,{operationId:doc.creditOperationId,expectedRevision:summary.revision,type:'rental_received',amount:200,method:'bank_transfer',reference:doc.number,note:'Započtení zaplacené zkoušky'},actor,id);}catch(e){if((e as any).code===11000)throw new FittingError('FITTING_ALREADY_CREDITED');throw e;}
  return {ok:true};
 }
 if(doc.revision!==body.revision)throw new FittingError('FITTING_CONFLICT');
 let set:any={},unset:any={};
 switch(body.action){
  case 'confirm':if(!['pending','review'].includes(doc.status)||!doc.slotKey||(doc.status==='pending'&&new Date(doc.expiresAt)<=now))throw new FittingError('FITTING_CONFLICT');set={status:'confirmed',paymentStatus:'paid'};unset={activeEmail:1};break;
  case 'late-payment':if(!['expired','cancelled'].includes(doc.status)||doc.paymentStatus!=='unpaid')throw new FittingError('FITTING_CONFLICT');set={paymentStatus:'paid'};break;
  case 'complete':if(doc.status!=='confirmed'||new Date(doc.startAt)>now)throw new FittingError('FITTING_CONFLICT');set={status:'completed'};unset={slotKey:1,activeEmail:1};break;
  case 'cancel':if(!['pending','review','confirmed'].includes(doc.status))throw new FittingError('FITTING_CONFLICT');set={status:'cancelled'};unset={slotKey:1,activeEmail:1};break;
  case 'refund':if(!['cancelled','expired'].includes(doc.status)||doc.paymentStatus!=='paid')throw new FittingError('FITTING_CONFLICT');set={paymentStatus:'refunded'};break;
  case 'reschedule':{
   if(doc.status!=='confirmed')throw new FittingError('FITTING_CONFLICT');
   const settings=await getFittingSettings();let slot;try{slot=fittingSlots(body.date,settings,now).find(s=>s.time===body.time);}catch{throw new FittingError('VALIDATION_ERROR',400);}if(!slot)throw new FittingError('SLOT_UNAVAILABLE');
   await expireFittings(now);set={date:body.date,time:body.time,startAt:slot.startAt,slotKey:body.date+'T'+body.time,address:settings.address};break;
  }
  default:throw new FittingError('VALIDATION_ERROR',400);
 }
 try{const changed=await FittingModel.updateOne({_id:doc._id,revision:doc.revision},{$set:set,$unset:unset,$inc:{revision:1},$push:{audit:{action:body.action,at:now,by:actor}}}).exec();if(!changed.modifiedCount)throw new FittingError('FITTING_CONFLICT');}
 catch(e){if((e as any).code===11000)throw new FittingError('SLOT_UNAVAILABLE');throw e;}
 return {ok:true};
}
