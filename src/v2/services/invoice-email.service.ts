import {randomUUID} from 'crypto';
import {ReservationV2Model} from '../models/reservation-v2.model';
import {FittingModel} from '../models/fitting.model';
import {InvoiceModel} from '../models/invoice.model';
import {invoicePdf} from './invoice-document.service';
import {paymentMethod} from './invoice-pdf.service';
import {PaymentError} from './payment.types';
const sendEmail=require('../../../helpers/sendEmail');
const {invoiceEmail}=require('../../../helpers/invoiceEmail');
export interface InvoiceSendOptions {retry?:boolean;expectedAttemptedAt?:string;}
export async function sendInvoice(id:string,options:InvoiceSendOptions={}){
 const invoice:any=await InvoiceModel.findById(id).lean();
 if(!invoice)throw new PaymentError('NOT_FOUND',404);
 const email=invoice.email;
 let filter:any={_id:id,$or:[{'email.status':{$exists:false}},{'email.status':'pending'}]};
 if(options.retry){
  const expected=new Date(options.expectedAttemptedAt||'');
  if(!Number.isFinite(expected.getTime())||!email?.attemptedAt||new Date(email.attemptedAt).getTime()!==expected.getTime())throw new PaymentError('INVOICE_EMAIL_CHANGED');
  if(email.status==='sending'&&Date.now()-expected.getTime()<600000)throw new PaymentError('INVOICE_EMAIL_IN_PROGRESS');
  filter={_id:id,'email.attemptedAt':expected,'email.status':email.status};
 }else if(email?.status&&!['pending'].includes(email.status))return {status:email.status};
 const fitting=invoice.sourceType==='fitting'?await FittingModel.findById(invoice.sourceId).select('date time address status paymentStatus').lean():null;
 const reservation=invoice.sourceType==='reservation'?await ReservationV2Model.findById(invoice.sourceId).select('status fulfillmentMethod balikovnaPoint').lean():null;
 // Keep payment and confirmation in one email when payment arrives before approval.
 if(invoice.automatic && reservation?.status==='pending')return {status:'pending'};
 const message=invoiceEmail(invoice,fitting,reservation,paymentMethod(invoice));
 let pdf:Buffer;try{pdf=await invoicePdf(invoice);}catch{throw new PaymentError('INVOICE_PDF_FAILED',503);}
 // The claim survives provider timeouts. Never retry an ambiguous send automatically.
 const attemptId=randomUUID(),attemptedAt=new Date(Math.max(Date.now(),new Date(email?.attemptedAt||0).getTime()+1));
 const claimed=await InvoiceModel.updateOne(filter,{$set:{email:{status:'sending',attemptedAt,attemptId}}});
 if(!claimed.modifiedCount){if(options.retry)throw new PaymentError('INVOICE_EMAIL_CHANGED');return {status:'sending'};}
 try{
  await sendEmail({...message,attachments:[{filename:`${invoice.number}.pdf`,content:pdf.toString('base64'),type:'application/pdf',disposition:'attachment'}]});
  await InvoiceModel.updateOne({_id:id,'email.attemptId':attemptId},{$set:{'email.status':'sent','email.sentAt':new Date()}});
  return {status:'sent'};
 }catch{
  await InvoiceModel.updateOne({_id:id,'email.attemptId':attemptId},{$set:{'email.status':'failed'}});
  throw new PaymentError('INVOICE_EMAIL_UNCERTAIN',502);
 }
}
