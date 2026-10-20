import mongoose = require('mongoose');
import {PartnerModel} from '../models/partner.model';
import {PartnerRewardState,PartnerRewardEvent} from '../models/partner-invoice.model';
import {ReservationV2Model} from '../models/reservation-v2.model';
import {FittingModel} from '../models/fitting.model';
import {calculatePartnerBalance} from './partner-balance.service';
export async function reconcilePartnerRewards(session?:mongoose.ClientSession,initialPeriodStart?:Date){
 const run=async(s:mongoose.ClientSession)=>{
  const partner:any=await PartnerModel.findById('blaze').session(s).lean();
  if(!partner?.billing?.trackingStartedAt)return;
  // Serialize reward observations and month closure for this partner.
  await PartnerModel.updateOne({_id:'blaze'},{$inc:{billingRevision:1}},{session:s});
  const rentals=await ReservationV2Model.find({'partner.partnerId':'blaze'}).session(s).lean();
  const fittings=await FittingModel.find({'partner.partnerId':'blaze'}).session(s).lean();
  const previous=await PartnerRewardState.findById('blaze').session(s).lean();
  const lines=calculatePartnerBalance(rentals,fittings).lines,now=new Date(),next:Record<string,any>={};
  for(const line of lines){
   const key=line.kind+':'+line.number;next[key]=line;
   let amount=Math.round((line.amount-Number(previous?.lines?.[key]?.amount||0))*100)/100,at=now;
   if(!previous){
    if(!initialPeriodStart)throw new Error('PARTNER_REWARD_BASELINE_MISSING');
    const source:any=line.kind==='rental'?rentals.find((r:any)=>r.reservationNumber===line.number):fittings.find((f:any)=>f.number===line.number);
    const audits=line.kind==='rental'?source?.partnerAudit:source?.audit;
    const dates=(audits||[]).filter((a:any)=>line.kind==='rental'?a.action==='return':['complete','confirm','late-payment'].includes(a.action)).map((a:any)=>new Date(a.at).getTime()).filter(Number.isFinite);
    if(!dates.length||Math.max(...dates)<initialPeriodStart.getTime())amount=0;
    else at=new Date(Math.max(...dates));
   }
   if(amount)await PartnerRewardEvent.create([{partnerId:'blaze',at,kind:line.kind,number:line.number,amount,detail:line}],{session:s});
  }
  for(const [key,old] of Object.entries(previous?.lines||{}) as [string,any][]){if(!next[key]&&old.amount)await PartnerRewardEvent.create([{partnerId:'blaze',at:now,kind:old.kind,number:old.number,amount:-old.amount,detail:{reason:'removed'}}],{session:s});}
  await PartnerRewardState.updateOne({_id:'blaze'},{$set:{lines:next}},{upsert:true,session:s});
  await PartnerModel.updateOne({_id:'blaze'},{$unset:{'billing.trackingError':1}},{session:s});
 };
 if(session?.inTransaction())return run(session);
 const own=await mongoose.startSession();try{await own.withTransaction(()=>run(own));}finally{await own.endSession();}
}
// Called after source mutations. Existing source transactions include the ledger
// atomically; standalone mutations retain a visible recovery marker on failure.
export async function observePartnerRewards(session?:mongoose.ClientSession){
 try{await reconcilePartnerRewards(session);}catch(error){
  if(session?.inTransaction())throw error;
  console.warn('PARTNER_REWARD_TRACKING_FAILED');
  await PartnerModel.updateOne({_id:'blaze','billing.trackingStartedAt':{$exists:true}},{$set:{'billing.trackingError':true}}).catch(()=>undefined);
 }
}
