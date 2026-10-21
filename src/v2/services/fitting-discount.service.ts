import {createHash} from 'crypto';
import type {ClientSession,Types} from 'mongoose';
import {FittingModel} from '../models/fitting.model';
import {ReservationV2Model} from '../models/reservation-v2.model';
import type {Reservation} from '../types/domain';
export interface FittingDiscountSelection {number:string;token?:string;}
export class FittingDiscountError extends Error {constructor(public code:string,public status=409){super(code);}}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function validDiscountSelection(v:any):v is FittingDiscountSelection {
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['number','token'].includes(k))&&/^ZK-[A-F0-9]{12}$/.test(v.number)&& (v.token===undefined||typeof v.token==='string'&&/^[a-f0-9]{64}$/.test(v.token));
}
// Release only never-paid holds. A simultaneous payment changes the matching
// document/revision, so it cannot be charged against an obsolete discounted price.
export async function releaseUnusedFittingDiscounts(now=new Date(),session?:ClientSession){
 await ReservationV2Model.updateMany({fittingCreditId:{$type:'string'},'fittingDiscount.amount':200,'paymentEntries.0':{$exists:false},$and:[{$or:[{paymentStatus:'unpaid'},{paymentStatus:'paid',subtotal:0}]},{$or:[{status:'cancelled'},{status:'pending',expiresAt:{$lte:now}}]}]},[
 {$set:{paymentStatus:'unpaid',subtotal:{$add:['$subtotal',200]},totalDue:{$add:['$totalDue',200]},advanceRequired:{$min:[200,{$add:['$subtotal',200]}]},paymentRevision:{$add:[{$ifNull:['$paymentRevision',0]},1]},partnerAudit:{$concatArrays:[{$ifNull:['$partnerAudit',[]]},[{action:'fitting_discount_released',at:now,by:'system'}]]}}},
 {$unset:['fittingCreditId','fittingDiscount']}
 ],{session}).exec();
}
const eligible={status:'completed',paymentStatus:'paid',rewardReservationId:{$exists:false}};
function ownership(selection:FittingDiscountSelection,customerId?:Types.ObjectId){
 if(selection.token)return {$or:[{discountTokenHash:hash(selection.token)},{tokenHash:hash(selection.token)}]};
 if(customerId)return {customerId};
 throw new FittingDiscountError('FITTING_DISCOUNT_UNAVAILABLE');
}
export async function customerDiscountOptions(customerId?:Types.ObjectId,selection?:FittingDiscountSelection){
 if(selection&&!validDiscountSelection(selection))throw new FittingDiscountError('VALIDATION_ERROR',400);
 await releaseUnusedFittingDiscounts();
 if(!customerId&&!selection?.token)return {items:[]};
 const filter=selection?{number:selection.number,...ownership(selection,customerId)}:{customerId};
 const fittings=await FittingModel.find({...eligible,...filter}).select('_id number date time').sort({date:-1,time:-1}).limit(100).lean();
 const used=await ReservationV2Model.find({fittingCreditId:{$in:fittings.map(f=>String(f._id))}}).select('fittingCreditId').lean();
 return {items:fittings.filter(f=>!used.some(r=>r.fittingCreditId===String(f._id))).map(f=>({number:f.number,date:f.date,time:f.time,amount:200}))};
}
export async function applyCustomerFittingDiscount(data:Reservation,selection:FittingDiscountSelection,now:Date,session:ClientSession){
 if(data.rentalMode!=='studio'||data.partner?.partnerId!=='blaze')throw new FittingDiscountError('FITTING_DISCOUNT_STUDIO_ONLY');
 if(!validDiscountSelection(selection))throw new FittingDiscountError('VALIDATION_ERROR',400);
 // Lock the fitting as well as inventory: two different baskets cannot claim it.
 const fitting:any=await FittingModel.findOneAndUpdate({number:selection.number,...eligible,...ownership(selection,data.customerId)},{$inc:{revision:1}},{new:true,session}).lean();
 if(!fitting||fitting.customer.email.toLowerCase().trim()!==data.customerSnapshot.email.toLowerCase().trim())throw new FittingDiscountError('FITTING_DISCOUNT_UNAVAILABLE');
 await releaseUnusedFittingDiscounts(now,session);
 if(await ReservationV2Model.exists({fittingCreditId:String(fitting._id)}).session(session))throw new FittingDiscountError('FITTING_DISCOUNT_UNAVAILABLE');
 if(data.subtotal<200)throw new FittingDiscountError('FITTING_DISCOUNT_MINIMUM');
 const subtotal=data.subtotal-200;
 return {...data,subtotal,totalDue:subtotal+data.deposit,advanceRequired:Math.min(200,subtotal),fittingCreditId:String(fitting._id),fittingDiscount:{amount:200,number:fitting.number,appliedAt:now,appliedBy:data.customerId?String(data.customerId):'customer_link'},...(fitting.partner?{partner:fitting.partner}:{}),paymentStatus:subtotal===0&&data.deposit===0?'paid' as const:'unpaid' as const};
}
