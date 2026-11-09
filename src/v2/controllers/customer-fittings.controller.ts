import {accountListQuery} from '../http/account-list-query';
import {createHash} from 'crypto';
import {notifyOwnerFittingPaymentReported} from '../services/admin-push.service';
import {authenticateLegacyBearer,parseBearerAuthorization} from '../auth/legacy-bearer';
import {FittingModel} from '../models/fitting.model';
import {expireFittings,FittingError,publicFitting} from '../services/fitting.service';
import type {HttpHandler} from '../types/http';

const User=require('../../../models/user');
export async function fittingOwnership(customerId:import('mongoose').Types.ObjectId){
   const user=await User.findById(customerId).select('email emailVerified').lean().exec();
   const verifiedEmail=user?.emailVerified===true&&typeof user.email==='string'?user.email.trim().toLowerCase():undefined;
   const ownership=verifiedEmail?{$or:[{customerId},{customerId:null,'customer.email':verifiedEmail}]}:{customerId};
 return {ownership,verifiedEmail};
}

/** Guest access requires mailbox ownership verified on the server, never form input. */
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
   const {ownership,verifiedEmail}=await fittingOwnership(customerId);
   if(action==='list'){
    const raw=req.query?.page??'1';
    if(typeof raw!=='string'||!/^\d{1,5}$/.test(raw)||Number(raw)<1)throw new FittingError('VALIDATION_ERROR',400);
    const page=Number(raw),limit=20;
    let query;try{query=accountListQuery(req.query,'fitting');}catch{throw new FittingError('VALIDATION_ERROR',400);}
    const listFilter={$and:[ownership,query.filter]};
    const [records,total]=await Promise.all([
     FittingModel.find(listFilter).sort(query.order).skip((page-1)*limit).limit(limit).lean().exec(),
     FittingModel.countDocuments(listFilter).exec(),
    ]);
    return res.status(200).json({items:records.map(record=>publicFitting(record,now)),total,page,limit,guestEmailAccess:Boolean(verifiedEmail)});
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
   const filter={number,...ownership};
   if(!await FittingModel.exists(filter))throw new FittingError('FITTING_NOT_FOUND',404);
   if(action==='report') {
    const doc=await FittingModel.findOne(filter).lean().exec();
    const payment=publicFitting(doc);
    if(!payment.paymentOptions.qrEnabled||payment.cardPayment.active||payment.cardPayment.reviewRequired)throw new FittingError('PAYMENT_NOT_ALLOWED');
    const changed = await FittingModel.findOneAndUpdate({...filter,status:'pending',revolutActiveAttempt:{$exists:false},expiresAt:{$gt:now}},{$set:{status:'review'},$inc:{revision:1},$push:{audit:{action:'payment_reported',at:now,by:customerId.toHexString()}}},{new:true}).select('_id').lean().exec();
    if (changed) await notifyOwnerFittingPaymentReported(changed._id);
   }
   if(action==='cancel')await FittingModel.updateOne({...filter,status:{$in:['pending','review','confirmed']}},{$set:{status:'cancelled'},$unset:{slotKey:1,activeEmail:1},$inc:{revision:1},$push:{audit:{action:'cancelled',at:now,by:customerId.toHexString()}}}).exec();
   const record=await FittingModel.findOne(filter).lean().exec();
   if(!record)throw new FittingError('FITTING_NOT_FOUND',404);
   return res.status(200).json(publicFitting(record,now));
  }catch(e){if(e instanceof FittingError)return res.status(e.status).json({error:{code:e.code,message:e.code}});return next(e);}
 };
}
