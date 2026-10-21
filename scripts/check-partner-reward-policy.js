const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {randomUUID}=require('node:crypto');
module.exports=async()=>{
 const {calculatePartnerBalance:balance}=require('../build/v2/services/partner-balance.service');
 const {FittingModel:F}=require('../build/v2/models/fitting.model');
 const {ReservationV2Model:R}=require('../build/v2/models/reservation-v2.model');
 const {actOnFitting:act}=require('../build/v2/services/fitting.service');
 const fit={_id:'f',number:'ZK-POLICY',rewardPolicyVersion:2,status:'completed',paymentStatus:'paid',performedBy:'partner',partner:{partnerId:'blaze',source:'partner'}};
 const rental={_id:new mongoose.Types.ObjectId(),reservationNumber:'AK-POLICY',rewardPolicyVersion:2,status:'returned',subtotal:900,deposit:0,paymentEntries:[{type:'rental_received',recordedAt:new Date(),amount:900}],partner:{partnerId:'blaze',source:'partner'}};
 for(const [source,mode,rate] of [['partner','studio',50],['partner','external',20],['anirak','studio',0],['anirak','external',20]]){
  const r={...rental,rentalMode:mode,partner:{partnerId:'blaze',source}};
  assert.equal(balance([r],[]).earned,900*rate/100);
  for(const performer of ['partner','anirak']){
   const f={...fit,performedBy:performer,rewardReservationId:String(r._id)};
   const result=balance([r],[f]);
   assert.equal(result.earned,900*rate/100,`${source}/${mode}/${performer}: fitting included once`);
   assert.equal(result.lines[0].amount,900*rate/100-(performer==='partner'?200:0));
   assert.equal(result.lines[0].rewardRate,rate);
   assert.equal(balance([{...r,status:'confirmed'}],[f]).earned,performer==='partner'?200:0);
   assert.equal(balance([{...r,status:'cancelled'}],[f]).earned,performer==='partner'?200:0);
  }
 }
 assert.equal(balance([],[{...fit,performedBy:'anirak'}]).earned,0);
 assert.equal(balance([],[fit]).earned,200);
 const discounted={...rental,rentalMode:'studio',subtotal:700,fittingDiscount:{amount:200},fittingCreditId:'f',paymentEntries:[{type:'rental_received',recordedAt:new Date(),amount:700}]};
 assert.equal(balance([discounted],[fit]).earned,450,'50% before fitting discount');
 assert.equal(balance([{...discounted,paymentEntries:[{type:'rental_received',recordedAt:new Date(),amount:700},{type:'rental_refunded',recordedAt:new Date(),amount:400}]}],[fit]).earned,250,'refund correction');
 assert.equal(balance([{...rental,rewardPolicyVersion:undefined,rentalMode:'external'}],[]).earned,450,'legacy rate preserved');
 // Actual Mongo transactions: two rentals cannot claim the same fitting.
 const template=await R.findOne({'partner.partnerId':'blaze'}).lean();assert.ok(template);
 const ids=[new mongoose.Types.ObjectId(),new mongoose.Types.ObjectId()];
 const docs=ids.map((_id,i)=>({...template,_id,reservationNumber:'AK-POLICY-'+i,rewardPolicyVersion:2,status:'returned',rentalMode:'external',subtotal:900,deposit:0,totalDue:900,partner:{partnerId:'blaze',source:'partner'},paymentEntries:[{operationId:randomUUID(),type:'rental_received',recordedAt:new Date(),amount:900,method:'cash',recordedBy:'test',recordedAt:new Date()}]}));
 for(const d of docs){for(const k of ['fittingCreditId','fittingDiscount','idempotencyKeyHash','guestAccessTokenHash','idempotency','invoiceIssuedId','invoiceAutomation'])delete d[k];await R.collection.insertOne(d);}
 const f=await F.create({operationId:randomUUID(),requestHash:'policy',tokenHash:'policy',number:'ZK-POLICY-DB',date:'2030-01-01',time:'10:00',startAt:new Date('2030-01-01'),address:'Test',creditOperationId:randomUUID(),status:'completed',paymentStatus:'paid',performedBy:'partner',partner:{partnerId:'blaze',source:'partner'},customer:{name:'Test',email:template.customerSnapshot.email,phone:'123456'},revision:0});
 assert.equal(f.rewardPolicyVersion,2);
 const results=await Promise.allSettled(docs.map(d=>act(String(f._id),{action:'link-reward',revision:0,reservationNumber:d.reservationNumber},'test')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(results));
 const linked=await F.findById(f._id).lean();const target=docs.find(d=>String(d._id)===linked.rewardReservationId);assert.ok(target);
 await act(String(f._id),{action:'link-reward',revision:0,reservationNumber:target.reservationNumber},'test');
 const after=await R.findById(target._id).lean();assert.equal(after.subtotal,900);assert.equal(after.fittingDiscount,undefined);assert.deepEqual(after.paymentEntries,target.paymentEntries);
 assert.equal(balance([after],[linked]).earned,180);assert.equal(balance([after],[linked]).lines[0].amount,-20);
 const otherFit=await F.create({...f.toObject(),_id:new mongoose.Types.ObjectId(),operationId:randomUUID(),number:'ZK-POLICY-OTHER'});
 await assert.rejects(act(String(otherFit._id),{action:'credit',revision:0,reservationNumber:target.reservationNumber},'test'),e=>e.code==='FITTING_DISCOUNT_STUDIO_ONLY');
 await assert.rejects(act(String(otherFit._id),{action:'link-reward',revision:0,reservationNumber:target.reservationNumber},'test'),e=>e.code==='FITTING_ALREADY_CREDITED');
 await R.collection.updateOne({_id:target._id},{$unset:{rewardPolicyVersion:1}});const historical=await R.findById(target._id);assert.equal(historical.rewardPolicyVersion,undefined,'reading legacy does not assign new policy');
 await F.deleteMany({_id:{$in:[f._id,otherFit._id]}});await R.deleteMany({_id:{$in:ids}});
 console.log('PARTNER_REWARD_POLICY=PASS four rates performer discount refund legacy concurrent-link negative-adjustment');
};
