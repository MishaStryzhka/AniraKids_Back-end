import Joi = require('joi');
import {PaymentSettingsModel} from '../models/payment-settings.model';
import {revolutConfiguration} from './revolut-client';
import {PaymentError} from './payment.types';
import {legacyFittingPayments,legacyRentalPayments,type PaymentOptions} from './payment-options';
const schema=Joi.object({revision:Joi.number().integer().min(0).required(),gateway:Joi.string().valid('off','revolut').required(),qrEnabled:Joi.boolean().strict().required(),defaultMethod:Joi.string().valid('online','qr').required()}).unknown(false);
export function validatePaymentSettings(body:unknown,ready=Boolean(revolutConfiguration())) {
 const {value,error}=schema.validate(body,{convert:false});
 if(error)throw new PaymentError('VALIDATION_ERROR',400);
 if(value.gateway==='revolut'&&!ready)throw new PaymentError('REVOLUT_UNAVAILABLE',409);
 if((value.gateway==='off'&&!value.qrEnabled)||(value.defaultMethod==='online'&&value.gateway==='off')||(value.defaultMethod==='qr'&&!value.qrEnabled))throw new PaymentError('PAYMENT_METHOD_REQUIRED',400);
 return value as PaymentOptions & {revision:number};
}
export async function getPaymentSettings(){
 const doc=await PaymentSettingsModel.findById('checkout').lean().exec() as any;
 const ready=Boolean(revolutConfiguration());
 return {...(doc?.options??{gateway:ready?'revolut':'off',qrEnabled:true,defaultMethod:'qr'}),revision:doc?.revision??0,configured:Boolean(doc),providers:{revolut:ready,globalpayments:false}};
}
export async function snapshotPaymentOptions(source:'fitting'|'rental'):Promise<PaymentOptions>{
 const settings=await getPaymentSettings();
 // Preserve the pre-settings behaviour until an administrator explicitly saves.
 if(!settings.configured)return {...(source==='fitting'?legacyFittingPayments:{...legacyRentalPayments,gateway:settings.gateway})};
 return {gateway:settings.gateway,qrEnabled:settings.qrEnabled,defaultMethod:settings.defaultMethod};
}
export async function savePaymentSettings(body:unknown,actor:string){
 const {revision,...options}=validatePaymentSettings(body);
 try{
  const updated=await PaymentSettingsModel.findOneAndUpdate({_id:'checkout',revision},{$set:{options,updatedBy:actor},$inc:{revision:1}},{new:true,upsert:revision===0,runValidators:true}).lean().exec();
  if(!updated)throw new PaymentError('PAYMENT_SETTINGS_CONFLICT',409);
 }catch(e){if((e as any).code===11000)throw new PaymentError('PAYMENT_SETTINGS_CONFLICT',409);throw e;}
 return getPaymentSettings();
}
