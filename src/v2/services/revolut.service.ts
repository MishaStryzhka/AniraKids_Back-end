import {reservationAdminService} from './reservation-admin.service';
import {ReservationAdminError} from './reservation-admin.types';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { ReservationV2Model } from '../models/reservation-v2.model';
import type { Reservation } from '../types/domain';
import { paymentSummary } from './payment.service';
import { PaymentError, type PaymentEntry } from './payment.types';
import { revolutConfiguration, revolutRequest, type RevolutOrder } from './revolut-client';
import type { RevolutAttempt } from './revolut.types';
import { processAutomaticInvoice } from './invoice-automation.service';

type Stored = Reservation & {_id:Types.ObjectId};
const revisionFilter = (r:Reservation) => ({paymentRevision:r.paymentRevision === undefined ? {$exists:false} : r.paymentRevision});
export function cardAmounts(r:Reservation, kind:'advance'|'full', now=Date.now()) {
  const s=paymentSummary(r);
  const pending=r.status==='pending' && !!r.expiresAt && r.expiresAt.getTime()>now;
  if (r.revolutAttempts?.some(a=>a.reviewRequired) || r.advanceRequired===undefined || s.legacyUnreconciled || !(pending || ['confirmed','prepared'].includes(r.status)) ||
      (s.paymentReport?.status==='pending' && s.paymentReport.kind!=='cash')) throw new PaymentError('PAYMENT_NOT_ALLOWED');
  const rentalAmount=kind==='advance' ? (pending?s.advanceBalance:0) : s.rentalBalance;
  const depositAmount=kind==='full'?Math.max(0,s.depositRequired-s.depositHeld):0;
  const amount=rentalAmount+depositAmount;
  if (!Number.isSafeInteger(amount) || amount<=0 || amount>1000000) throw new PaymentError('PAYMENT_NOT_ALLOWED');
  return {amount,rentalAmount,depositAmount};
}
export function assertOrderMatches(attempt:RevolutAttempt, order:RevolutOrder) {
  if (!/^[a-f0-9-]{36}$/i.test(order.id) || order.currency!=='CZK' || order.amount!==attempt.amount*100 ||
      order.merchant_order_data?.reference!==attempt.id || (attempt.orderId && attempt.orderId!==order.id))
    throw new PaymentError('REVOLUT_ORDER_MISMATCH',502);
}
// Never create an order twice after a timeout: creation has no documented
// idempotency key. The durable "creating" slot stays locked for reconciliation.
export async function createCardOrder(r:Stored, kind:'advance'|'full') {
  const config=revolutConfiguration();
  if (!config) throw new PaymentError('REVOLUT_UNAVAILABLE',503);
  const amounts=cardAmounts(r,kind);
  const active=r.revolutAttempts?.find(a=>a.id===r.revolutActiveAttempt);
  if (active) {
    if (active.kind!==kind || active.amount!==amounts.amount) throw new PaymentError('REVOLUT_PAYMENT_ACTIVE');
    if (!active.orderId || !active.token) throw new PaymentError('REVOLUT_RECONCILIATION_REQUIRED');
    await reconcileCardOrder(active.orderId);
    const current=await ReservationV2Model.findById(r._id).lean().exec();
    if (current?.revolutActiveAttempt!==active.id || active.expiresAt.getTime()<=Date.now()) throw new PaymentError('PAYMENT_STATE_CHANGED');
    return {publicId:active.token};
  }
  if ((r.revolutAttempts?.length??0)>=50) throw new PaymentError('PAYMENT_LIMIT_EXCEEDED');
  const expiresAt=new Date(Math.min(Date.now()+15*60000,r.status==='pending'?r.expiresAt!.getTime():Infinity));
  if (expiresAt.getTime()-Date.now()<60000) throw new PaymentError('PAYMENT_NOT_ALLOWED');
  const attempt:RevolutAttempt={id:randomUUID(),kind,...amounts,expiresAt,state:'creating'};
  const locked=await ReservationV2Model.findOneAndUpdate({_id:r._id,status:r.status,...revisionFilter(r),
    revolutActiveAttempt:{$exists:false},...(r.status==='pending'?{expiresAt:{$gt:new Date(Date.now()+60000)}}:{})},
    {$set:{revolutActiveAttempt:attempt.id},$push:{revolutAttempts:attempt},$inc:{paymentRevision:1}},{new:true,runValidators:true}).lean().exec();
  if (!locked) throw new PaymentError('PAYMENT_CONFLICT');
  const order=await revolutRequest('POST','/orders',{amount:amounts.amount*100,currency:'CZK',capture_mode:'automatic',
    description:`AniraKids ${r.reservationNumber} ${kind==='advance'?'zaloha':'pronajem a kauce'}`,
    merchant_order_data:{reference:attempt.id},expire_pending_after:`PT${Math.max(1,Math.floor((expiresAt.getTime()-Date.now())/1000))}S`});
  assertOrderMatches(attempt,order);
  if (typeof order.token!=='string' || !order.token || order.token.length>200) throw new PaymentError('REVOLUT_ORDER_MISMATCH',502);
  const saved=await ReservationV2Model.updateOne({_id:r._id,revolutActiveAttempt:attempt.id,'revolutAttempts.id':attempt.id},
    {$set:{'revolutAttempts.$.orderId':order.id,'revolutAttempts.$.token':order.token,'revolutAttempts.$.state':'pending'}}).exec();
  if (!saved.matchedCount) throw new PaymentError('PAYMENT_STATE_CHANGED');
  // Cancellation/expiry can race order creation: don't expose a payable token.
  const fresh=await ReservationV2Model.findById(r._id).lean().exec();
  try { if (!fresh) throw new Error(); if(cardAmounts(fresh,kind).amount!==attempt.amount)throw new Error(); }
  catch { await cancelCardOrder(locked); throw new PaymentError('PAYMENT_NOT_ALLOWED'); }
  return {publicId:order.token};
}

