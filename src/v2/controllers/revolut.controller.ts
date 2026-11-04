import type { HttpHandler } from '../types/http';
import { ReservationV2Model } from '../models/reservation-v2.model';
import { reservationAccess } from './reservation-status.controller';
import { PaymentError } from '../services/payment.types';
import { revolutConfiguration, verifyRevolutSignature } from '../services/revolut-client';
import { createCardOrder, reconcileCardOrder, cancelCardOrder } from '../services/revolut.service';
import { toPublicReservationResponse } from '../http/reservation-response';

export const revolutConfig:HttpHandler=(_req,res)=>{
  res.setHeader?.('Cache-Control','no-store');
  return res.status(200).json(revolutConfiguration());
};
export function revolutReservation(action:'create'|'sync'|'cancel'):HttpHandler {
  return async(req,res,next)=>{
    res.setHeader?.('Cache-Control','private, no-store');res.setHeader?.('Vary','Authorization');
    try{
      const number=req.params?.reservationNumber;
      const access=await reservationAccess(req.headers.authorization);
      if(!access || !number || !/^AK-\d{4}-[A-Z0-9]{6}$/.test(number))throw new PaymentError('RESERVATION_NOT_FOUND',404);
      const r=await ReservationV2Model.findOne({reservationNumber:number,...access.filter}).lean().exec();
      if(!r)throw new PaymentError('RESERVATION_NOT_FOUND',404);
      if(action==='create'){
        const body=req.body as {kind?:unknown}|undefined;
        if(!body || !['advance','full'].includes(String(body.kind)) || Object.keys(body).some(k=>k!=='kind'))throw new PaymentError('VALIDATION_ERROR',400);
        return res.status(200).json(await createCardOrder(r,body.kind as 'advance'|'full'));
      }
      if(action==='cancel')await cancelCardOrder(r);
      else {
        const attempt=r.revolutAttempts?.find(a=>a.id===r.revolutActiveAttempt) ??
          (r.status==='pending' ? r.revolutAttempts?.find(a=>a.state==='completed' && !a.reviewRequired) : undefined);
        if(attempt?.orderId)await reconcileCardOrder(attempt.orderId);
      }
      const current=await ReservationV2Model.findById(r._id).lean().exec();
      return res.status(200).json(toPublicReservationResponse(current!));
    }catch(e){if(e instanceof PaymentError)return res.status(e.status).json({error:{code:e.code,message:e.message}});return next(e);}
  };
}
export const requireRevolutSignature:HttpHandler=(req,res,next)=>{
  if(!verifyRevolutSignature(req.rawBody,req.headers['revolut-request-timestamp'],req.headers['revolut-signature']))
    return res.status(401).json({error:{code:'INVALID_SIGNATURE'}});
  return next();
};
export const revolutWebhook:HttpHandler=async(req,res,next)=>{
  if(!verifyRevolutSignature(req.rawBody,req.headers['revolut-request-timestamp'],req.headers['revolut-signature']))
    return res.status(401).json({error:{code:'INVALID_SIGNATURE'}});
  try{
    const body=req.body as {event?:unknown;order_id?:unknown};
    if(!body || typeof body.event!=='string' || typeof body.order_id!=='string')return res.status(400).json({error:{code:'VALIDATION_ERROR'}});
    if(['ORDER_COMPLETED','ORDER_CANCELLED','ORDER_FAILED','ORDER_AUTHORISED'].includes(body.event))await reconcileCardOrder(body.order_id);
    return res.status(200).json({received:true});
  }catch(e){if(e instanceof PaymentError)return res.status(e.status).json({error:{code:e.code}});return next(e);}
};
