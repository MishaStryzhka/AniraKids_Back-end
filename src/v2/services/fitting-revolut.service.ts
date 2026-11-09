import {randomUUID} from 'crypto';
import {FittingModel} from '../models/fitting.model';
import {PaymentError} from './payment.types';
import {revolutConfiguration,revolutRequest,type RevolutOrder} from './revolut-client';
import {assertOrderMatches} from './revolut.service';
import type {RevolutAttempt} from './revolut.types';
import {processAutomaticInvoice} from './invoice-automation.service';

export function fittingCardPayable(doc:any,now=new Date()):boolean {
 return doc.status==='pending'&&doc.paymentStatus==='unpaid'&&Boolean(doc.slotKey)&&new Date(doc.expiresAt)>now&&!doc.revolutAttempts?.some((a:RevolutAttempt)=>a.reviewRequired);
}
export async function createFittingCardOrder(doc:any){
 if(!revolutConfiguration())throw new PaymentError('REVOLUT_UNAVAILABLE',503);
 if(!fittingCardPayable(doc))throw new PaymentError('PAYMENT_NOT_ALLOWED');
 const active=doc.revolutAttempts?.find((a:RevolutAttempt)=>a.id===doc.revolutActiveAttempt);
 if(active){
  if(!active.orderId||!active.token)throw new PaymentError('REVOLUT_RECONCILIATION_REQUIRED');
  await reconcileFittingCardOrder(await revolutRequest('GET','/orders/'+active.orderId));
  const fresh=await FittingModel.findById(doc._id).lean().exec() as any;
  if(fresh?.revolutActiveAttempt!==active.id||new Date(active.expiresAt)<=new Date())throw new PaymentError('PAYMENT_STATE_CHANGED');
  return {publicId:active.token};
 }
 if(doc.paymentOptions?.gateway!=='revolut')throw new PaymentError('PAYMENT_NOT_ALLOWED');
 if((doc.revolutAttempts?.length??0)>=50)throw new PaymentError('PAYMENT_LIMIT_EXCEEDED');
 const expiresAt=new Date(Math.min(Date.now()+15*60000,new Date(doc.expiresAt).getTime()));
 if(expiresAt.getTime()-Date.now()<60000)throw new PaymentError('PAYMENT_NOT_ALLOWED');
 const attempt:RevolutAttempt={id:randomUUID(),kind:'advance',amount:200,rentalAmount:200,depositAmount:0,expiresAt,state:'creating'};
 const locked=await FittingModel.findOneAndUpdate({_id:doc._id,revision:doc.revision,status:'pending',paymentStatus:'unpaid',expiresAt:{$gt:new Date(Date.now()+60000)},revolutActiveAttempt:{$exists:false}},{$set:{revolutActiveAttempt:attempt.id},$push:{revolutAttempts:attempt},$inc:{revision:1}},{new:true}).lean().exec();
 if(!locked)throw new PaymentError('PAYMENT_CONFLICT');
 // Ambiguous creation is left locked; never retry a charge with a new order.
 const order=await revolutRequest('POST','/orders',{amount:20000,currency:'CZK',capture_mode:'automatic',description:'AniraKids '+doc.number+' zkouška',merchant_order_data:{reference:attempt.id},expire_pending_after:`PT${Math.max(1,Math.floor((expiresAt.getTime()-Date.now())/1000))}S`});
 assertOrderMatches(attempt,order);
 if(typeof order.token!=='string'||!order.token||order.token.length>200)throw new PaymentError('REVOLUT_ORDER_MISMATCH',502);
 await FittingModel.updateOne({_id:doc._id,revolutActiveAttempt:attempt.id,'revolutAttempts.id':attempt.id},{$set:{'revolutAttempts.$.orderId':order.id,'revolutAttempts.$.token':order.token,'revolutAttempts.$.state':'pending'}}).exec();
 const fresh=await FittingModel.findById(doc._id).lean().exec();
 if(!fresh||!fittingCardPayable(fresh)){await syncFittingCardOrder(doc,true);throw new PaymentError('PAYMENT_NOT_ALLOWED');}
 return {publicId:order.token};
}
export async function reconcileFittingCardOrder(order:RevolutOrder){
 const reference=order.merchant_order_data?.reference;
 if(!reference)return;
 for(let retry=0;retry<5;retry++){
  const doc=await FittingModel.findOne({'revolutAttempts.id':reference}).lean().exec() as any;
  if(!doc)return;
  const attempt:RevolutAttempt=doc.revolutAttempts.find((a:RevolutAttempt)=>a.id===reference);
  assertOrderMatches(attempt,order);
  if(attempt.state==='completed'){
   if(!attempt.reviewRequired)await processAutomaticInvoice('fitting',String(doc._id));
   return;
  }
  if(!['completed','cancelled','failed'].includes(order.state)){
   await FittingModel.updateOne({_id:doc._id,revolutActiveAttempt:attempt.id,'revolutAttempts.id':attempt.id},{$set:{'revolutAttempts.$.orderId':order.id,'revolutAttempts.$.token':order.token,'revolutAttempts.$.state':'pending'}}).exec();return;
  }
  if(attempt.state===order.state)return;
  const completed=order.state==='completed',now=new Date(),review=completed&&!fittingCardPayable(doc,now);
  // Money, confirmation, retained slot and invoice queue share one CAS write.
  // An expired/cancelled slot is never reclaimed by a delayed webhook.
  const changed=await FittingModel.updateOne({_id:doc._id,revision:doc.revision,status:doc.status,revolutAttempts:{$elemMatch:{id:attempt.id,state:{$ne:'completed'}}}},{$set:{'revolutAttempts.$.state':order.state,'revolutAttempts.$.orderId':order.id,'revolutAttempts.$.reviewRequired':review,
   ...(completed?{paymentStatus:'paid',paymentMethod:'card'}:{}),
   ...(completed&&!review?{status:'confirmed',invoiceAutomation:{status:'pending',requestedAt:now,requestedBy:'revolut'}}:{})},
   $unset:{...(doc.revolutActiveAttempt===attempt.id?{revolutActiveAttempt:1}:{}),...(completed&&!review?{activeEmail:1}:{})},$inc:{revision:1},
   $push:{audit:{action:review?'revolut_payment_review':completed?'confirm':'revolut_payment_closed',at:now,by:'revolut'}}}).exec();
  if(changed.modifiedCount){if(completed&&!review)await processAutomaticInvoice('fitting',String(doc._id));return;}
 }
 throw new PaymentError('PAYMENT_CONFLICT');
}
export async function syncFittingCardOrder(doc:any,cancel=false){
 const fresh=await FittingModel.findById(doc._id).lean().exec() as any;
 const attempt=fresh?.revolutAttempts?.find((a:RevolutAttempt)=>a.id===fresh.revolutActiveAttempt)??fresh?.revolutAttempts?.find((a:RevolutAttempt)=>a.state==='completed');
 if(!attempt)return;
 if(!attempt.orderId)throw new PaymentError('REVOLUT_RECONCILIATION_REQUIRED');
 await reconcileFittingCardOrder(await revolutRequest('GET','/orders/'+attempt.orderId));
 if(cancel&&await FittingModel.exists({_id:doc._id,revolutActiveAttempt:attempt.id})){
  await revolutRequest('POST','/orders/'+attempt.orderId+'/cancel');
  await reconcileFittingCardOrder(await revolutRequest('GET','/orders/'+attempt.orderId));
 }
}
