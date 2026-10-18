import {model, models, Schema, type Model} from 'mongoose';
import Joi = require('joi');
export const SECTION_KEYS = ['girlsDresses','womenDresses','suits','familyLooks'] as const;
export const FILTER_KEYS = ['category','gender','price','rentalMode','color','size'] as const;
export type SectionKey = typeof SECTION_KEYS[number];
export type FilterKey = typeof FILTER_KEYS[number];
export type SiteSections = Record<SectionKey, boolean>;
export type CatalogueFilters = Record<SectionKey, FilterKey[]>;
interface SiteSettingsDocument { _id: string; sections?: Partial<SiteSections>; filters?: Partial<CatalogueFilters>; }
export const DEFAULT_SITE_SECTIONS: SiteSections = {girlsDresses:true,womenDresses:true,suits:true,familyLooks:false};
export const DEFAULT_CATALOGUE_FILTERS: CatalogueFilters = {
 girlsDresses:['price','rentalMode','color','size'],womenDresses:['price','rentalMode','color','size'],
 suits:['gender','price','rentalMode','color','size'],familyLooks:[...FILTER_KEYS],
};
export const SITE_SETTINGS_ID = 'storefront';
const schema = new Schema<SiteSettingsDocument>({
 _id:{type:String,required:true},
 sections:Object.fromEntries(SECTION_KEYS.map(key=>[key,Boolean])),
 filters:Object.fromEntries(SECTION_KEYS.map(key=>[key,{type:[String],enum:FILTER_KEYS,default:undefined}])),
},{collection:'v2_site_settings',timestamps:true,strict:'throw'});
export const SiteSettingsModel:Model<SiteSettingsDocument>=(models.SiteSettings as Model<SiteSettingsDocument>|undefined)??model<SiteSettingsDocument>('SiteSettings',schema);
const patchSchema=Joi.object({
 sections:Joi.object(Object.fromEntries(SECTION_KEYS.map(key=>[key,Joi.boolean().strict()]))).min(1).unknown(false),
 filters:Joi.object(Object.fromEntries(SECTION_KEYS.map(key=>[key,Joi.array().items(Joi.string().valid(...DEFAULT_CATALOGUE_FILTERS[key])).unique().max(FILTER_KEYS.length)]))).min(1).unknown(false),
}).min(1).required().unknown(false);
export function parseSiteSettingsPatch(body:unknown):{sections?:Partial<SiteSections>;filters?:Partial<CatalogueFilters>}|null{
 const result=patchSchema.validate(body);return result.error?null:result.value;
}
function project(document:SiteSettingsDocument|null){return {
 sections:Object.fromEntries(SECTION_KEYS.map(key=>[key,document?.sections?.[key]??DEFAULT_SITE_SECTIONS[key]])) as SiteSections,
 filters:Object.fromEntries(SECTION_KEYS.map(key=>[key,document?.filters?.[key]??DEFAULT_CATALOGUE_FILTERS[key]])) as CatalogueFilters,
};}
export async function getSiteSettings(){return project(await SiteSettingsModel.findById(SITE_SETTINGS_ID).lean().exec());}
export async function patchSiteSettings(sections:Partial<SiteSections>={},filters:Partial<CatalogueFilters>={}){
 const $set:Record<string,boolean|FilterKey[]>={};
 for(const key of SECTION_KEYS){if(typeof sections[key]==='boolean')$set['sections.'+key]=sections[key]!;if(Array.isArray(filters[key]))$set['filters.'+key]=filters[key]!;}
 const write=()=>SiteSettingsModel.findOneAndUpdate({_id:SITE_SETTINGS_ID},{$set},{upsert:true,new:true,runValidators:true,setDefaultsOnInsert:false}).lean().exec();
 try{return project(await write());}catch(error){if((error as {code?:number}).code===11000)return project(await write());throw error;}
}
