import {randomUUID} from 'crypto';
import {InvoiceModel} from '../models/invoice.model';
import {invoicePdf} from './invoice-document.service';
import {PaymentError} from './payment.types';
const sendEmail=require('../../../helpers/sendEmail');
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
 let pdf:Buffer;try{pdf=await invoicePdf(invoice);}catch{throw new PaymentError('INVOICE_PDF_FAILED',503);}
 // The claim survives provider timeouts. Never retry an ambiguous send automatically.
 const attemptId=randomUUID(),attemptedAt=new Date(Math.max(Date.now(),new Date(email?.attemptedAt||0).getTime()+1));
 const claimed=await InvoiceModel.updateOne(filter,{$set:{email:{status:'sending',attemptedAt,attemptId}}});
 if(!claimed.modifiedCount){if(options.retry)throw new PaymentError('INVOICE_EMAIL_CHANGED');return {status:'sending'};}
 const s=invoice.snapshot,cs=(n:number)=>new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK'}).format(n);
 try{
  await sendEmail({to:s.buyer.email,subject:`Faktura ${invoice.number} – GlamGarb Rentals`,text:`Dobrý den,\n\nv příloze zasíláme ${invoice.sourceType==='correction'?'opravný doklad':'fakturu'} ${invoice.number} k ${invoice.sourceType==='fitting'?'zkoušce':'rezervaci'} ${invoice.sourceNumber}.\nCena služby: ${cs(s.total)}.\n${invoice.sourceType==='correction'?'Doklad sám nepotvrzuje vrácení peněz.':`Uhrazeno při vystavení: ${cs(s.paid)}. Zbývalo uhradit: ${cs(s.balance)}.\nVratná kauce není součástí ceny služby. Další platby se evidují u rezervace; údaje této faktury zachycují stav při vystavení.`}\n\nDěkujeme,\nANIRAK · GlamGarb Rentals s.r.o.`,attachments:[{filename:`${invoice.number}.pdf`,content:pdf.toString('base64'),type:'application/pdf',disposition:'attachment'}]});
  await InvoiceModel.updateOne({_id:id,'email.attemptId':attemptId},{$set:{'email.status':'sent','email.sentAt':new Date()}});
  return {status:'sent'};
 }catch{
  await InvoiceModel.updateOne({_id:id,'email.attemptId':attemptId},{$set:{'email.status':'failed'}});
  throw new PaymentError('INVOICE_EMAIL_UNCERTAIN',502);
 }
}
