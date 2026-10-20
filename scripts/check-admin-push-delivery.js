const assert=require('node:assert/strict');
const {createECDH,randomBytes}=require('node:crypto');
const {generateVAPIDKeys}=require('web-push');
const ece=require('http_ece');
const {Types}=require('mongoose');
const service=require('../build/v2/services/admin-push.service');
const {AdminPushSubscriptionModel:Model}=require('../build/v2/models/admin-push-subscription.model');
const {adminPushHandler}=require('../build/v2/controllers/admin-push.controller');
const vapid=generateVAPIDKeys();
process.env.V2_PUSH_VAPID_PUBLIC_KEY=vapid.publicKey;
process.env.V2_PUSH_VAPID_PRIVATE_KEY=vapid.privateKey;
process.env.V2_PUSH_VAPID_SUBJECT='mailto:fixture@example.test';
const receiver=createECDH('prime256v1');receiver.generateKeys();
const keys={p256dh:receiver.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')};
const endpoint=id=>'https://fcm.googleapis.com/fcm/send/isolated-fixture-'+id;
const ownerId=new Types.ObjectId(),fittingId=new Types.ObjectId(),paymentFittingId=new Types.ObjectId();
const records=[
  {endpoint:endpoint('created'),endpointHash:'created',topics:['fitting_created'],keys},
  {endpoint:endpoint('payment'),endpointHash:'payment',topics:['fitting_payment_reported'],keys},
  {endpoint:endpoint('both'),endpointHash:'both',topics:['fitting_created','fitting_payment_reported'],keys},
  {endpoint:endpoint('rental-transfer'),endpointHash:'rental-transfer',topics:['reservation_payment_reported'],keys},
  {endpoint:endpoint('rental-cash'),endpointHash:'rental-cash',topics:['reservation_cash_selected'],keys},
  {endpoint:endpoint('rental-both'),endpointHash:'rental-both',topics:['reservation_payment_reported','reservation_cash_selected'],keys},
  {endpoint:endpoint('rental-no-keys'),endpointHash:'rental-no-keys',topics:['reservation_payment_reported','reservation_cash_selected']},
  {endpoint:endpoint('off'),endpointHash:'off',topics:[],keys},
  {endpoint:endpoint('legacy'),endpointHash:'legacy'},
  {endpoint:endpoint('missing-keys'),endpointHash:'missing-keys',topics:['fitting_created']},
  {endpoint:'https://example.test/do-not-send',endpointHash:'invalid-host',topics:['fitting_created'],keys},
];
const sent=[],deleted=[];let status=201,stored;
const query=value=>({select(){return this;},limit(){return this;},lean(){return this;},exec:async()=>value});
Model.find=filter=>{
  const topic=filter.topics||filter.$or[0].topics;
  return query(records.filter(record=>record.topics?.includes(topic)||(filter.$or&&record.topics===undefined)));
};
Model.deleteOne=filter=>{deleted.push(filter);return query({deletedCount:1});};
Model.countDocuments=()=>query(0);
Model.findOne=()=>query(null);
Model.updateOne=(_filter,update)=>{stored=update.$set;return query({modifiedCount:1});};
global.fetch=async(url,options)=>{
  assert.ok(url.startsWith('https://fcm.googleapis.com/'));assert.equal(options.redirect,'error');
  let payload=null;
  if(options.body){
    assert.equal(options.headers['Content-Encoding'],'aes128gcm');
    payload=JSON.parse(ece.decrypt(options.body,{version:'aes128gcm',privateKey:receiver,authSecret:keys.auth}).toString());
    assert.deepEqual(Object.keys(payload),payload.type.startsWith('reservation_')?['type','reservationId']:['type','fittingId'],
      'only event type and opaque record ID; no customer/payment data or access tokens');
  }
  sent.push({url,payload});return {status,ok:status<300};
};
async function handle(body,owner=true){
  let result;const res={setHeader(){},status(code){this.code=code;return this;},json(data){result={code:this.code,data};return this;}};
  await adminPushHandler('subscribe')({adminOwner:owner,authenticatedUserId:ownerId,body},res,error=>{throw error;});return result;
}
(async()=>{
  assert.equal(service.validPushKeys(keys),true);
  for(const bad of [null,{},[],{...keys,auth:'x'},{...keys,p256dh:'B'+'A'.repeat(86)},{...keys,extra:'x'}])assert.equal(service.validPushKeys(bad),false);
  assert.equal((await handle({endpoint:endpoint('new'),topics:['fitting_created'],keys})).code,200);
  assert.deepEqual(stored.keys,keys);assert.deepEqual(stored.topics,['fitting_created']);
  assert.equal((await handle({endpoint:endpoint('new'),topics:['fitting_created']})).code,400);
  assert.equal((await handle({endpoint:endpoint('new'),topics:['unknown'],keys})).code,400);
  assert.equal((await handle({endpoint:endpoint('new'),keys:{}})).code,400);
  assert.equal((await handle({endpoint:endpoint('new'),topics:['fitting_created'],keys},false)).code,403);
  for(const topic of ['reservation_payment_reported','reservation_cash_selected']){
    assert.equal((await handle({endpoint:endpoint('new'),topics:[topic],keys})).code,200);
    assert.deepEqual(stored.topics,[topic]);
    assert.equal((await handle({endpoint:endpoint('new'),topics:[topic]})).code,400);
    assert.equal((await handle({endpoint:endpoint('new'),topics:[topic],keys},false)).code,403);
  }
  assert.equal((await handle({endpoint:endpoint('old')})).code,200,'legacy payment-only client remains supported');
  await service.notifyOwnerFittingCreated(fittingId);
  assert.deepEqual(sent.map(item=>item.url),[endpoint('created'),endpoint('both')]);
  assert.ok(sent.every(item=>item.payload.type==='fitting_created'&&item.payload.fittingId===fittingId.toHexString()));
  sent.length=0;await service.notifyOwnerFittingPaymentReported(paymentFittingId);
  assert.deepEqual(sent.map(item=>item.url),[endpoint('payment'),endpoint('both'),endpoint('legacy')]);
  assert.deepEqual(sent.map(item=>item.payload),[{type:'fitting_payment_reported',fittingId:paymentFittingId.toHexString()},{type:'fitting_payment_reported',fittingId:paymentFittingId.toHexString()},null]);
  for(const kind of ['advance','full','cash']){
    const reservationId=new Types.ObjectId();
    sent.length=0;await service.notifyOwnerReservationPaymentReported(kind,reservationId);
    const cash=kind==='cash';
    assert.deepEqual(sent.map(item=>item.url),[endpoint(cash?'rental-cash':'rental-transfer'),endpoint('rental-both')]);
    assert.ok(sent.every(item=>item.payload.type===(cash?'reservation_cash_selected':'reservation_payment_reported')));
    assert.ok(sent.every(item=>item.payload.reservationId===reservationId.toHexString()),'each alert carries its own reservation ID');
  }
  status=410;await service.notifyOwnerFittingCreated(fittingId);
  assert.deepEqual(deleted,[{endpointHash:'created'},{endpointHash:'both'}]);
  status=503;await service.notifyOwnerFittingCreated(fittingId);await service.notifyOwnerReservationPaymentReported('full',new Types.ObjectId());
  global.fetch=async()=>{throw new Error('offline');};await service.notifyOwnerFittingCreated(fittingId);await service.notifyOwnerReservationPaymentReported('cash',new Types.ObjectId());
  Model.find=()=>{throw new Error('database unavailable');};await service.notifyOwnerFittingCreated(fittingId);await service.notifyOwnerReservationPaymentReported('full',new Types.ObjectId());
  console.log('PASS: encrypted fitting, rental-transfer and cash event types; independent subscriptions; legacy payment fallback; owner/input validation; expired endpoint cleanup and isolated delivery failures');
})().catch(error=>{console.error(error);process.exitCode=1;});