// Runs after the durable money write; duplicate notifications also resume this
// step after a process/network failure. Confirmation uses the existing inventory
// transaction, so it cannot displace another booking.
async function finishCardPayment(id:Types.ObjectId, attemptId:string) {
  let r=await ReservationV2Model.findById(id).lean().exec();
  const attempt=r?.revolutAttempts?.find(a=>a.id===attemptId);
  if(!r || !attempt || attempt.state!=='completed' || attempt.reviewRequired)return;
  if(r.status==='cancelled') {
    await ReservationV2Model.updateOne({_id:id,status:'cancelled','revolutAttempts.id':attemptId},
      {$set:{'revolutAttempts.$.reviewRequired':true},$inc:{paymentRevision:1}}).exec();
    return;
  }
  if(r.status==='pending') {
    try { await reservationAdminService.confirm(id,{actor:'revolut',requireActiveHold:true}); }
    catch(error) {
      if(!(error instanceof ReservationAdminError))throw error;
      // A concurrent staff confirmation can already have succeeded.
      r=await ReservationV2Model.findById(id).lean().exec();
      if(!r)return;
      if(r.status!=='confirmed' && r.status!=='prepared') {
        await ReservationV2Model.updateOne({_id:id,status:r.status,'revolutAttempts.id':attemptId},
          {$set:{'revolutAttempts.$.reviewRequired':true},$inc:{paymentRevision:1},
            $push:{partnerAudit:{action:'revolut_confirmation_review',at:new Date(),by:'revolut',operationId:attemptId,reference:attempt.orderId}}}).exec();
        return;
      }
    }
  }
  // Queue the receipt only after successful confirmation, never while an expired
  // or conflicting reservation still needs an operator's decision.
  if(attempt.rentalAmount)await ReservationV2Model.updateOne({_id:id,status:{$in:['confirmed','prepared','rented','returned']},invoiceAutomation:{$exists:false}},
    {$set:{invoiceAutomation:{status:'pending',requestedAt:new Date(),requestedBy:'revolut'}}}).exec();
  await processAutomaticInvoice('reservation',String(id));
}

