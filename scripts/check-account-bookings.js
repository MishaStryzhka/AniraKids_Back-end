const assert=require('node:assert/strict');
const {Types}=require('mongoose');
const auth=require('../build/v2/auth/legacy-bearer');
const rentalAuth=require('../build/v2/auth/reservation-ownership');
const fittingAuth=require('../build/v2/controllers/customer-fittings.controller');
const fittingService=require('../build/v2/services/fitting.service');
const response=require('../build/v2/http/reservation-response');
const {ReservationV2Model}=require('../build/v2/models');
const {FittingModel}=require('../build/v2/models/fitting.model');
const {listCustomerBookings}=require('../build/v2/controllers/customer-bookings.controller');
const customerId=new Types.ObjectId();let authenticated=true,pipeline;
auth.authenticateLegacyBearer=async()=>authenticated?{userId:customerId}:null;
rentalAuth.reservationOwnership=async()=>({filter:{customerId},guestEmailAccess:false});
fittingAuth.fittingOwnership=async()=>({ownership:{customerId},verifiedEmail:undefined});
fittingService.expireFittings=async()=>{};
response.toPublicReservationResponse=r=>({reservation:{reservationNumber:r.reservationNumber}});
fittingService.publicFitting=r=>({number:r.number});
ReservationV2Model.aggregate=p=>{pipeline=p;return {exec:async()=>[{items:[{kind:'fitting',record:{number:'ZK-123456ABCDEF',tokenHash:'private'}},{kind:'rental',record:{reservationNumber:'AK-2030-ABC123',guestAccessTokenHash:'private'}}],count:[{total:42}]}]}};
async function call(query){let status=200,body;await listCustomerBookings({headers:{authorization:'Bearer test'},query},{setHeader(){},status(n){status=n;return this},json(b){body=b;return this}},e=>{throw e});return {status,body};}
(async()=>{
 for(const sort of ['newest','oldest','date_asc','date_desc']){
  const r=await call({page:'2',sort});assert.equal(r.status,200);assert.equal(r.body.total,42);assert.equal(r.body.items.length,2);assert.ok(!JSON.stringify(r.body).includes('private'));
  assert.deepEqual(pipeline[0].$match.$and[0],{customerId});
  const union=pipeline[2].$unionWith;assert.equal(union.coll,FittingModel.collection.name);assert.deepEqual(union.pipeline[0].$match.$and[0],{customerId});
  assert.equal(pipeline[3].$sort.sortKey,['oldest','date_asc'].includes(sort)?1:-1);
  assert.deepEqual(pipeline[4].$facet.items,[{$skip:20},{$limit:20}]);
  if(sort.startsWith('date'))assert.equal(pipeline[1].$project.sortKey.$dateToString.format,'%Y-%m-%d');
 }
 await call({kind:'fitting',status:'active',q:'[test]'});assert.deepEqual(pipeline[0].$match.$and[2],{_id:{$exists:false}});assert.deepEqual(pipeline[2].$unionWith.pipeline[0].$match.$and[1].status,{$in:['pending','review','confirmed']});
 await call({kind:'rental'});assert.deepEqual(pipeline[2].$unionWith.pipeline[0].$match.$and[2],{_id:{$exists:false}});
 for(const query of [{kind:'bad'},{sort:'bad'},{status:'bad'},{page:'0'},{page:'1.5'}])assert.equal((await call(query)).status,400);
 authenticated=false;assert.equal((await call({})).status,401);
 console.log('Unified history: authorization, per-type filters, shared stable sort/pagination and public serializers PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
