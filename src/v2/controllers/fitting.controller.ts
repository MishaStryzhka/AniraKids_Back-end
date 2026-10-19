import {processAutomaticInvoice} from '../services/invoice-automation.service';
import type {HttpHandler} from '../types/http';
import {resolveBookingPartner,PartnerError} from '../services/partner-referral.service';
import {getFittingSettings,saveFittingSettings,parseFittingSettings} from '../services/fitting-settings.service';
import {FittingError,availableFittingSlots,createFitting,readFitting,reportFittingPayment,cancelPublicFitting,adminFittings,actOnFitting,fittingDiscountOptions} from '../services/fitting.service';
import {PaymentError} from '../services/payment.types';
export function fittingHandler(action:string):HttpHandler{return async(req,res,next)=>{
 try{
  res.setHeader?.('Cache-Control','no-store');
  const number=req.params?.number||'',authorization=req.headers.authorization;
  const token=typeof authorization==='string'&&authorization.startsWith('Bearer ')?authorization.slice(7):'';
  let result:unknown;
  if(action==='act'&&(req.body as any)?.action==='credit'&&!req.adminOwner&&!req.adminPermissions?.includes('reservations'))return res.status(403).json({error:{code:'ADMIN_FORBIDDEN',message:'Reservation access required'}});
  switch(action){
   case 'settings':result=await getFittingSettings();break;
   case 'save-settings':{const settings=parseFittingSettings(req.body);if(!settings)throw new FittingError('VALIDATION_ERROR',400);result=await saveFittingSettings(settings);break;}
   case 'slots':result=await availableFittingSlots(String(req.query?.date||''));break;
   case 'create':{const {referralToken,...body}=(req.body||{}) as any;result=await createFitting(body,new Date(),req.authenticatedUserId,await resolveBookingPartner(referralToken));break;}
   case 'read':result=await readFitting(number,token);break;
   case 'report':result=await reportFittingPayment(number,token);break;
   case 'cancel':result=await cancelPublicFitting(number,token);break;
   case 'discount-options':result=await fittingDiscountOptions(req.params?.reservationId||'');break;
   case 'list':result=await adminFittings(String(req.query?.from||''),String(req.query?.to||''));break;
   case 'act':if(!req.authenticatedUserId)throw new FittingError('ADMIN_UNAUTHORIZED',401);result=await actOnFitting(req.params?.fittingId||'',req.body,req.authenticatedUserId.toHexString());break;
  }
  if(action==='act'&&(req.body as any)?.action==='confirm'){const invoiceAutomation=await processAutomaticInvoice('fitting',req.params!.fittingId!);result={...(result as object),invoiceAutomation};}
  return res.status(200).json(result);
 }catch(e){if(e instanceof FittingError||e instanceof PaymentError||e instanceof PartnerError)return res.status(e.status).json({error:{code:e.code,message:e.code}});return next(e);}
};}