export async function reconcileCardOrder(orderId:string) {
  if (!/^[a-f0-9-]{36}$/i.test(orderId)) throw new PaymentError('VALIDATION_ERROR',400);
  const order=await revolutRequest('GET','/orders/'+orderId);
  // The reference recovers a create response lost before orderId persistence.
  const reference=order.merchant_order_data?.reference;
  if (!reference) return;
  for(let retry=0;retry<5;retry++) {
    const r=await ReservationV2Model.findOne({'revolutAttempts.id':reference}).lean().exec();
    if (!r) return;
    const attempt=r.revolutAttempts!.find(a=>a.id===reference)!;
    assertOrderMatches(attempt,order);
    if (attempt.state==='completed') { if(!attempt.reviewRequired)await finishCardPayment(r._id,attempt.id); return; }
    if (attempt.state===order.state && ['cancelled','failed'].includes(order.state))return;
    if (!['completed','cancelled','failed'].includes(order.state)) {
      await ReservationV2Model.updateOne({_id:r._id,revolutActiveAttempt:attempt.id,'revolutAttempts.id':attempt.id},
        {$set:{'revolutAttempts.$.orderId':order.id,'revolutAttempts.$.token':order.token,'revolutAttempts.$.state':'pending'}}).exec();
      return;
    }
    const now=new Date();
    const completed=order.state==='completed';
    const summary=paymentSummary(r);
    const review=completed && (!['pending','confirmed','prepared'].includes(r.status) || (r.status==='pending' && (!r.expiresAt || r.expiresAt<=now)) ||
      summary.rentalBalance<attempt.rentalAmount || Math.max(0,r.deposit-summary.depositHeld)<attempt.depositAmount);
    const entries:PaymentEntry[]=completed ? [
      ...(attempt.rentalAmount?[{operationId:attempt.id+':rent',type:attempt.kind==='advance'?'advance_received' as const:'rental_received' as const,amount:attempt.rentalAmount}]:[]),
      ...(attempt.depositAmount?[{operationId:attempt.id+':deposit',type:'deposit_received' as const,amount:attempt.depositAmount}]:[]),
    ].map(e=>({...e,method:'card' as const,reference:order.id,note:review?'Revolut: ověřit pozdní nebo souběžnou platbu':'Revolut: ověřeno serverem',recordedAt:now,recordedBy:'revolut'})) : [];
    const next=paymentSummary({...r,paymentEntries:[...(r.paymentEntries??[]),...entries]});
    const updated=await ReservationV2Model.findOneAndUpdate({_id:r._id,status:r.status,...revisionFilter(r),
      revolutAttempts:{$elemMatch:{id:attempt.id,state:{$ne:'completed'}}}},
      {$set:{'revolutAttempts.$.state':order.state,'revolutAttempts.$.orderId':order.id,'revolutAttempts.$.reviewRequired':review,
        ...(completed?{paymentStatus:!review && next.rentalNet>=r.subtotal && next.depositHeld>=r.deposit?'paid':'unpaid'}:{})},
        ...(r.revolutActiveAttempt===attempt.id?{$unset:{revolutActiveAttempt:1}}:{}),$inc:{paymentRevision:1},
        $push:{...(entries.length?{paymentEntries:{$each:entries}}:{}),partnerAudit:{action:review?'revolut_payment_review':completed?'revolut_payment_received':'revolut_payment_closed',at:now,by:'revolut',operationId:attempt.id,amount:completed?attempt.amount:0,reference:order.id}}},
      {new:true,runValidators:true}).lean().exec();
    if(updated){if(completed && !review)await finishCardPayment(r._id,attempt.id);return;}
  }
  throw new PaymentError('PAYMENT_CONFLICT');
}
export async function cancelCardOrder(r:Stored) {
  const fresh=await ReservationV2Model.findById(r._id).lean().exec();
  const active=fresh?.revolutAttempts?.find(a=>a.id===fresh.revolutActiveAttempt);
  if(!active)return;
  if(!active.orderId)throw new PaymentError('REVOLUT_RECONCILIATION_REQUIRED');
  await reconcileCardOrder(active.orderId);
  const current=await ReservationV2Model.findById(r._id).lean().exec();
  if(current?.revolutActiveAttempt!==active.id)return;
  await revolutRequest('POST','/orders/'+active.orderId+'/cancel');
  await reconcileCardOrder(active.orderId);
}
