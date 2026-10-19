import {model, models, Schema} from 'mongoose';
const schema = new Schema({
 number:{type:String,required:true,unique:true}, sourceKey:{type:String,required:true,unique:true},
 sourceType:{type:String,enum:['fitting','reservation','correction'],required:true}, sourceId:{type:String,required:true},
 sourceNumber:{type:String,required:true}, issuedAt:{type:Date,required:true}, issuedBy:{type:String,required:true},
 // Immutable accounting snapshot. Payments made later remain in the source ledger.
 snapshot:{type:Schema.Types.Mixed,required:true},
 email:{status:String,attemptedAt:Date,sentAt:Date},
},{collection:'v2_invoices',strict:'throw'});
schema.index({issuedAt:-1});
export const InvoiceModel=models.Invoice ?? model('Invoice',schema);
const counterSchema=new Schema({_id:String,value:{type:Number,required:true}},{collection:'v2_invoice_counters'});
export const InvoiceCounter=models.InvoiceCounter ?? model('InvoiceCounter',counterSchema);
