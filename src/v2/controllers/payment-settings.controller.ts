import type {HttpHandler} from '../types/http';
import {getPaymentSettings,savePaymentSettings} from '../services/payment-settings.service';
import {PaymentError} from '../services/payment.types';
export const paymentSettings=(write=false):HttpHandler=>async(req,res,next)=>{
 res.setHeader?.('Cache-Control','private, no-store');
 try{return res.status(200).json(write?await savePaymentSettings(req.body,req.authenticatedUserId!.toHexString()):await getPaymentSettings());}
 catch(e){if(e instanceof PaymentError)return res.status(e.status).json({error:{code:e.code}});return next(e);}
};
