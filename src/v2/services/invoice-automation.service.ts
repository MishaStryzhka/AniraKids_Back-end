import {FittingModel} from '../models/fitting.model';
import {ReservationV2Model} from '../models/reservation-v2.model';
import {InvoiceModel} from '../models/invoice.model';
import {issueAutomaticInvoice,invoicePreview} from './invoice.service';
import {sendInvoice} from './invoice-email.service';
import {PaymentError} from './payment.types';
export type InvoiceSource='fitting'|'reservation';
const sourceModel=(type:InvoiceSource):any=>type==='fitting'?FittingModel:ReservationV2Model;
// Payment confirmation is already committed. A PDF/provider failure must never
// turn that successful payment into an apparent failure or cause another charge.
export async function processAutomaticInvoice(type:InvoiceSource,id:string){
 let invoice:any;
 try{
  const model=sourceModel(type),source=await model.findById(id).select('invoiceAutomation').lean();
  if(!source?.invoiceAutomation)return {status:'not_queued'};
  invoice=await issueAutomaticInvoice(type,id);
 }catch(error){
  const errorCode=error instanceof PaymentError?error.code:'INVOICE_AUTOMATION_FAILED';
  try{await sourceModel(type).updateOne({_id:id,'invoiceAutomation.status':{$ne:'issued'}},{$set:{'invoiceAutomation.status':'pending','invoiceAutomation.errorCode':errorCode}});}catch{}
  console.warn('INVOICE_AUTOMATION_PENDING',type,id,errorCode);return {status:'pending',errorCode};
 }
 try{const email=await sendInvoice(String(invoice._id));return {status:'issued',number:invoice.number,emailStatus:email.status};}
 catch(error){return {status:'issued',number:invoice.number,emailStatus:error instanceof PaymentError&&error.code==='INVOICE_EMAIL_UNCERTAIN'?'failed':'pending'};}
}
export async function requestAutomaticInvoice(body:any,actor:string){
 if(!body||!['fitting','reservation'].includes(body.type)||typeof body.number!=='string'||body.number.length>80||Object.keys(body).some(k=>!['type','number'].includes(k)))throw new PaymentError('VALIDATION_ERROR',400);
 const type:InvoiceSource=body.type,model=sourceModel(type),source=await model.findOne(type==='fitting'?{number:body.number.trim()}:{reservationNumber:body.number.trim()}).lean();
 if(!source)throw new PaymentError('INVOICE_SOURCE_NOT_FOUND',404);
 // An explicit owner action can recover a historical confirmed payment. No bulk backfill.
 const existing=await InvoiceModel.exists({sourceKey:`${type}:${source._id}`});
 if(!existing)await invoicePreview({type,number:body.number.trim()},undefined,true);
 await model.updateOne({_id:source._id,'invoiceAutomation.status':{$exists:false}},{$set:{invoiceAutomation:{status:'pending',requestedAt:new Date(),requestedBy:actor}}});
 return processAutomaticInvoice(type,String(source._id));
}
export async function pendingAutomaticInvoices(){
 const results=await Promise.all((['fitting','reservation'] as const).map(async type=>{
  const docs:any[]=await sourceModel(type).find({'invoiceAutomation.status':'pending'}).select('number reservationNumber invoiceAutomation').sort({'invoiceAutomation.requestedAt':1}).limit(100).lean();
  return docs.map(d=>({type,number:type==='fitting'?d.number:d.reservationNumber,errorCode:d.invoiceAutomation.errorCode||null}));
 }));
 return {items:results.flat()};
}
