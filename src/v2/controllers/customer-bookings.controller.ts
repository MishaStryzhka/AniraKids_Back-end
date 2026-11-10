import {authenticateLegacyBearer,parseBearerAuthorization} from '../auth/legacy-bearer';
import {reservationOwnership} from '../auth/reservation-ownership';
import {fittingOwnership} from './customer-fittings.controller';
import {ReservationV2Model} from '../models';
import {FittingModel} from '../models/fitting.model';
import {expireFittings,publicFitting} from '../services/fitting.service';
import {accountListQuery} from '../http/account-list-query';
import {toPublicReservationResponse} from '../http/reservation-response';
import type {HttpHandler} from '../types/http';

// Ownership and filters are applied to both collections before shared sorting/pagination.
export const listCustomerBookings:HttpHandler=async(req,res,next)=>{
 res.setHeader?.('Cache-Control','private, no-store');res.setHeader?.('Vary','Authorization');
 try{
  const bearer=parseBearerAuthorization(req.headers.authorization);
  const identity=bearer.kind==='bearer'?await authenticateLegacyBearer(bearer.token):null;
  if(!identity)return res.status(401).json({error:{code:'UNAUTHORIZED'}});
  const raw=req.query?.page??'1',kind=req.query?.kind??'all';
  if(typeof raw!=='string'||!/^[1-9]\d{0,4}$/.test(raw)||!['all','rental','fitting'].includes(kind as string))return res.status(400).json({error:{code:'VALIDATION_ERROR'}});
  let rentalQuery,fittingQuery;
  try{rentalQuery=accountListQuery(req.query,'rental');fittingQuery=accountListQuery(req.query,'fitting');}catch{return res.status(400).json({error:{code:'VALIDATION_ERROR'}});}
  const now=new Date();await expireFittings(now);
  const [rentalOwner,fittingOwner]=await Promise.all([reservationOwnership(identity.userId),fittingOwnership(identity.userId)]);
  const sort=req.query?.sort??'newest',byDate=sort==='date_asc'||sort==='date_desc';
  const direction:1|-1=sort==='oldest'||sort==='date_asc'?1:-1;
  const rentalPipeline=[{$match:{$and:[rentalOwner.filter,rentalQuery.filter,...(kind==='fitting'?[{_id:{$exists:false}}]:[])]}},{$project:{record:'$$ROOT',kind:{$literal:'rental'},sortKey:byDate?{$dateToString:{format:'%Y-%m-%d',date:'$startDate',timezone:'UTC'}}:'$createdAt'}}];
  const fittingPipeline=[{$match:{$and:[fittingOwner.ownership,fittingQuery.filter,...(kind==='rental'?[{_id:{$exists:false}}]:[])]}},{$project:{record:'$$ROOT',kind:{$literal:'fitting'},sortKey:byDate?'$date':'$createdAt'}}];
  const page=Number(raw),limit=20;
  const [data]=await ReservationV2Model.aggregate([
   ...rentalPipeline,{$unionWith:{coll:FittingModel.collection.name,pipeline:fittingPipeline}},
   {$sort:{sortKey:direction,_id:direction,kind:1}},
   {$facet:{items:[{$skip:(page-1)*limit},{$limit:limit}],count:[{$count:'total'}]}}
  ]).exec();
  return res.status(200).json({items:data.items.map((row:any)=>row.kind==='rental'?{kind:'rental',reservation:toPublicReservationResponse(row.record)}:{kind:'fitting',fitting:publicFitting(row.record,now)}),total:data.count[0]?.total??0,page,limit,guestEmailAccess:rentalOwner.guestEmailAccess&&Boolean(fittingOwner.verifiedEmail)});
 }catch(error){return next(error);}
};
