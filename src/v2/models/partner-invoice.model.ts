import {model,models,Schema} from 'mongoose';
const report=new Schema({
 partnerId:{type:String,required:true},period:{type:String,required:true},number:String,
 status:{type:String,enum:['issued','zero','credit'],required:true},issuedAt:Date,issuedBy:String,
 snapshot:{type:Schema.Types.Mixed,required:true,immutable:true},email:{status:String,attemptId:String,attemptedAt:Date,sentAt:Date},
},{collection:'v2_partner_invoices',timestamps:true,strict:'throw'});
report.index({partnerId:1,period:1},{unique:true});
report.index({number:1},{unique:true,partialFilterExpression:{number:{$type:'string'}}});
export const PartnerInvoiceModel=models.PartnerInvoice??model('PartnerInvoice',report);
const state=new Schema({_id:String,lines:{type:Schema.Types.Mixed,required:true}},{collection:'v2_partner_reward_states',timestamps:true});
export const PartnerRewardState=models.PartnerRewardState??model('PartnerRewardState',state);
const event=new Schema({partnerId:String,at:Date,kind:String,number:String,amount:Number,detail:Schema.Types.Mixed},{collection:'v2_partner_reward_events',timestamps:true});
event.index({partnerId:1,at:1});
export const PartnerRewardEvent=models.PartnerRewardEvent??model('PartnerRewardEvent',event);
