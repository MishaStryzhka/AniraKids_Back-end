import {createHash} from 'crypto';
import type {HttpHandler} from '../types/http';
import {authenticateLegacyBearer,parseBearerAuthorization} from '../auth/legacy-bearer';
import {fittingOwnership} from './customer-fittings.controller';
import {FittingModel} from '../models/fitting.model';
import {expireFittings,publicFitting} from '../services/fitting.service';
import {PaymentError} from '../services/payment.types';
import {createFittingCardOrder,syncFittingCardOrder} from '../services/fitting-revolut.service';
export const fittingRevolut=(action:'create'|'sync'|'cancel',account=false):HttpHandler=>async(req,res,next)=>{
 res.setHeader?.('Cache-Control','private, no-store');res.setHeader?.('Vary','Authorization');
 try{
  const number=req.params?.number,bearer=parseBearerAuthorization(req.headers.authorization);
  if(!number||!/^ZK-[A-F0-9]{12}$/.test(number)||bearer.kind!=='bearer')throw new PaymentError('FITTING_NOT_FOUND',404);
  let filter:object;
  if(account){const identity=await authenticateLegacyBearer(bearer.token);if(!identity)throw new PaymentError('UNAUTHORIZED',401);filter=(await fittingOwnership(identity.userId)).ownership;}
  else{if(!/^[a-f0-9]{64}$/.test(bearer.token))throw new PaymentError('FITTING_NOT_FOUND',404);filter={tokenHash:createHash('sha256').update(bearer.token).digest('hex')};}
  await expireFittings();
  const doc=await FittingModel.findOne({number,...filter}).lean().exec();if(!doc)throw new PaymentError('FITTING_NOT_FOUND',404);
  if(req.body&&Object.keys(req.body as object).length)throw new PaymentError('VALIDATION_ERROR',400);
  if(action==='create')return res.status(200).json(await createFittingCardOrder(doc));
  await syncFittingCardOrder(doc,action==='cancel');
  return res.status(200).json(publicFitting(await FittingModel.findById(doc._id).lean().exec()));
 }catch(e){if(e instanceof PaymentError)return res.status(e.status).json({error:{code:e.code}});return next(e);}
};
