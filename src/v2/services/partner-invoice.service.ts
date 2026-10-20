import mongoose = require('mongoose');
import Joi = require('joi');
import {randomUUID} from 'crypto';
import {PartnerModel} from '../models/partner.model';
import {PartnerInvoiceModel,PartnerRewardEvent} from '../models/partner-invoice.model';
import {InvoiceCounter} from '../models/invoice.model';
import {reconcilePartnerRewards} from './partner-reward-ledger.service';
import {BOOKING_POLICY,isValidCzechIban} from './booking-policy';
import {invoicePeriod} from './invoice.service';
import {invoicePdf} from './invoice-pdf.service';
import {PaymentError} from './payment.types';
const sendEmail=require('../../../helpers/sendEmail');
export const pragueDay=(d:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(d);
const periodPattern=/^20\d\d-(0[1-9]|1[0-2])$/;
export function monthDates(period:string){
 if(!periodPattern.test(period))throw new PaymentError('VALIDATION_ERROR',400);
 const range=invoicePeriod(period).issuedAt;
 const issuedAt=new Date(range.$lt.getTime()-60000);
 const date=pragueDay(issuedAt),due=new Date(date+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+14);
 return {start:range.$gte,end:range.$lt,issuedAt,dueDate:due.toISOString().slice(0,10)};
}
const settingsSchema=Joi.object({
 revision:Joi.number().integer().min(0).required(),enabled:Joi.boolean().required(),
 name:Joi.string().trim().max(200).required(),address:Joi.string().trim().max(400).required(),ico:Joi.string().pattern(/^\d{8}$/).required(),
 register:Joi.string().max(400).allow('').required(),vatPayer:Joi.boolean().required(),dic:Joi.string().pattern(/^CZ\d{8,10}$/).allow('').required(),
 vatRate:Joi.number().valid(0,12,21).required(),iban:Joi.string().required(),accountNumber:Joi.string().pattern(/^(\d{1,6}-)?\d{2,10}\/\d{4}$/).required(),
 recipientEmail:Joi.string().email({tlds:{allow:false}}).required(),prefix:Joi.string().pattern(/^[A-Z][A-Z0-9]{0,9}$/).required(),
 startPeriod:Joi.string().pattern(periodPattern).required(),consentConfirmed:Joi.boolean().valid(true).required(),
}).unknown(false);
let indexes:Promise<unknown>|undefined;
export const ensurePartnerInvoiceIndexes=()=>indexes??(indexes=Promise.all([PartnerInvoiceModel.createIndexes(),PartnerRewardEvent.createIndexes(),InvoiceCounter.createIndexes()]).catch(e=>{indexes=undefined;throw e;}));
export async function savePartnerBilling(input:unknown,actor:string){
 const {value:v,error}=settingsSchema.validate(input,{convert:false});
 if(error||!isValidCzechIban(v.iban)||v.vatPayer&&(!v.dic||!v.vatRate)||!v.vatPayer&&v.vatRate!==0)throw new PaymentError('VALIDATION_ERROR',400);
 const current=pragueDay(new Date()).slice(0,7);

 await ensurePartnerInvoiceIndexes();const session=await mongoose.startSession();
 try{await session.withTransaction(async()=>{
  const partner:any=await PartnerModel.findById('blaze').session(session).lean();
  if(!partner)throw new PaymentError('NOT_FOUND',404);
  if(!partner.billing?.trackingStartedAt&&v.startPeriod<current)throw new PaymentError('BILLING_START_PERIOD_PAST',400);
  if((partner.billing?.revision||0)!==v.revision)throw new PaymentError('BILLING_CHANGED',409);
  if(partner.billing?.trackingStartedAt&&(partner.billing.startPeriod!==v.startPeriod||partner.billing.prefix!==v.prefix))throw new PaymentError('BILLING_SERIES_LOCKED',409);
  const {revision,...settings}=v;
  const billing={...settings,revision:revision+1,consentBy:actor,consentAt:new Date(),trackingStartedAt:partner.billing?.trackingStartedAt||new Date(),updatedBy:actor};
  await PartnerModel.updateOne({_id:'blaze'},{$set:{billing}},{session});
  await reconcilePartnerRewards(session,monthDates(v.startPeriod).start);
 });}finally{await session.endSession();}
 return {ok:true};
}
export async function partnerInvoiceList(){
 const partner:any=await PartnerModel.findById('blaze').lean();
 const items=await PartnerInvoiceModel.find({partnerId:'blaze'}).sort({period:-1}).limit(120).lean();
 return {settings:partner?.billing||null,items,cronConfigured:Boolean(process.env.CRON_SECRET),trackingError:Boolean(partner?.billing?.trackingError)};
}
export async function closePartnerMonth(period:string,actor='scheduler',now=new Date()){
 const dates=monthDates(period);if(now<dates.end)throw new PaymentError('BILLING_PERIOD_OPEN',409);
 await ensurePartnerInvoiceIndexes();const session=await mongoose.startSession();let result:any;
 try{await session.withTransaction(async()=>{
  const partner:any=await PartnerModel.findById('blaze').session(session).lean(),b=partner?.billing;
  if(!b?.enabled||!b.consentConfirmed)throw new PaymentError('BILLING_NOT_ENABLED',409);
  if(b.trackingError)throw new PaymentError('BILLING_TRACKING_ERROR',409);
  if(period<b.startPeriod)throw new PaymentError('BILLING_BEFORE_START',409);
  const existing=await PartnerInvoiceModel.findOne({partnerId:'blaze',period}).session(session).lean();if(existing){result=existing;return;}
  const priorDate=new Date(dates.start.getTime()-1),priorPeriod=pragueDay(priorDate).slice(0,7);
  const prior:any=await PartnerInvoiceModel.findOne({partnerId:'blaze',period:priorPeriod}).session(session).lean();
  if(period!==b.startPeriod&&!prior)throw new PaymentError('BILLING_PREVIOUS_PERIOD_MISSING',409);
  // Same lock as reward mutations prevents an invoice racing a transactional accrual.
  await PartnerModel.updateOne({_id:'blaze'},{$inc:{billingRevision:1}},{session});
  const events:any[]=await PartnerRewardEvent.find({partnerId:'blaze',at:{$gte:dates.start,$lt:dates.end}}).sort({at:1,_id:1}).session(session).lean();
  const carry=Number(prior?.snapshot?.carry||0);
  const lines=events.map(e=>({description:`${e.amount<0?'Úprava odměny':'Odměna'} — ${e.kind==='rental'?'pronájem':'zkouška'} ${e.number}`,amount:e.amount,eventId:String(e._id),at:e.at,detail:e.detail}));
  if(carry)lines.unshift({description:`Převod záporného zůstatku z ${priorPeriod}`,amount:carry,eventId:'carry',at:dates.start,detail:{}});
  const total=Math.round(lines.reduce((n,l)=>n+l.amount,0)*100)/100;
  const status=total>0?'issued':total<0?'credit':'zero';
  let number:string|undefined;
  if(total>0){const counter:any=await InvoiceCounter.findOneAndUpdate({_id:`partner:blaze:${b.prefix}:${period.slice(0,4)}`},{$inc:{value:1}},{upsert:true,new:true,session});number=`${b.prefix}-${period.slice(0,4)}-${String(counter.value).padStart(4,'0')}`;}
  const net=b.vatPayer?Math.round(total/(1+b.vatRate/100)*100)/100:total;
  const snapshot={company:{name:b.name,address:b.address,ico:b.ico,register:b.register,vatPayer:b.vatPayer,dic:b.dic},bank:{iban:b.iban,accountNumber:b.accountNumber,beneficiary:b.name},buyer:{...BOOKING_POLICY.company,email:b.recipientEmail},period,dueDate:dates.dueDate,lines,total,paid:0,balance:Math.max(0,total),overpayment:0,deposit:0,payments:[],paymentMethod:'bank_transfer',carry:Math.min(0,total),vatRate:b.vatRate,net,vat:Math.round((total-net)*100)/100};
  const docs=await PartnerInvoiceModel.create([{partnerId:'blaze',period,status,...(number?{number}:{}),issuedAt:dates.issuedAt,issuedBy:actor,snapshot,email:{status:total>0?'pending':'not_applicable'}}],{session});result=docs[0].toObject();
 });return result;}finally{await session.endSession();}
}
export async function partnerInvoicePdf(id:string){
 if(!mongoose.isValidObjectId(id))throw new PaymentError('VALIDATION_ERROR',400);
 const doc:any=await PartnerInvoiceModel.findOne({_id:id,partnerId:'blaze'}).lean();
 if(!doc||doc.status!=='issued')throw new PaymentError('NOT_FOUND',404);
 return {doc,pdf:await invoicePdf({...doc,sourceType:'partner',sourceNumber:''})};
}
export async function sendPartnerInvoice(id:string, retry=false, expectedAttemptedAt?:string){
 const {doc,pdf}=await partnerInvoicePdf(id);
 let filter:any={_id:id,'email.status':'pending'};
 if(retry){
  const at=new Date(expectedAttemptedAt||'');
  if(!Number.isFinite(at.getTime())||new Date(doc.email?.attemptedAt).getTime()!==at.getTime()||!['failed','sending'].includes(doc.email?.status))throw new PaymentError('BILLING_EMAIL_CHANGED',409);
  if(doc.email.status==='sending'&&Date.now()-at.getTime()<600000)throw new PaymentError('BILLING_EMAIL_IN_PROGRESS',409);
  filter={_id:id,'email.status':doc.email.status,'email.attemptedAt':at};
 }
 const attemptId=randomUUID(),at=new Date();
 const claim=await PartnerInvoiceModel.updateOne(filter,{$set:{email:{status:'sending',attemptId,attemptedAt:at}}});
 if(!claim.modifiedCount)return {status:doc.email?.status};
 try{
  const text=`Faktura ${doc.number} za odměnu Blaze Photostudio za ${doc.period}.\nCelkem: ${doc.snapshot.total} Kč. Splatnost: ${doc.snapshot.dueDate}.\nRozpis pronájmů a zkoušek je součástí přiložené faktury.`;
  await sendEmail({to:doc.snapshot.buyer.email,subject:`Blaze Photostudio — faktura ${doc.number}`,text,attachments:[{filename:doc.number+'.pdf',content:pdf.toString('base64'),type:'application/pdf',disposition:'attachment'}]});
  await PartnerInvoiceModel.updateOne({_id:id,'email.attemptId':attemptId},{$set:{'email.status':'sent','email.sentAt':new Date()}});return {status:'sent'};
 }catch{await PartnerInvoiceModel.updateOne({_id:id,'email.attemptId':attemptId},{$set:{'email.status':'failed'}});throw new PaymentError('BILLING_EMAIL_UNCERTAIN',502);}
}
export async function runPartnerBilling(now=new Date()){
 const p:any=await PartnerModel.findById('blaze').lean();if(!p?.billing?.enabled)return {status:'disabled'};
 // Catch-up is chronological, bounded, and never creates an open-period invoice.
 await reconcilePartnerRewards();
 const latest=pragueDay(new Date(monthDates(pragueDay(now).slice(0,7)).start.getTime()-1)).slice(0,7);
 const reports:any[]=await PartnerInvoiceModel.find({partnerId:'blaze'}).sort({period:-1}).limit(1).lean();
 let period=reports[0]?pragueDay(monthDates(reports[0].period).end).slice(0,7):p.billing.startPeriod;
 const closed=[];
 for(let i=0;i<12&&period<=latest;i++) {const report=await closePartnerMonth(period,'scheduler',now);closed.push(report.period);period=pragueDay(monthDates(period).end).slice(0,7);}
 const pending:any[]=await PartnerInvoiceModel.find({partnerId:'blaze','email.status':'pending'}).limit(12).lean();
 const failures=[];for(const doc of pending){try{await sendPartnerInvoice(String(doc._id));}catch{failures.push(doc.number);}}
 return {status:'completed',closed,emailFailures:failures};
}
