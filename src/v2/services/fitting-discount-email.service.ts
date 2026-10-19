import {randomBytes,createHash} from 'crypto';
import {FittingModel} from '../models/fitting.model';
const sendEmail=require('../../../helpers/sendEmail');
const {fittingEmail}=require('../../../helpers/fittingEmail');
/** Persist the capability hash and claim the event before the provider call.
 * Repeated completion never issues another capability or sends another email. */
export async function notifyFittingDiscount(doc:any){
 try{
  const token=randomBytes(32).toString('hex');
  const claimed=await FittingModel.updateOne({_id:doc._id,status:'completed',paymentStatus:'paid','emailDelivery.completed.status':{$exists:false}},{$set:{discountTokenHash:createHash('sha256').update(token).digest('hex'),'emailDelivery.completed':{status:'sending',attemptedAt:new Date()}}});
  if(!claimed.modifiedCount)return;
  try{await sendEmail(fittingEmail(doc,'completed',token));await FittingModel.updateOne({_id:doc._id},{$set:{'emailDelivery.completed.status':'sent','emailDelivery.completed.sentAt':new Date()}});}
  catch{await FittingModel.updateOne({_id:doc._id},{$set:{'emailDelivery.completed.status':'failed'}});console.warn('FITTING_DISCOUNT_EMAIL_FAILED',String(doc._id));}
 }catch{console.warn('FITTING_DISCOUNT_EMAIL_UNAVAILABLE',String(doc._id));}
}
