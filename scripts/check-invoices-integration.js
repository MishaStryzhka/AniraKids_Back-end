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
 const {InvoiceModel:I,InvoiceCounter:C}=require('../build/v2/models/invoice.model');
 const {FittingModel:F}=require('../build/v2/models/fitting.model');
 const {ReservationV2Model:R}=require('../build/v2/models/reservation-v2.model');
 const {invoicePreview,issueInvoice,correctInvoice,invoicePeriod}=require('../build/v2/services/invoice.service');
 const {invoicePdf,invoiceArchive}=require('../build/v2/services/invoice-document.service');
 await Promise.all([I.init(),C.init(),F.init(),R.init()]);
 const now=new Date(),year=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(now).slice(0,4);
 const fitting={number:'ZK-INVOICE-1',operationId:'fixture',requestHash:'test',tokenHash:'test',creditOperationId:'test',date:'2026-10-10',time:'10:00',startAt:new Date('2026-10-10'),address:'Test',status:'completed',paymentStatus:'paid',customer:{name:'Žofie Černá',email:'invoice@example.test',phone:'123'},audit:[{action:'confirm',at:now,by:'fixture'},{action:'complete',at:now,by:'fixture'}]};
 await F.create(fitting);
 const input={type:'fitting',number:fitting.number,buyerName:'Žofie Černá',buyerAddress:'Příčná 12, Praha',buyerIco:''};
 const preview=await invoicePreview(input);assert.equal(preview.snapshot.total,200);assert.equal(preview.snapshot.balance,0);
 await assert.rejects(issueInvoice({...input,fingerprint:'0'.repeat(64)},'fixture'),e=>e.code==='INVOICE_PREVIEW_CHANGED');assert.equal(await C.countDocuments(),0);
 const issued=await Promise.all(Array.from({length:4},()=>issueInvoice({...input,fingerprint:preview.fingerprint},'fixture')));
 assert.equal(new Set(issued.map(i=>i.number)).size,1);assert.equal(await I.countDocuments(),1);assert.equal(issued[0].number,`${year}-0001`);
 await F.updateOne({number:fitting.number},{$set:{'customer.name':'Changed'}});assert.equal((await I.findOne()).snapshot.buyer.name,'Žofie Černá');
 await F.create({...fitting,number:'ZK-UNFINISHED',operationId:'unfinished',status:'confirmed'});
 await assert.rejects(invoicePreview({...input,number:'ZK-UNFINISHED'}),e=>e.code==='INVOICE_SERVICE_NOT_COMPLETED');
 const rid=new mongoose.Types.ObjectId();
 await R.collection.insertOne({_id:rid,reservationNumber:'R-INVOICE',status:'returned',subtotal:800,deposit:1000,totalDue:1800,paymentStatus:'paid',fittingDiscount:{amount:200,number:fitting.number},startDate:new Date('2026-10-01'),endDate:new Date('2026-10-03'),customerSnapshot:{firstName:'Žofie',lastName:'Černá',email:'invoice@example.test',phone:'123'},items:[{productNameSnapshot:'Slavnostní šaty',sizeSnapshot:'110',rentalPriceSnapshot:1000}],paymentEntries:[{operationId:'advance',type:'advance_received',amount:200,method:'bank_transfer',recordedAt:now,recordedBy:'fixture'},{operationId:'balance',type:'rental_received',amount:600,method:'cash',recordedAt:now,recordedBy:'fixture'},{operationId:'deposit',type:'deposit_received',amount:1000,method:'cash',recordedAt:now,recordedBy:'fixture'}],paymentRevision:3,updatedAt:now});
 const ri={...input,type:'reservation',number:'R-INVOICE'},rp=await invoicePreview(ri);
 assert.equal(rp.snapshot.total,800);assert.equal(rp.snapshot.paid,800);assert.equal(rp.snapshot.deposit,1000);assert.equal(rp.snapshot.lines[1].amount,-200);
 const rental=await issueInvoice({...ri,fingerprint:rp.fingerprint},'fixture');assert.equal(rental.number,`${year}-0002`);
 const correction=await correctInvoice(String(rental._id),'Chybně vystaveno','fixture');assert.equal(correction.snapshot.total,-800);assert.equal(correction.snapshot.originalNumber,rental.number);
 assert.equal((await correctInvoice(String(rental._id),'Chybně vystaveno','fixture')).number,correction.number);assert.equal((await R.findById(rid)).paymentEntries.length,3);
 await assert.rejects(correctInvoice(String(correction._id),'Znovu opravena','fixture'),e=>e.code==='INVOICE_ALREADY_CORRECTION');
 assert.equal(invoicePeriod('2026-07').issuedAt.$gte.toISOString(),'2026-06-30T22:00:00.000Z');
 assert.equal(invoicePeriod('2026').issuedAt.$gte.toISOString(),'2025-12-31T23:00:00.000Z');
 const pdf=await invoicePdf(rental);assert.equal(pdf.subarray(0,4).toString(),'%PDF');writeFileSync('/tmp/invoice-preview.pdf',pdf);
 const archive=unzipSync(await invoiceArchive(await I.find().lean(),year));assert.equal(Object.keys(archive).filter(k=>k.endsWith('.pdf')).length,3);assert.match(strFromU8(archive['platby-a-vratky.csv']),/deposit_received/);assert.match(strFromU8(archive['faktury.csv']),/Žofie Černá/);
 const {invoiceHandler}=require('../build/v2/controllers/invoice.controller');let status;await invoiceHandler('list')({headers:{},adminOwner:false},{status:n=>{status=n;return {json:()=>{}};}},e=>{throw e;});assert.equal(status,403);
 console.log('PASS invoices: transactional numbering, concurrent retries, stale preview, immutable snapshots, discount, deposits, corrections, exports, Prague boundaries, PDF and owner guard');
 }finally{clearTimeout(timer);await mongoose.disconnect();child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));rmSync(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
