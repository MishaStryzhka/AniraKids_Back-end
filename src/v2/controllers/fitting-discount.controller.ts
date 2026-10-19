import type {HttpHandler} from '../types/http';
import {customerDiscountOptions,FittingDiscountError,validDiscountSelection} from '../services/fitting-discount.service';
export const customerFittingDiscounts:HttpHandler=async(req,res,next)=>{
 res.setHeader?.('Cache-Control','private, no-store');res.setHeader?.('Vary','Authorization');
 try{const body=req.body as any;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='selection')||(body.selection&&!validDiscountSelection(body.selection)))throw new FittingDiscountError('VALIDATION_ERROR',400);
 return res.status(200).json(await customerDiscountOptions(req.authenticatedUserId,body.selection));
 }catch(e){if(e instanceof FittingDiscountError)return res.status(e.status).json({error:{code:e.code}});return next(e);}
};
