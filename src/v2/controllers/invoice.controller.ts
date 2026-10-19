import mongoose = require('mongoose');
import type {HttpHandler} from '../types/http';
import {PaymentError} from '../services/payment.types';
import {parseInvoiceInput,invoicePreview,issueInvoice,listInvoices,correctInvoice} from '../services/invoice.service';
import {InvoiceModel} from '../models/invoice.model';
import {invoicePdf,invoiceArchive} from '../services/invoice-document.service';
const sendEmail=require('../../../helpers/sendEmail');
export const invoiceHandler=(action:'list'|'preview'|'issue'|'pdf'|'export'|'send'|'correct'):HttpHandler=>async(req,res,next)=>{
 try{
  res.setHeader?.('Cache-Control','no-store');
  // Accounting documents expose both rental and fitting data; owner-only until a separate accounting role exists.
  if(!req.adminOwner)throw new PaymentError('ADMIN_FORBIDDEN',403);
  if(action==='preview')return res.status(200).json(await invoicePreview(parseInvoiceInput(req.body)));
  if(action==='issue')return res.status(200).json({invoice:await issueInvoice(parseInvoiceInput(req.body),String(req.authenticatedUserId))});
  if(action==='list')return res.status(200).json({items:await listInvoices(req.query?.period)});
  const binary=(data:Buffer,type:string,name:string)=>{res.setHeader?.('Content-Type',type);res.setHeader?.('Content-Disposition',`attachment; filename="${name}"`);return (res as typeof res & {send:(data:Buffer)=>unknown}).send(data);};
  if(action==='export')return binary(await invoiceArchive(await listInvoices(req.query?.period),String(req.query?.period)),'application/zip',`faktury-${req.query?.period}.zip`);
  if(!mongoose.isValidObjectId(req.params?.invoiceId))throw new PaymentError('VALIDATION_ERROR',400);
  if(action==='correct')return res.status(200).json({invoice:await correctInvoice(req.params!.invoiceId!, (req.body as any)?.reason,String(req.authenticatedUserId))});
  const invoice:any=await InvoiceModel.findById(req.params!.invoiceId).lean();if(!invoice)throw new PaymentError('NOT_FOUND',404);
  if(action==='pdf')return binary(await invoicePdf(invoice),'application/pdf',`${invoice.number}.pdf`);
  const pdf=await invoicePdf(invoice);
  const claimed=await InvoiceModel.updateOne({_id:invoice._id,'email.status':{$exists:false}},{$set:{email:{status:'sending',attemptedAt:new Date()}}});
  if(!claimed.modifiedCount)throw new PaymentError('INVOICE_EMAIL_ALREADY_ATTEMPTED');
  try{await sendEmail({to:invoice.snapshot.buyer.email,subject:`Faktura ${invoice.number} – GlamGarb Rentals`,text:`Dobrý den,\nv příloze zasíláme doklad ${invoice.number} k rezervaci / zkoušce ${invoice.sourceNumber}.\nGlamGarb Rentals s.r.o.`,attachments:[{filename:`${invoice.number}.pdf`,content:pdf.toString('base64'),type:'application/pdf',disposition:'attachment'}]});
   await InvoiceModel.updateOne({_id:invoice._id},{$set:{'email.status':'sent','email.sentAt':new Date()}});
  }catch(_error){await InvoiceModel.updateOne({_id:invoice._id},{$set:{'email.status':'failed'}});throw new PaymentError('INVOICE_EMAIL_UNCERTAIN',502);}
  return res.status(200).json({sent:true});
 }catch(error){if(error instanceof PaymentError)return res.status(error.status).json({error:{code:error.code}});return next(error);}
};
