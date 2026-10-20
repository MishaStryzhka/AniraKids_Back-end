import {releaseUnusedFittingDiscounts} from './fitting-discount.service';
import {notifyFittingDiscount} from './fitting-discount-email.service';
import {InvoiceModel} from '../models/invoice.model';
import {createHash,randomUUID} from 'crypto';
import {Types} from 'mongoose';
import type {PartnerAttribution} from './partner-referral.service';
import Joi = require('joi');
import {FittingModel} from '../models/fitting.model';
import {ProductV2Model} from '../models/product-v2.model';
import {ReservationV2Model} from '../models/reservation-v2.model';
import {BOOKING_POLICY} from './booking-policy';
import {getFittingSettings,fittingSlots} from './fitting-settings.service';
import {paymentSummary} from './payment.service';
import {parseDateOnly} from '../utils/date-only';
import {notifyFitting} from './fitting-email.service';
import {notifyOwnerFittingCreated,notifyOwnerFittingPaymentReported} from './admin-push.service';
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
export async function createFitting(body:unknown,now=new Date(),customerId?:Types.ObjectId,partner?:PartnerAttribution,auditActor?:string){
 const v=parseFittingCreate(body),requestHash=hash(JSON.stringify([v.operationId,v.date,v.time,v.name,v.email,v.phone,v.productId||'',...(customerId?[customerId.toHexString()]:[]),...(partner?[partner]:[]),...(auditActor?[auditActor]:[])]));
 await FittingModel.createIndexes();
 const replay=await FittingModel.findOne({operationId:v.operationId}).select('+tokenHash +requestHash').lean().exec() as any;
 if(replay){if(replay.tokenHash!==hash(v.token)||replay.requestHash!==requestHash)throw new FittingError('IDEMPOTENCY_CONFLICT');if(replay.status==='pending'&&new Date(replay.expiresAt)>now)await notifyFitting(replay,'created',v.token);return publicFitting(replay,now);}
 const settings=await getFittingSettings(),slot=fittingSlots(v.date,settings,now).find(s=>s.time===v.time);
 if(!slot)throw new FittingError('SLOT_UNAVAILABLE');
 let product: {id:string;name:string;slug:string}|undefined;
 if(v.productId){const p=await ProductV2Model.findOne({_id:new Types.ObjectId(v.productId),status:'active'}).lean().exec();if(!p)throw new FittingError('PRODUCT_UNAVAILABLE');product={id:v.productId,name:p.name,slug:p.slug};}
 await expireFittings(now);
 try{
  const doc=await FittingModel.create({partner,customerId,operationId:v.operationId,tokenHash:hash(v.token),requestHash,number:'ZK-'+randomUUID().replace(/-/g,'').slice(0,12).toUpperCase(),date:v.date,time:v.time,startAt:slot.startAt,address:settings.address,slotKey:v.date+'T'+v.time,activeEmail:hash(v.email),expiresAt:new Date(now.getTime()+60*60000),status:'pending',paymentStatus:'unpaid',customer:{name:v.name,email:v.email,phone:v.phone},product,creditOperationId:randomUUID(),revision:0,audit:[{action:'created',at:now,by:auditActor||partner?.createdBy||'customer'}]});
  await Promise.all([notifyFitting(doc.toObject(),'created',v.token),notifyOwnerFittingCreated(doc._id)]);
  return publicFitting(doc.toObject(),now);
 }catch(error){
  if((error as any).code===11000){const winner=await FittingModel.findOne({operationId:v.operationId}).select('+tokenHash +requestHash').lean().exec() as any;if(winner&&winner.tokenHash===hash(v.token)&&winner.requestHash===requestHash){if(winner.status==='pending'&&new Date(winner.expiresAt)>now)await notifyFitting(winner,'created',v.token);return publicFitting(winner,now);}throw new FittingError('SLOT_OR_PENDING_CONFLICT');}throw error;
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
 const changed = await FittingModel.findOneAndUpdate({number,tokenHash:hash(token),status:'pending',expiresAt:{$gt:now}},{$set:{status:'review'},$inc:{revision:1},$push:{audit:{action:'payment_reported',at:now,by:'customer'}}},{new:true}).select('_id').lean().exec();
 if (changed) await notifyOwnerFittingPaymentReported(changed._id);
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
 const docs=await FittingModel.find({date:{$gte:from,$lte:to}}).sort({createdAt:-1,_id:-1}).limit(501).lean().exec();
 return {truncated:docs.length>500,items:await adminFittingRecords(docs.slice(0,500))};
}
export async function readAdminFitting(id:string){
 if(id.length!==24||!/^[a-f\d]{24}$/i.test(id))throw new FittingError('FITTING_NOT_FOUND',404);
 await expireFittings();
 const doc=await FittingModel.findById(id).lean().exec();
 if(!doc)throw new FittingError('FITTING_NOT_FOUND',404);
 return (await adminFittingRecords([doc]))[0];
}
async function adminFittingRecords(docs:any[]){
 const credits=await ReservationV2Model.find({fittingCreditId:{$in:docs.map(d=>d._id.toString())}}).select('fittingCreditId reservationNumber').lean().exec();
 return docs.map(d=>{
  const credit=credits.find(c=>c.fittingCreditId===d._id.toString());
  return {...publicFitting(d),id:d._id.toString(),revision:d.revision,customer:d.customer,audit:d.audit,credit:credit?{reservationId:credit._id.toString(),reservationNumber:credit.reservationNumber}:null};
 });
}
export async function fittingDiscountOptions(reservationId:string,now=new Date()){
 await releaseUnusedFittingDiscounts(now);
 if(!Types.ObjectId.isValid(reservationId))throw new FittingError('VALIDATION_ERROR',400);
 const r=await ReservationV2Model.findById(reservationId).lean().exec();if(!r)throw new FittingError('RESERVATION_NOT_FOUND',404);
 const applied=r.fittingCreditId?await FittingModel.findById(r.fittingCreditId).select('number').lean().exec():null;
 const summary=paymentSummary(r);
 const eligible=!r.fittingCreditId&&!summary.legacyUnreconciled&&r.subtotal>=200&&['pending','confirmed','prepared'].includes(r.status)&&!(r.status==='pending'&&(!r.expiresAt||r.expiresAt<=now));
 const candidates=eligible?await FittingModel.find({status:'completed',paymentStatus:'paid','customer.email':r.customerSnapshot.email.toLowerCase().trim()}).select('_id number date time revision').sort({date:-1,time:-1}).lean().exec():[];
 const used=await ReservationV2Model.find({fittingCreditId:{$in:candidates.map(f=>String(f._id))}}).select('fittingCreditId').lean().exec();
 const usedIds=new Set(used.map(x=>x.fittingCreditId));
 return {eligible,applied:r.fittingCreditId?{number:r.fittingDiscount?.number||applied?.number||'',amount:200,kind:r.fittingDiscount?'discount':'legacy_credit'}:null,
  items:candidates.filter(f=>!usedIds.has(String(f._id))).map(f=>({id:String(f._id),number:f.number,date:f.date,time:f.time,revision:f.revision}))};
}
export async function actOnFitting(id:string,body:any,actor:string,now=new Date()){
 if(!Types.ObjectId.isValid(id)||!Number.isSafeInteger(body?.revision)||body.revision<0)throw new FittingError('VALIDATION_ERROR',400);
 const doc=await FittingModel.findById(id).lean().exec() as any;if(!doc)throw new FittingError('FITTING_NOT_FOUND',404);
 if(body.action==='confirm'&&doc.paymentStatus==='paid'&&['confirmed','completed'].includes(doc.status))return {ok:true};
 if(body.action==='complete'&&doc.status==='completed'){await notifyFittingDiscount(doc);return {ok:true};}
 if(body.action==='credit'){
  await releaseUnusedFittingDiscounts(now);
  if(doc.status!=='completed'||doc.paymentStatus!=='paid')throw new FittingError('FITTING_NOT_CREDITABLE');
  const number=String(body.reservationNumber||'').trim().toUpperCase();
  const reservation=await ReservationV2Model.findOne({reservationNumber:number}).lean().exec();if(!reservation)throw new FittingError('RESERVATION_NOT_FOUND',404);
  // Unique top-level index + the ledger's one-document CAS make a fitting usable once,
  // even when two admins choose different reservations at the same time.
  await ReservationV2Model.collection.createIndex({fittingCreditId:1},{unique:true,partialFilterExpression:{fittingCreditId:{$type:'string'}}});
  if(reservation.fittingCreditId===id)return {ok:true};
  if(reservation.fittingCreditId||!['pending','confirmed','prepared'].includes(reservation.status)||(reservation.status==='pending'&&(!reservation.expiresAt||new Date(reservation.expiresAt)<=now))||reservation.customerSnapshot.email.toLowerCase()!==doc.customer.email)throw new FittingError('CREDIT_RESERVATION_MISMATCH');
  const summary=paymentSummary(reservation);
  if(summary.legacyUnreconciled)throw new FittingError('PAYMENT_LEGACY_RECONCILIATION_REQUIRED');
  if(reservation.subtotal<200)throw new FittingError('CREDIT_BALANCE_TOO_LOW');
  if(await InvoiceModel.exists({sourceKey:'reservation:'+reservation._id}))throw new FittingError('CREDIT_INVOICE_EXISTS');
  const subtotal=reservation.subtotal-200;
  const paymentStatus=summary.rentalNet>=subtotal&&summary.depositHeld>=reservation.deposit?'paid':'unpaid';
  // Unique fittingCreditId prevents reuse across reservations; payment CAS protects
  // against simultaneous payments, discounts and reservation lifecycle changes.
  try{
   const changed=await ReservationV2Model.updateOne({_id:reservation._id,status:reservation.status,paymentStatus:reservation.paymentStatus,
    fittingCreditId:{$exists:false},invoiceIssuedId:{$exists:false},subtotal:reservation.subtotal,
    ...(reservation.paymentRevision===undefined?{paymentRevision:{$exists:false}}:{paymentRevision:reservation.paymentRevision}),
    ...(reservation.status==='pending'?{expiresAt:{$gt:now}}:{})},
    {$set:{fittingCreditId:id,fittingDiscount:{amount:200,number:doc.number,appliedAt:now,appliedBy:actor},subtotal,totalDue:subtotal+reservation.deposit,
     ...(reservation.advanceRequired===undefined?{}:{advanceRequired:Math.min(reservation.advanceRequired,subtotal)}),paymentStatus,
     ...(doc.partner?{partner:doc.partner}:{})},$inc:{paymentRevision:1},$push:{partnerAudit:{action:'fitting_discount_applied',at:now,by:actor,amount:200,reference:doc.number}}}, {runValidators:true}).exec();
   if(!changed.modifiedCount){const current=await ReservationV2Model.findById(reservation._id).lean().exec();if(current?.fittingCreditId===id)return {ok:true};throw new FittingError('PAYMENT_CONFLICT');}
  }catch(e){if((e as any).code===11000)throw new FittingError('FITTING_ALREADY_CREDITED');throw e;}
  return {ok:true};
 }
 if(doc.revision!==body.revision)throw new FittingError('FITTING_CONFLICT');
 let set:any={},unset:any={};
 switch(body.action){
  case 'confirm':if(!['pending','review'].includes(doc.status)||!doc.slotKey||(doc.status==='pending'&&new Date(doc.expiresAt)<=now))throw new FittingError('FITTING_CONFLICT');set={status:'confirmed',paymentStatus:'paid',...(!doc.invoiceAutomation?{invoiceAutomation:{status:'pending',requestedAt:now,requestedBy:actor}}:{})};unset={activeEmail:1};break;
  case 'late-payment':if(!['expired','cancelled'].includes(doc.status)||doc.paymentStatus!=='unpaid')throw new FittingError('FITTING_CONFLICT');set={paymentStatus:'paid'};break;
  case 'complete':if(doc.status!=='confirmed'||new Date(doc.startAt)>now)throw new FittingError('FITTING_CONFLICT');set={status:'completed'};unset={slotKey:1,activeEmail:1};break;
  case 'cancel':if(!['pending','review','confirmed'].includes(doc.status))throw new FittingError('FITTING_CONFLICT');set={status:'cancelled'};unset={slotKey:1,activeEmail:1};break;
  case 'refund':if(!['cancelled','expired'].includes(doc.status)||doc.paymentStatus!=='paid')throw new FittingError('FITTING_CONFLICT');set={paymentStatus:'refunded'};break;
  case 'reschedule':{
   if(doc.status!=='confirmed')throw new FittingError('FITTING_CONFLICT');
   if(body.date===doc.date&&body.time===doc.time)return {ok:true};
   const settings=await getFittingSettings();let slot;try{slot=fittingSlots(body.date,settings,now).find(s=>s.time===body.time);}catch{throw new FittingError('VALIDATION_ERROR',400);}if(!slot)throw new FittingError('SLOT_UNAVAILABLE');
   await expireFittings(now);set={date:body.date,time:body.time,startAt:slot.startAt,slotKey:body.date+'T'+body.time,address:settings.address};break;
  }
  default:throw new FittingError('VALIDATION_ERROR',400);
 }
 try{const changed=await FittingModel.updateOne({_id:doc._id,revision:doc.revision},{$set:set,$unset:unset,$inc:{revision:1},$push:{audit:{action:body.action,at:now,by:actor}}}).exec();if(!changed.modifiedCount)throw new FittingError('FITTING_CONFLICT');}
 catch(e){if((e as any).code===11000)throw new FittingError('SLOT_UNAVAILABLE');throw e;}
 if(body.action==='complete')await notifyFittingDiscount({...doc,...set});
 // Payment confirmation and PDF are sent together by invoice automation.
 if(body.action==='reschedule')await notifyFitting({...doc,...set,revision:doc.revision+1},'rescheduled',undefined,{date:doc.date,time:doc.time});
 return {ok:true};
}
