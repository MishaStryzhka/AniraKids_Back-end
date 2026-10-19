// Own disposable replica set only. Never load .env, application bootstrap or an external URI.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const net=require('node:net');
const mongoose=require('mongoose');
const {unzipSync,strFromU8}=require('fflate');
async function main(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.INVOICE_TEST_ALLOW,'1');
 const directory=mkdtempSync(`${tmpdir()}/invoice-test-`),server=net.createServer();
 const port=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));}));
 const child=spawn(process.env.INVOICE_MONGOD_BINARY||'mongod',['--bind_ip','127.0.0.1','--port',String(port),'--dbpath',directory,'--replSet','invoiceTest','--nounixsocket'],{stdio:['ignore','pipe','pipe']});
 const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
 try{
 await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(d.toString().includes('Waiting for connections'))resolve();});child.once('error',reject);child.once('exit',()=>reject(new Error('Mongo stopped')));});
 const uri=`mongodb://127.0.0.1:${port}/invoice_test?directConnection=true`;
 await mongoose.connect(uri);await mongoose.connection.db.admin().command({replSetInitiate:{_id:'invoiceTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
 for(let i=0;i<100;i++){if((await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary)break;await new Promise(r=>setTimeout(r,100));}
 await mongoose.disconnect();await mongoose.connect(uri);

 const mail=require('./fitting-email-fixture');
 const {randomUUID,randomBytes}=require('crypto');
 const {InvoiceModel:I,InvoiceCounter:C}=require('../build/v2/models/invoice.model');
 const {FittingModel:F}=require('../build/v2/models/fitting.model');
 const {ReservationV2Model:R}=require('../build/v2/models/reservation-v2.model');
 const {fittingHandler}=require('../build/v2/controllers/fitting.controller');
 const {adminRecordPayment}=require('../build/v2/controllers/admin-payments.controller');
 const {invoiceHandler}=require('../build/v2/controllers/invoice.controller');
 const {processAutomaticInvoice,requestAutomaticInvoice,pendingAutomaticInvoices}=require('../build/v2/services/invoice-automation.service');
 const {sendInvoice}=require('../build/v2/services/invoice-email.service');
 const {recordPayment}=require('../build/v2/services/payment.service');
 const {actOnFitting}=require('../build/v2/services/fitting.service');
 await Promise.all([I.init(),C.init(),F.init(),R.init()]);
 const now=new Date(),actor=new mongoose.Types.ObjectId();let seq=0;
 const fitting=async(patch={})=>F.create({number:'ZK-'+String(++seq).padStart(12,'0'),operationId:randomUUID(),requestHash:'fixture',tokenHash:randomBytes(32).toString('hex'),creditOperationId:randomUUID(),date:'2030-01-10',time:'10:00',startAt:new Date('2030-01-10'),expiresAt:new Date(Date.now()+3600000),address:'Test',slotKey:randomUUID(),status:'review',paymentStatus:'unpaid',customer:{name:'Žofie Černá',email:'invoice@example.test',phone:'123'},audit:[],...patch});
 const rental=async(patch={})=>{const id=new mongoose.Types.ObjectId();await R.collection.insertOne({_id:id,reservationNumber:'AK-2030-'+String(++seq).padStart(6,'0'),status:'confirmed',subtotal:800,deposit:1000,totalDue:1800,paymentStatus:'unpaid',advanceRequired:200,paymentRevision:0,paymentEntries:[],startDate:new Date('2030-01-10'),endDate:new Date('2030-01-11'),customerSnapshot:{firstName:'Žofie',lastName:'Černá',email:'invoice@example.test',phone:'123'},items:[{productNameSnapshot:'Šaty',sizeSnapshot:'110',rentalPriceSnapshot:1000}],fittingDiscount:{amount:200,number:'ZK-000000000001'},...patch});return R.findById(id).lean();};
 async function call(handler,body,params={}){let code=200,result;await handler({headers:{},params,body,authenticatedUserId:actor,adminOwner:true},{setHeader:()=>{},status(n){code=n;return this;},json(x){result=x;return x;}},e=>{throw e;});return {code,body:result};}
 const f=await fitting();const confirm=()=>call(fittingHandler('act'),{action:'confirm',revision:0},{fittingId:String(f._id)});
 const confirmation=await confirm();assert.equal(confirmation.code,200);assert.equal(confirmation.body.invoiceAutomation.emailStatus,'sent');
 const fi=await I.findOne({sourceKey:'fitting:'+f._id}).lean();assert.equal(fi.snapshot.total,200);assert.equal(fi.snapshot.paid,200);assert.equal(fi.snapshot.serviceDatePlanned,true);assert.equal(fi.snapshot.buyer.address,'');assert.equal(fi.snapshot.buyer.email,'invoice@example.test');assert.equal(fi.email.status,'sent');
 const fm=mail.messages.filter(m=>m.subject.startsWith('Faktura '));assert.equal(fm.length,1);assert.equal(Buffer.from(fm[0].attachments[0].content,'base64').subarray(0,4).toString(),'%PDF');assert.match(fm[0].text,/200/);
 await Promise.all([confirm(),confirm()]);assert.equal(await I.countDocuments(),1);assert.equal(mail.messages.filter(m=>m.subject.startsWith('Faktura ')).length,1);
 const r=await rental();const input={operationId:randomUUID(),expectedRevision:0,type:'advance_received',amount:200,method:'bank_transfer'};
 const pay=()=>call(adminRecordPayment,input,{reservationId:String(r._id)});
 const payments=await Promise.all([pay(),pay()]);assert.ok(payments.every(x=>x.code===200));
 let ri=await I.findOne({sourceKey:'reservation:'+r._id}).lean();assert.equal(ri.snapshot.total,800);assert.equal(ri.snapshot.paid,200);assert.equal(ri.snapshot.balance,600);assert.equal(ri.snapshot.lines[1].amount,-200);assert.equal(ri.snapshot.deposit,0);assert.equal((await R.findById(r._id)).paymentEntries.length,1);
 assert.equal(mail.messages.filter(m=>m.subject.includes(ri.number)).length,1);
 await call(adminRecordPayment,{...input,operationId:randomUUID(),expectedRevision:1,type:'rental_received',amount:600},{reservationId:String(r._id)});
 await call(adminRecordPayment,{...input,operationId:randomUUID(),expectedRevision:2,type:'deposit_received',amount:1000},{reservationId:String(r._id)});
 const unchanged=await I.findById(ri._id).lean();assert.deepEqual(unchanged.snapshot,ri.snapshot);assert.equal(mail.messages.filter(m=>m.subject.includes(ri.number)).length,1);
 const depositOnly=await rental();await call(adminRecordPayment,{...input,operationId:randomUUID(),type:'deposit_received',amount:1000},{reservationId:String(depositOnly._id)});assert.equal(await I.countDocuments({sourceKey:'reservation:'+depositOnly._id}),0);
 const cancelled=await rental({status:'cancelled'});await call(adminRecordPayment,{...input,operationId:randomUUID(),type:'rental_received',amount:200,note:'Late transfer'},{reservationId:String(cancelled._id)});assert.equal(await I.countDocuments({sourceKey:'reservation:'+cancelled._id}),0);
 const failed=await rental();mail.failNext=true;const failedPay=await call(adminRecordPayment,{...input,operationId:randomUUID()},{reservationId:String(failed._id)});assert.equal(failedPay.code,200);assert.equal(failedPay.body.invoiceAutomation.emailStatus,'failed');assert.equal((await R.findById(failed._id)).paymentEntries.length,1);
 const failedInvoice=await I.findOne({sourceKey:'reservation:'+failed._id}).lean(),attempted=mail.messages.length;
 await processAutomaticInvoice('reservation',String(failed._id));assert.equal(mail.messages.length,attempted,'no ambiguous automatic resend');
 const retry={retry:true,expectedAttemptedAt:failedInvoice.email.attemptedAt.toISOString()};const retries=await Promise.allSettled([sendInvoice(String(failedInvoice._id),retry),sendInvoice(String(failedInvoice._id),retry)]);assert.equal(retries.filter(x=>x.status==='fulfilled').length,1);assert.equal(mail.messages.length,attempted+1);assert.equal((await I.findById(failedInvoice._id)).email.status,'sent');
 // Recovery after process interruption between recording the payment and issuing/sending.
 const queued=await rental();await recordPayment(queued._id,{...input,operationId:randomUUID()},String(actor));assert.ok((await pendingAutomaticInvoices()).items.some(x=>x.number===queued.reservationNumber));await processAutomaticInvoice('reservation',String(queued._id));assert.equal((await I.findOne({sourceKey:'reservation:'+queued._id})).email.status,'sent');
 // A snapshot failure remains visible, but never undoes or duplicates the payment.
 const invalid=await rental({items:[{productNameSnapshot:'Šaty',sizeSnapshot:'110',rentalPriceSnapshot:999}]});const invalidPay=await call(adminRecordPayment,{...input,operationId:randomUUID()},{reservationId:String(invalid._id)});assert.equal(invalidPay.code,200);assert.equal(invalidPay.body.invoiceAutomation.status,'pending');assert.equal((await R.findById(invalid._id)).paymentEntries.length,1);assert.ok((await pendingAutomaticInvoices()).items.some(x=>x.number===invalid.reservationNumber));
 const historic=await fitting({status:'confirmed',paymentStatus:'paid',audit:[{action:'confirm',at:now,by:String(actor)}]});assert.equal(await I.countDocuments({sourceKey:'fitting:'+historic._id}),0);await requestAutomaticInvoice({type:'fitting',number:historic.number},String(actor));assert.equal((await I.findOne({sourceKey:'fitting:'+historic._id})).email.status,'sent');
 const unpaid=await fitting();await assert.rejects(requestAutomaticInvoice({type:'fitting',number:unpaid.number},String(actor)),e=>e.code==='INVOICE_AUTOMATION_NOT_ELIGIBLE');
 const forbidden=await call(async(req,res,next)=>invoiceHandler('process')({...req,adminOwner:false},res,next),{type:'fitting',number:unpaid.number});assert.equal(forbidden.code,403);
 // A PDF failure after invoice commit leaves a retriable, unsent document.
 const pdfModule=require('../build/v2/services/invoice-document.service'),originalPdf=pdfModule.invoicePdf;
 const interrupted=await rental();await recordPayment(interrupted._id,{...input,operationId:randomUUID()},String(actor));
 pdfModule.invoicePdf=async()=>{throw new Error('fixture PDF failure');};
 const pdfFailure=await processAutomaticInvoice('reservation',String(interrupted._id));assert.equal(pdfFailure.status,'issued');assert.equal(pdfFailure.emailStatus,'pending');
 const beforePdfRetry=await I.findOne({sourceKey:'reservation:'+interrupted._id}).lean();assert.equal(beforePdfRetry.email.status,'pending');
 pdfModule.invoicePdf=originalPdf;await processAutomaticInvoice('reservation',String(interrupted._id));assert.equal((await I.findById(beforePdfRetry._id)).email.status,'sent');
 assert.equal(await I.countDocuments(),6);assert.equal((await C.findOne()).value,6);
 writeFileSync('/tmp/automatic-fitting-invoice.pdf',Buffer.from(fm[0].attachments[0].content,'base64'));
 console.log('PASS automatic invoices: fitting confirmation, partial/full rental payments, discount/deposit separation, concurrent retries, immutable snapshots, provider failure, explicit retry CAS, interrupted-job recovery, historical opt-in and owner guard');
 }finally{clearTimeout(timer);await mongoose.disconnect();child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));rmSync(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
