import {model,models,Schema} from 'mongoose';
export const paymentOptionsSchema = new Schema({
 gateway:{type:String,enum:['off','revolut'],required:true},
 qrEnabled:{type:Boolean,required:true},
 defaultMethod:{type:String,enum:['online','qr'],required:true},
},{_id:false});
const schema=new Schema({_id:String,options:{type:paymentOptionsSchema,required:true},revision:{type:Number,required:true},updatedBy:String}, {collection:'v2_payment_settings',timestamps:true});
export const PaymentSettingsModel=models.PaymentSettings??model('PaymentSettings',schema);
