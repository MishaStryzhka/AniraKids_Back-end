import type {HttpHandler} from '../types/http';
import {getFittingSettings,saveFittingSettings,parseFittingSettings} from '../services/fitting-settings.service';
import {FittingError,availableFittingSlots,createFitting,readFitting,reportFittingPayment,cancelPublicFitting,adminFittings,actOnFitting} from '../services/fitting.service';
import {PaymentError} from '../services/payment.types';
export function fittingHandler(action:string):HttpHandler{return async(req,res,next)=>{
 try{
  res.setHeader?.('Cache-Control','no-store');
  const number=req.params?.number||'',authorization=req.headers.authorization;
  const token=typeof authorization==='string'&&authorization.startsWith('Bearer ')?authorization.slice(7):'';
  let result:unknown;
  switch(action){
   case 'settings':result=await getFittingSettings();break;
   case 'save-settings':{const settings=parseFittingSettings(req.body);if(!settings)throw new FittingError('VALIDATION_ERROR',400);result=await saveFittingSettings(settings);break;}
   case 'slots':result=await availableFittingSlots(String(req.query?.date||''));break;
   case 'create':result=await createFitting(req.body,new Date(),req.authenticatedUserId);break;
   case 'read':result=await readFitting(number,token);break;
   case 'report':result=await reportFittingPayment(number,token);break;
   case 'cancel':result=await cancelPublicFitting(number,token);break;
   case 'list':result=await adminFittings(String(req.query?.from||''),String(req.query?.to||''));break;
   case 'act':if(!req.authenticatedUserId)throw new FittingError('ADMIN_UNAUTHORIZED',401);result=await actOnFitting(req.params?.fittingId||'',req.body,req.authenticatedUserId.toHexString());break;
  }
  return res.status(200).json(result);
 }catch(e){if(e instanceof FittingError||e instanceof PaymentError)return res.status(e.status).json({error:{code:e.code,message:e.code}});return next(e);}
};}
