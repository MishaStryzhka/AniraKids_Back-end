// Own disposable replica set only. Never load .env, application bootstrap or an external URI.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const net=require('node:net');
const mongoose=require('mongoose');
async function main(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.FITTING_DISCOUNT_TEST_ALLOW,'1');
 const directory=mkdtempSync(`${tmpdir()}/invoice-test-`),server=net.createServer();
 const port=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));}));
 const child=spawn(process.env.FITTING_DISCOUNT_MONGOD_BINARY||'mongod',['--bind_ip','127.0.0.1','--port',String(port),'--dbpath',directory,'--replSet','invoiceTest','--nounixsocket'],{stdio:['ignore','pipe','pipe']});
 const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
 try{
 await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(d.toString().includes('Waiting for connections'))resolve();});child.once('error',reject);child.once('exit',()=>reject(new Error('Mongo stopped')));});
 const uri=`mongodb://127.0.0.1:${port}/invoice_test?directConnection=true`;
 await mongoose.connect(uri);await mongoose.connection.db.admin().command({replSetInitiate:{_id:'invoiceTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
 for(let i=0;i<100;i++){if((await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary)break;await new Promise(r=>setTimeout(r,100));}
 await mongoose.disconnect();await mongoose.connect(uri);

 const sender=require.resolve('../helpers/sendEmail');const emails=[];require.cache[sender]={id:sender,filename:sender,loaded:true,exports:async message=>{emails.push(message);}};
 const {FittingModel:F}=require('../build/v2/models/fitting.model');
 const {ReservationV2Model:R,InventoryItemV2Model:I,AvailabilityBlockV2Model:B}=require('../build/v2/models');
 const {createReservationAtomically:create}=require('../build/v2/services/concurrency.service');
 const {customerDiscountOptions:options,releaseUnusedFittingDiscounts:release}=require('../build/v2/services/fitting-discount.service');
 const {notifyFittingDiscount}=require('../build/v2/services/fitting-discount-email.service');
 const {actOnFitting}=require('../build/v2/services/fitting.service');
 const {recordPayment,paymentSummary,publicPaymentSummary}=require('../build/v2/services/payment.service');
 const {hashReservationFingerprint}=require('../build/v2/utils/idempotency');
 const {randomBytes,randomUUID,createHash}=require('crypto');
 await Promise.all([F.init(),R.init(),I.init(),B.init()]);
 const now=new Date(),owner=new mongoose.Types.ObjectId(),other=new mongoose.Types.ObjectId(),token=randomBytes(32).toString('hex');
 const fit=await F.create({number:'ZK-ABCDEF123456',operationId:randomUUID(),requestHash:'fixture',tokenHash:createHash('sha256').update(token).digest('hex'),creditOperationId:randomUUID(),date:'2026-10-01',time:'10:00',startAt:new Date('2026-10-01'),address:'Test',expiresAt:new Date(),status:'completed',paymentStatus:'paid',customerId:owner,customer:{name:'Jana',email:'jana@example.test',phone:'123456'},audit:[]});
 assert.equal((await options(owner)).items.length,1);assert.equal((await options(other)).items.length,0);assert.equal((await options()).items.length,0);
 assert.equal((await options(undefined,{number:fit.number,token:'0'.repeat(64)})).items.length,0);
 assert.equal((await options(undefined,{number:fit.number,token})).items.length,1);
 await Promise.all([notifyFittingDiscount(fit.toObject()),notifyFittingDiscount(fit.toObject())]);assert.equal(emails.length,1);assert.match(emails[0].text,/Vybrat šaty a započíst 200 Kč/);
 const capability=emails[0].text.match(/#fitting=ZK-ABCDEF123456&token=([a-f0-9]{64})/)[1];
 assert.equal((await options(undefined,{number:fit.number,token:capability})).items.length,1);
 let sequence=0;
 async function input(selection={number:fit.number},customerId=owner){const iid=new mongoose.Types.ObjectId(),vid=new mongoose.Types.ObjectId(),pid=new mongoose.Types.ObjectId();await I.collection.insertOne({_id:iid,variantId:vid,internalCode:'TEST-'+(++sequence),status:'active',condition:'good'});return {reservationNumber:'AK-2026-'+String(sequence).padStart(6,'0'),customerId,customerSnapshot:{firstName:'Jana',lastName:'Test',email:'jana@example.test',phone:'123456'},items:[{productId:pid,variantId:vid,inventoryItemId:iid,productNameSnapshot:'Šaty',sizeSnapshot:'110',rentalPriceSnapshot:1000,depositSnapshot:500}],rentalMode:'studio',startDate:new Date('2030-01-01'),endDate:new Date('2030-01-02'),status:'pending',expiresAt:new Date(now.getTime()+900000),subtotal:1000,deposit:500,totalDue:1500,advanceRequired:200,paymentRevision:0,paymentEntries:[],paymentStatus:'unpaid',now,...(selection?{fittingDiscountSelection:selection}:{})};}
 await assert.rejects(create(await input({number:fit.number},other)),e=>e.code==='FITTING_DISCOUNT_UNAVAILABLE');assert.equal(await R.countDocuments(),0);
 const mismatch=await input({number:fit.number,token},undefined);mismatch.customerSnapshot.email='other@example.test';await assert.rejects(create(mismatch),e=>e.code==='FITTING_DISCOUNT_UNAVAILABLE');assert.equal(await R.countDocuments(),0);
 const concurrent=await Promise.allSettled([create(await input()),create(await input({number:fit.number,token:capability},undefined))]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(await R.countDocuments(),1);
 const winning=concurrent.find(r=>r.status==='fulfilled').value;assert.equal(winning.subtotal,800);assert.equal(winning.totalDue,1300);assert.equal(winning.items[0].rentalPriceSnapshot,1000);assert.equal(winning.paymentEntries.length,0);assert.equal((await options(owner)).items.length,0);
 await R.updateOne({_id:winning._id},{$set:{expiresAt:new Date(now.getTime()-1)}});await release(now);const expired=await R.findById(winning._id);assert.equal(expired.fittingCreditId,undefined);assert.equal(expired.subtotal,1000);assert.equal(expired.paymentRevision,1);assert.equal((await options(owner)).items.length,1);
 const again=await create(await input());await R.updateOne({_id:again._id},{$set:{status:'cancelled'}});await release(now);assert.equal((await options(owner)).items.length,1);
 const paid=await create(await input());
 assert.equal(paymentSummary(paid).advanceBalance,0);
 assert.equal(paymentSummary(paid).fittingCredit,200);
 assert.equal(publicPaymentSummary(paid).paymentInstructions,null);
 assert.equal(publicPaymentSummary(paid).fullPaymentInstructions.amount,1300);
 await assert.rejects(recordPayment(paid._id,{operationId:randomUUID(),expectedRevision:0,type:'advance_received',amount:200,method:'bank_transfer'},'fixture'),e=>e.code==='PAYMENT_LIMIT_EXCEEDED');
 await recordPayment(paid._id,{operationId:randomUUID(),expectedRevision:0,type:'rental_received',amount:200,method:'bank_transfer'},'fixture');await R.updateOne({_id:paid._id},{$set:{status:'cancelled'}});await release(now);assert.equal((await options(owner)).items.length,0);assert.equal((await R.findById(paid._id)).fittingCreditId,String(fit._id));
 // Existing 800 Kč reservation: the paid fitting covers the advance once,
 // leaves 600 Kč (not 400 Kč), and never invents another payment entry.
 const studio={...paid,items:[{...paid.items[0],rentalPriceSnapshot:800,depositSnapshot:0}],subtotal:600,deposit:0,totalDue:600,paymentEntries:[]};
 const before=JSON.stringify(studio);
 for(let i=0;i<2;i++){
  assert.equal(paymentSummary(studio).advanceBalance,0);
  assert.equal(paymentSummary(studio).rentalBalance,600);
  assert.equal(paymentSummary(studio).rentalReceived,0);
  assert.equal(publicPaymentSummary(studio).paymentInstructions,null);
  assert.match(publicPaymentSummary(studio).fullPaymentInstructions.qrPayload,/\*AM:600\.00\*/);
 }
 assert.equal(JSON.stringify(studio),before);
 const extra={...studio,paymentEntries:[{operationId:randomUUID(),type:'rental_received',amount:200,method:'cash',recordedAt:now,recordedBy:'fixture'}]};
 assert.equal(paymentSummary(extra).rentalBalance,400);
 const legacy={...studio,subtotal:800,totalDue:800,fittingDiscount:undefined,paymentEntries:extra.paymentEntries};
 assert.equal(paymentSummary(legacy).fittingCredit,0);assert.equal(paymentSummary(legacy).rentalBalance,600);assert.equal(paymentSummary(legacy).advanceBalance,0);
 const freeFit=await F.create({...fit.toObject(),_id:new mongoose.Types.ObjectId(),number:'ZK-ABCDEF123457',operationId:randomUUID()});
 const manualData=await input(null);manualData.status='confirmed';manualData.paymentEntries=[{operationId:randomUUID(),type:'rental_received',amount:1000,method:'cash',recordedAt:now,recordedBy:'fixture'}];const manual=await R.create(manualData);
 await actOnFitting(String(freeFit._id),{action:'credit',revision:0,reservationNumber:manual.reservationNumber},'fixture');const adjusted=await R.findById(manual._id);assert.equal(adjusted.subtotal,800);assert.equal(adjusted.paymentEntries[0].amount,1000);
 const fingerprint={productId:'111111111111111111111111',variantId:'222222222222222222222222',rentalMode:'studio',startDate:'2030-01-01',endDate:'2030-01-02',customer:manualData.customerSnapshot};assert.notEqual(hashReservationFingerprint(fingerprint),hashReservationFingerprint({...fingerprint,fittingDiscount:{number:fit.number,token}}));
 console.log('PASS: account/private capability ownership, no email-only access, completion email once, concurrent baskets, atomic discount totals, expiry/cancellation release, paid cancellation retention, manual paid-order overpayment, idempotency fingerprint');
 }finally{clearTimeout(timer);await mongoose.disconnect();child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));rmSync(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
