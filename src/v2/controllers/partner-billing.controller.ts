import {timingSafeEqual} from 'crypto';
import type {HttpHandler} from '../types/http';
import {runPartnerBilling} from '../services/partner-invoice.service';
import {PartnerModel} from '../models/partner.model';
export const authorizeBillingCron:HttpHandler=(req,res,next)=>{
 const secret=process.env.CRON_SECRET,actual=req.headers.authorization;
 const expected=secret?'Bearer '+secret:'';
 if(!secret||typeof actual!=='string'||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.status(401).json({error:{code:'UNAUTHORIZED'}});
 return next();
};
export const partnerBillingCron:HttpHandler=async(_req,res)=>{
 res.setHeader?.('Cache-Control','no-store');
 try{const result=await runPartnerBilling();await PartnerModel.updateOne({_id:'blaze'},{$set:{'billing.lastRunAt':new Date()},$unset:{'billing.lastError':1}});return res.status(200).json(result);}
 catch{await PartnerModel.updateOne({_id:'blaze'},{$set:{'billing.lastRunAt':new Date(),'billing.lastError':'BILLING_RUN_FAILED'}}).catch(()=>undefined);return res.status(503).json({error:{code:'BILLING_RUN_FAILED'}});}
};
