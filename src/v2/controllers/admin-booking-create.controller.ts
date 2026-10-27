import {Types} from 'mongoose';
import type {HttpHandler} from '../types/http';
import {ProductV2Model,VariantV2Model} from '../models';
import {reservationService} from '../services/reservation.service';
import {validateReservationRequestBody} from '../schemas/reservation.schema';
import {mapReservationApiError} from '../http/error-mapper';
import {createFitting,FittingError} from '../services/fitting.service';
import {resolveBookingPartner} from '../services/partner-referral.service';
import {hashIdempotencyKey,hashReservationFingerprint,deriveIdempotentGuestAccessToken,isCanonicalUuidV4} from '../utils/idempotency';

export function adminBookingCreate(action:'catalogue'|'reservation'|'fitting'):HttpHandler {
 return async(req,res,next)=>{
  res.setHeader?.('Cache-Control','private, no-store');
  try {
   if(!req.authenticatedUserId)return res.status(401).json({error:{code:'ADMIN_UNAUTHORIZED'}});
   const actor=(req.adminOwner?'owner:':'admin:')+req.authenticatedUserId.toHexString();
   if(action==='catalogue'){
    const products=await ProductV2Model.find({status:'active',rentalEnabled:true}).select('name').sort({name:1}).lean();
    const variants=await VariantV2Model.find({productId:{$in:products.map(p=>p._id)},status:'active'}).select('productId size').lean();
    return res.status(200).json({items:products.map(p=>({id:String(p._id),name:p.name,variants:variants.filter(v=>v.productId.equals(p._id)).map(v=>({id:String(v._id),size:v.size}))}))});
   }
   const partner=await resolveBookingPartner();
   if(action==='fitting')return res.status(201).json(await createFitting(req.body,new Date(),undefined,partner,actor));
   const key=req.headers['idempotency-key'];
   if(typeof key!=='string'||!isCanonicalUuidV4(key))return res.status(400).json({error:{code:'INVALID_IDEMPOTENCY_KEY'}});
   const parsed=validateReservationRequestBody(req.body);
   if(!parsed.value)return res.status(400).json({error:{code:'VALIDATION_ERROR'}});
   const v=parsed.value;
   const result=await reservationService.createReservation({
    productId:new Types.ObjectId(v.productId),variantId:new Types.ObjectId(v.variantId),
    ...(v.items?{items:v.items.map(i=>({productId:new Types.ObjectId(i.productId),variantId:new Types.ObjectId(i.variantId)}))}:{}),
    fulfillmentMethod:v.fulfillmentMethod,balikovnaPoint:v.balikovnaPoint,rentalMode:v.rentalMode,startDate:v.startDate,endDate:v.endDate,customer:v.customer,notes:v.notes,partner,auditActor:actor,
   },{idempotency:{keyHash:hashIdempotencyKey(key),requestHash:hashReservationFingerprint({...v,authenticatedUserId:actor}),guestAccessToken:deriveIdempotentGuestAccessToken(key)}});
   return res.status(result.replayed?200:201).json({id:String(result.reservation._id),reservationNumber:result.reservation.reservationNumber});
  }catch(e){
   if(e instanceof FittingError)return res.status(e.status).json({error:{code:e.code}});
   if(action==='reservation'){const mapped=mapReservationApiError(e);return res.status(mapped.status).json(mapped.body);}
   return next(e);
  }
 };
}
