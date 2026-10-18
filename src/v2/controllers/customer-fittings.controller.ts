import {createHash} from 'crypto';
import {notifyOwnerFittingPaymentReported} from '../services/admin-push.service';
import {authenticateLegacyBearer,parseBearerAuthorization} from '../auth/legacy-bearer';
import {FittingModel} from '../models/fitting.model';
import {expireFittings,FittingError,publicFitting} from '../services/fitting.service';
import type {HttpHandler} from '../types/http';

/** Account identity comes only from a verified session, never from contact email. */
export function customerFittingHandler(action:'list'|'read'|'claim'|'report'|'cancel'):HttpHandler {
 return async(req,res,next)=>{
  res.setHeader?.('Cache-Control','private, no-store');
  res.setHeader?.('Vary','Authorization');
  try {
   const bearer=parseBearerAuthorization(req.headers.authorization);
   const identity=bearer.kind==='bearer'?await authenticateLegacyBearer(bearer.token):null;
   if(!identity)throw new FittingError('UNAUTHORIZED',401);
   const customerId=identity.userId,now=new Date();
   await expireFittings(now);
   if(action==='list'){
    const raw=req.query?.page??'1';
    if(typeof raw!=='string'||!/^\d{1,5}$/.test(raw)||Number(raw)<1)throw new FittingError('VALIDATION_ERROR',400);
    const page=Number(raw),limit=20;
    const [records,total]=await Promise.all([
     FittingModel.find({customerId}).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean().exec(),
     FittingModel.countDocuments({customerId}).exec(),
    ]);
    return res.status(200).json({items:records.map(record=>publicFitting(record,now)),total,page,limit});
   }
   const number=req.params?.number;
   if(!number||!/^ZK-[A-F0-9]{12}$/.test(number))throw new FittingError('FITTING_NOT_FOUND',404);
   if(action==='claim'){
    const body=req.body as {token?:unknown}|undefined;
    if(!body||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new FittingError('VALIDATION_ERROR',400);
    // Atomic single-owner claim. The original private capability stays valid.
    const record=await FittingModel.findOneAndUpdate({number,tokenHash:createHash('sha256').update(body.token).digest('hex'),$or:[{customerId:null},{customerId}]},{$set:{customerId}},{new:true}).lean().exec();
    if(!record)throw new FittingError('FITTING_NOT_FOUND',404);
    return res.status(200).json(publicFitting(record,now));
   }
   const filter={number,customerId};
   if(!await FittingModel.exists(filter))throw new FittingError('FITTING_NOT_FOUND',404);
   if(action==='report') {
    const changed = await FittingModel.updateOne({...filter,status:'pending',expiresAt:{$gt:now}},{$set:{status:'review'},$inc:{revision:1},$push:{audit:{action:'payment_reported',at:now,by:customerId.toHexString()}}}).exec();
    if (changed.modifiedCount) await notifyOwnerFittingPaymentReported();
   }
   if(action==='cancel')await FittingModel.updateOne({...filter,status:{$in:['pending','review','confirmed']}},{$set:{status:'cancelled'},$unset:{slotKey:1,activeEmail:1},$inc:{revision:1},$push:{audit:{action:'cancelled',at:now,by:customerId.toHexString()}}}).exec();
   const record=await FittingModel.findOne(filter).lean().exec();
   if(!record)throw new FittingError('FITTING_NOT_FOUND',404);
   return res.status(200).json(publicFitting(record,now));
  }catch(e){if(e instanceof FittingError)return res.status(e.status).json({error:{code:e.code,message:e.code}});return next(e);}
 };
}
