// Owns disposable loopback Mongo; provider, email and invoice side effects are fixtures.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const net=require('node:net');
const {randomUUID,createHmac}=require('node:crypto');
const mongoose=require('mongoose');
assert.equal(process.env.NODE_ENV,'test');
require('./fitting-email-fixture');
const client=require('../build/v2/services/revolut-client');
require('../build/v2/services/partner-reward-ledger.service').observePartnerRewards=async()=>{};
let invoices=0;
require('../build/v2/services/invoice-automation.service').processAutomaticInvoice=async()=>{invoices++;};
const {ReservationV2Model:R}=require('../build/v2/models/reservation-v2.model');
const {InventoryItemV2Model:I}=require('../build/v2/models/inventory-item-v2.model');
const {reservationAdminService}=require('../build/v2/services/reservation-admin.service');
const {createCardOrder,reconcileCardOrder,cancelCardOrder,cardAmounts}=require('../build/v2/services/revolut.service');
const {paymentSummary,recordPayment}=require('../build/v2/services/payment.service');
const {revolutReservation,revolutWebhook}=require('../build/v2/controllers/revolut.controller');
process.env.REVOLUT_ENABLED='true';process.env.REVOLUT_MODE='sandbox';
process.env.REVOLUT_SECRET_KEY='fixture';process.env.REVOLUT_PUBLIC_KEY='pk_fixture';process.env.REVOLUT_WEBHOOK_SECRET='fixture-signature';
const orders=new Map();let posts=0,unknown=false,mismatch=false;
client.revolutRequest=async(method,path,body)=>{
 if(method==='POST' && path==='/orders'){
  posts++;const id=randomUUID();const order={id,token:randomUUID(),state:'pending',...body};orders.set(id,order);
  if(unknown)throw new Error('fixture lost response');
  return {...order,...(mismatch?{amount:body.amount+100}:{})};
 }
 const id=path.split('/')[2],order=orders.get(id);assert.ok(order);
 if(method==='POST')order.state='cancelled';
 return {...order};
};
let child,dir;const watchdog=setTimeout(()=>{child?.kill('SIGKILL');process.exit(1);},60000);watchdog.unref();
async function start(){
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 dir=mkdtempSync(tmpdir()+'/revolut-test-');
 child=spawn(process.env.PUBLIC_BOOKING_MONGOD_BINARY||'mongod',['--bind_ip','127.0.0.1','--port',String(port),'--dbpath',dir,'--nounixsocket','--replSet','revolut-test'],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>reject(new Error('Mongo exited')));child.stdout.on('data',d=>{if(String(d).includes('Waiting for connections'))resolve();});});
 const uri=`mongodb://127.0.0.1:${port}/revolut_${randomUUID().replaceAll('-','')}?directConnection=true`;
 await mongoose.connect(uri,{serverSelectionTimeoutMS:5000});
 await mongoose.connection.db.admin().command({replSetInitiate:{_id:'revolut-test',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
 for(let n=0;n<100;n++) {
  if((await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary){await mongoose.disconnect();await mongoose.connect(uri);return;}
  await new Promise(r=>setTimeout(r,100));
 }
 throw new Error('Replica election failed');
}
async function fixture(){
 const id=()=>new mongoose.Types.ObjectId();
 const inventory=await I.create({variantId:id(),internalCode:'TEST-'+randomUUID().toUpperCase(),status:'active',condition:'good'});
 return (await R.create({reservationNumber:'AK-2030-'+randomUUID().slice(0,6).toUpperCase(),customerSnapshot:{firstName:'Test',lastName:'User',email:'test@example.test',phone:'+420777111222'},items:[{productId:id(),variantId:id(),inventoryItemId:inventory._id,productNameSnapshot:'Fixture',sizeSnapshot:'98',rentalPriceSnapshot:700,depositSnapshot:2000}],rentalMode:'studio',startDate:new Date('2030-01-01'),endDate:new Date('2030-01-01'),status:'pending',expiresAt:new Date(Date.now()+900000),subtotal:700,deposit:2000,totalDue:2700,advanceRequired:200,paymentRevision:0,paymentEntries:[],paymentStatus:'unpaid'})).toObject();
}
const fresh=r=>R.findById(r._id).lean().exec();
const orderFor=r=>[...orders.values()].find(o=>r.revolutAttempts?.some(a=>a.id===o.merchant_order_data.reference));
async function main(){
 await start();
 const raw=Buffer.from('{"event":"ORDER_COMPLETED"}'),timestamp=String(Date.now());
 const signature='v1='+createHmac('sha256',process.env.REVOLUT_WEBHOOK_SECRET).update('v1.'+timestamp+'.').update(raw).digest('hex');
 assert.ok(client.verifyRevolutSignature(raw,timestamp,signature));
 assert.ok(client.verifyRevolutSignature(raw,timestamp,'v1='+'0'.repeat(64)+', '+signature));
 assert.ok(!client.verifyRevolutSignature(Buffer.from('{}'),timestamp,signature));
 assert.ok(!client.verifyRevolutSignature(raw,timestamp,signature,Date.now()+301000));
 assert.ok(!client.verifyRevolutSignature(raw,Number(timestamp),signature));
 assert.ok(!client.verifyRevolutSignature(undefined,timestamp,signature));
 let r=await fixture();assert.equal(cardAmounts(r,'advance').amount,200);assert.equal(cardAmounts(r,'full').amount,2700);
 assert.throws(()=>cardAmounts({...r,expiresAt:new Date(0)},'full'));
 assert.throws(()=>cardAmounts({...r,status:'cancelled'},'full'));
 const before=posts;
 const competing=await Promise.allSettled([createCardOrder(r,'full'),createCardOrder(r,'full')]);
 assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);assert.equal(posts-before,1);
 r=await fresh(r);const order=orderFor(r);
 assert.equal((await createCardOrder(r,'full')).publicId,order.token);assert.equal(posts-before,1);
 await assert.rejects(createCardOrder(r,'advance'));
 await assert.rejects(recordPayment(r._id,{operationId:randomUUID(),expectedRevision:r.paymentRevision,type:'rental_received',amount:200,method:'cash'},'fixture'));
 order.state='completed';await Promise.all([reconcileCardOrder(order.id),reconcileCardOrder(order.id)]);
 r=await fresh(r);assert.equal(r.paymentEntries.length,2);assert.equal(paymentSummary(r).rentalNet,700);assert.equal(paymentSummary(r).depositHeld,2000);
 assert.equal(r.paymentStatus,'paid');assert.equal(r.status,'confirmed');assert.equal(r.expiresAt,null);assert.equal(r.partnerAudit.filter(a=>a.action==='confirm').length,1);assert.equal(r.partnerAudit.find(a=>a.action==='confirm').by,'revolut');assert.equal(r.revolutActiveAttempt,undefined);assert.ok(r.invoiceAutomation);
 const revision=r.paymentRevision;await reconcileCardOrder(order.id);assert.equal((await fresh(r)).paymentRevision,revision);
 // Late payment is retained in the ledger, but never revives the booking or invoices automatically.
 r=await fixture();await createCardOrder(r,'advance');r=await fresh(r);const late=orderFor(r);await R.updateOne({_id:r._id},{$set:{expiresAt:new Date(0)}});late.state='completed';const invoiceBefore=invoices;
 await reconcileCardOrder(late.id);r=await fresh(r);assert.equal(r.paymentEntries[0].amount,200);assert.equal(r.status,'pending');assert.equal(r.revolutAttempts[0].reviewRequired,true);assert.equal(invoices,invoiceBefore);
 await reconcileCardOrder(late.id);assert.equal(invoices,invoiceBefore);assert.throws(()=>cardAmounts(r,'full'));
 // Cancellation uses provider state, is repeatable, and allows a new attempt only afterwards.
 r=await fixture();await createCardOrder(r,'advance');await cancelCardOrder(r);r=await fresh(r);assert.equal(r.revolutActiveAttempt,undefined);assert.equal(r.paymentEntries.length,0);
 const closed=orderFor(r);const closedRevision=r.paymentRevision;await reconcileCardOrder(closed.id);assert.equal((await fresh(r)).paymentRevision,closedRevision);
 await createCardOrder(r,'full');
 // Lost create response stays locked, then a signed notification can recover by merchant reference.
 r=await fixture();unknown=true;await assert.rejects(createCardOrder(r,'advance'));unknown=false;r=await fresh(r);const lost=orderFor(r);const lostPosts=posts;
 await assert.rejects(createCardOrder(r,'advance'));assert.equal(posts,lostPosts);lost.state='completed';await reconcileCardOrder(lost.id);r=await fresh(r);assert.equal(r.paymentEntries.length,1);assert.equal(r.revolutActiveAttempt,undefined);
 // Advance automatically confirms too; an interrupted post-payment step resumes on replay.
 r=await fixture();await createCardOrder(r,'advance');r=await fresh(r);const recover=orderFor(r);recover.state='completed';
 const confirm=reservationAdminService.confirm;reservationAdminService.confirm=async()=>{throw new Error('fixture interruption');};
 await assert.rejects(reconcileCardOrder(recover.id));reservationAdminService.confirm=confirm;
 r=await fresh(r);assert.equal(r.status,'pending');assert.equal(r.paymentEntries.length,1);assert.equal(r.invoiceAutomation,undefined);
 await reconcileCardOrder(recover.id);r=await fresh(r);assert.equal(r.status,'confirmed');assert.equal(r.paymentEntries.length,1);assert.equal(paymentSummary(r).rentalBalance,500);
 // A competing reservation wins availability; payment never displaces it.
 r=await fixture();await createCardOrder(r,'advance');r=await fresh(r);const conflict=orderFor(r);
 await R.collection.insertOne({...r,_id:new mongoose.Types.ObjectId(),reservationNumber:'AK-2030-BLOCK1',status:'confirmed',revolutAttempts:[],revolutActiveAttempt:undefined});
 conflict.state='completed';await reconcileCardOrder(conflict.id);r=await fresh(r);
 assert.equal(r.status,'pending');assert.equal(r.revolutAttempts[0].reviewRequired,true);assert.equal(r.invoiceAutomation,undefined);assert.equal(r.paymentEntries.length,1);
 // Hold expiry between the ledger write and confirmation must also block auto-confirmation.
 r=await fixture();await createCardOrder(r,'advance');r=await fresh(r);const expiredDuring=orderFor(r);expiredDuring.state='completed';
 reservationAdminService.confirm=async(id,options)=>{await R.updateOne({_id:id},{$set:{expiresAt:new Date(0)}});return confirm.call(reservationAdminService,id,options);};
 await reconcileCardOrder(expiredDuring.id);reservationAdminService.confirm=confirm;r=await fresh(r);
 assert.equal(r.status,'pending');assert.equal(r.revolutAttempts[0].reviewRequired,true);assert.equal(r.invoiceAutomation,undefined);
 // Mismatched amount/currency/reference never reaches the ledger.
 r=await fixture();await createCardOrder(r,'advance');r=await fresh(r);const bad=orderFor(r);bad.state='completed';bad.currency='EUR';await assert.rejects(reconcileCardOrder(bad.id));assert.equal((await fresh(r)).paymentEntries.length,0);
 // Public endpoints require reservation authorization, independent of guessed number.
 let code;const res={setHeader(){},status(n){code=n;return this;},json(v){return v;}};
 await revolutReservation('create')({params:{reservationNumber:r.reservationNumber},headers:{},body:{kind:'full'}},res,e=>{throw e;});assert.equal(code,404);
 await revolutWebhook({headers:{},body:{event:'ORDER_COMPLETED',order_id:bad.id}},res,e=>{throw e;});assert.equal(code,401);
 console.log('PASS Revolut: real Mongo concurrency, amount binding, duplicate events, late payments, cancellation, unknown creation, signature and authorization');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await mongoose.disconnect();if(child && child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}if(dir)rmSync(dir,{recursive:true,force:true});clearTimeout(watchdog);});
