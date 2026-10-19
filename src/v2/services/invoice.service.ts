import mongoose = require('mongoose');
import {createHash} from 'crypto';
import {InvoiceModel, InvoiceCounter} from '../models/invoice.model';
import {FittingModel} from '../models/fitting.model';
import {ReservationV2Model} from '../models/reservation-v2.model';
import {BOOKING_POLICY} from './booking-policy';
import {paymentSummary} from './payment.service';
import {PaymentError} from './payment.types';
import Joi = require('joi');
const inputSchema=Joi.object({type:Joi.string().valid('fitting','reservation').required(),number:Joi.string().trim().max(80).required(),buyerName:Joi.string().trim().max(200).required(),buyerAddress:Joi.string().trim().max(400).required(),buyerIco:Joi.string().pattern(/^\d{8}$/).allow(''),fingerprint:Joi.string().hex().length(64)}).unknown(false);
export function parseInvoiceInput(body:unknown){const {value,error}=inputSchema.validate(body,{convert:false});if(error)throw new PaymentError('VALIDATION_ERROR',400);return value;}
const day=(date:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(date);
export async function invoicePreview(input:any,session?:mongoose.ClientSession,automatic=false){
 const fitting=input.type==='fitting';
 const source:any=await (fitting?FittingModel.findOne({number:input.number}):ReservationV2Model.findOne({reservationNumber:input.number})).session(session??null).lean();
 if(!source)throw new PaymentError('INVOICE_SOURCE_NOT_FOUND',404);
 if(!automatic && (fitting?source.status!=='completed':source.status!=='returned'))throw new PaymentError('INVOICE_SERVICE_NOT_COMPLETED');
 const summary=fitting?null:paymentSummary(source);
 if((!fitting&&source.fittingCreditId&&!source.fittingDiscount)||summary?.legacyUnreconciled)throw new PaymentError('INVOICE_PAYMENTS_UNRECONCILED');
 if(automatic && (fitting?source.paymentStatus!=='paid'||!['confirmed','completed'].includes(source.status):source.status==='cancelled'||!summary||summary.rentalNet<=0))throw new PaymentError('INVOICE_AUTOMATION_NOT_ELIGIBLE');
 const total=fitting?200:source.subtotal;
 const paid=fitting?(source.paymentStatus==='paid'?200:0):summary!.rentalNet;
 const lines=fitting?[{description:'Osobní zkouška šatů',amount:200}]:source.items.map((i:any)=>({description:`Pronájem: ${i.productNameSnapshot} (${i.sizeSnapshot})`,amount:i.rentalPriceSnapshot}));
 if(!fitting&&source.fittingDiscount)lines.push({description:`Započtená platba za zkoušku ${source.fittingDiscount.number}`,amount:-source.fittingDiscount.amount});
 if(lines.reduce((n:number,l:any)=>n+l.amount,0)!==total)throw new PaymentError('INVOICE_TOTAL_MISMATCH');
 const completion=fitting?source.audit?.filter((a:any)=>a.action==='complete').slice(-1)[0]?.at:source.partnerAudit?.filter((a:any)=>a.action==='return').slice(-1)[0]?.at;
 const receiptDate=fitting?source.audit?.filter((a:any)=>a.action==='confirm').slice(-1)[0]?.at:summary?.entries.filter(e=>['advance_received','rental_received'].includes(e.type)).slice(-1)[0]?.recordedAt;
 const buyerName=automatic?(fitting?source.customer.name:[source.customerSnapshot.firstName,source.customerSnapshot.lastName].filter(Boolean).join(' ')):input.buyerName;
 const buyerEmail=fitting?source.customer.email:source.customerSnapshot.email;
 if(automatic&&(!buyerName||!buyerEmail||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)))throw new PaymentError('INVOICE_CUSTOMER_INCOMPLETE');
 const snapshot={...(automatic?{serviceDatePlanned:fitting?source.status!=='completed':source.status!=='returned',...(receiptDate?{accountingDate:day(new Date(receiptDate))}:{})}:{}),company:BOOKING_POLICY.company,bank:BOOKING_POLICY.bank,currency:'CZK',buyer:{name:buyerName,address:automatic?'':input.buyerAddress,ico:automatic?'':input.buyerIco||'',email:buyerEmail},serviceDate:fitting?source.date:day(new Date(completion??source.endDate)),period:fitting?source.date:`${day(new Date(source.startDate))} – ${day(new Date(source.endDate))}`,lines,total,paid,balance:Math.max(0,total-paid),overpayment:Math.max(0,paid-total),deposit:fitting?0:summary!.depositHeld,payments:fitting?source.audit:summary!.entries,sourcePaymentStatus:source.paymentStatus,completedAt:completion??null};
 const sourceKey=`${input.type}:${source._id}`;
 const fingerprint=createHash('sha256').update(JSON.stringify({sourceKey,snapshot,revision:source.revision??source.paymentRevision,updatedAt:source.updatedAt})).digest('hex');
 return {sourceKey,sourceId:String(source._id),sourceNumber:input.number,sourceType:input.type,snapshot,fingerprint};
}
let indexes:Promise<unknown>|undefined;
const ensureIndexes=()=>indexes??(indexes=Promise.all([InvoiceModel.createIndexes(),InvoiceCounter.createIndexes()]).catch(error=>{indexes=undefined;throw error;}));
export async function issueInvoice(input:any,actor:string){
 await ensureIndexes();
 // Unique source key and counter increment commit together: retries do not consume numbers.
 const session=await mongoose.startSession();let result:any;
 try{await session.withTransaction(async()=>{
  const preview=await invoicePreview(input,session);
  const existing=await InvoiceModel.findOne({sourceKey:preview.sourceKey}).session(session).lean();
  if(existing){result=existing;return;}
  if(input.fingerprint!==preview.fingerprint)throw new PaymentError('INVOICE_PREVIEW_CHANGED');
  const sourceModel:any=input.type==='fitting'?FittingModel:ReservationV2Model;
  await sourceModel.updateOne({_id:preview.sourceId},{$set:{updatedAt:new Date()}},{session});
  const now=new Date(),year=day(now).slice(0,4);
  const counter:any=await InvoiceCounter.findOneAndUpdate({_id:year},{$inc:{value:1}},{upsert:true,new:true,session});
  const {fingerprint,...data}=preview;
  const docs=await InvoiceModel.create([{...data,number:`${year}-${String(counter.value).padStart(4,'0')}`,issuedAt:now,issuedBy:actor}],{session});result=docs[0].toObject();
  if(input.type==='reservation')await ReservationV2Model.updateOne({_id:preview.sourceId},{$set:{invoiceIssuedId:String(result._id)}},{session});
 });return result;}finally{await session.endSession();}
}
export async function issueAutomaticInvoice(type:'fitting'|'reservation',id:string){
 await ensureIndexes();
 const session=await mongoose.startSession();let result:any;
 try{await session.withTransaction(async()=>{
  const sourceModel:any=type==='fitting'?FittingModel:ReservationV2Model;
  const source:any=await sourceModel.findById(id).session(session).lean();
  if(!source?.invoiceAutomation)throw new PaymentError('INVOICE_AUTOMATION_NOT_QUEUED');
  const sourceKey=`${type}:${id}`;
  const existing=await InvoiceModel.findOne({sourceKey}).session(session).lean();
  if(existing){result=existing;await sourceModel.updateOne({_id:id},{$set:{'invoiceAutomation.status':'issued',...(type==='reservation'?{invoiceIssuedId:String(existing._id)}:{})},$unset:{'invoiceAutomation.errorCode':1}},{session});return;}
  const preview=await invoicePreview({type,number:type==='fitting'?source.number:source.reservationNumber},session,true);
  const now=new Date(),year=day(now).slice(0,4);
  // This source write serializes issuance against payments, refunds and discount changes.
  await sourceModel.updateOne({_id:id},{$set:{'invoiceAutomation.status':'issued'},$unset:{'invoiceAutomation.errorCode':1}},{session});
  const counter:any=await InvoiceCounter.findOneAndUpdate({_id:year},{$inc:{value:1}},{upsert:true,new:true,session});
  const {fingerprint,...data}=preview;
  const docs=await InvoiceModel.create([{...data,number:`${year}-${String(counter.value).padStart(4,'0')}`,issuedAt:now,issuedBy:source.invoiceAutomation.requestedBy,automatic:true,email:{status:'pending'}}],{session});
  result=docs[0].toObject();
  if(type==='reservation')await ReservationV2Model.updateOne({_id:id},{$set:{invoiceIssuedId:String(result._id)}},{session});
 });return result;}finally{await session.endSession();}
}
export async function correctInvoice(id:string,reason:string,actor:string){
 await ensureIndexes();
 if(!mongoose.isValidObjectId(id)||typeof reason!=='string'||reason.trim().length<5||reason.length>500)throw new PaymentError('VALIDATION_ERROR',400);
 const session=await mongoose.startSession();let result:any;
 try{await session.withTransaction(async()=>{
  const original:any=await InvoiceModel.findById(id).session(session).lean();
  if(!original)throw new PaymentError('NOT_FOUND',404);
  if(original.sourceType==='correction')throw new PaymentError('INVOICE_ALREADY_CORRECTION');
  const sourceKey=`correction:${id}`,existing=await InvoiceModel.findOne({sourceKey}).session(session).lean();if(existing){result=existing;return;}
  const now=new Date(),year=day(now).slice(0,4),counter:any=await InvoiceCounter.findOneAndUpdate({_id:year},{$inc:{value:1}},{upsert:true,new:true,session});
  const snapshot={...original.snapshot,originalNumber:original.number,reason:reason.trim(),lines:original.snapshot.lines.map((l:any)=>({...l,amount:-l.amount})),total:-original.snapshot.total,paid:0,balance:0,overpayment:0,deposit:0,payments:[]};
  const docs=await InvoiceModel.create([{number:`${year}-${String(counter.value).padStart(4,'0')}`,sourceKey,sourceType:'correction',sourceId:id,sourceNumber:original.sourceNumber,issuedAt:now,issuedBy:actor,snapshot}],{session});result=docs[0].toObject();
 });return result;}finally{await session.endSession();}
}
export function invoicePeriod(value:unknown){if(typeof value!=='string'||!/^20\d{2}(-(0[1-9]|1[0-2]))?$/.test(value))throw new PaymentError('VALIDATION_ERROR',400);const start=new Date(value.length===4?`${value}-01-01T00:00:00Z`:`${value}-01T00:00:00Z`),end=new Date(start);if(value.length===4)end.setUTCFullYear(end.getUTCFullYear()+1);else end.setUTCMonth(end.getUTCMonth()+1); // Prague midnight is UTC-1 in winter and UTC-2 in summer.
 const localMidnight=(d:Date)=>{const offset=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Prague',hour:'numeric',hourCycle:'h23'}).format(d));return new Date(d.getTime()-offset*3600000);};return {issuedAt:{$gte:localMidnight(start),$lt:localMidnight(end)}};}
export async function listInvoices(period:unknown){const items=await InvoiceModel.find(invoicePeriod(period)).sort({number:1}).limit(2001).lean();if(items.length>2000)throw new PaymentError('INVOICE_PERIOD_TOO_LARGE',400);return items;}
