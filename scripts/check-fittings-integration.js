const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {FittingModel}=require('../build/v2/models/fitting.model');
const {FittingSettingsModel,defaultFittingSettings,parseFittingSettings,saveFittingSettings,fittingSlots}=require('../build/v2/services/fitting-settings.service');
const api=require('../build/v2/services/fitting.service');
const {ReservationV2Model:Reservation}=require('../build/v2/models/reservation-v2.model');
const {paymentSummary,parsePaymentInput}=require('../build/v2/services/payment.service');
module.exports=async({test,registry,insertOwned})=>{
 registry.set(FittingModel,[]);registry.set(FittingSettingsModel,['fittings']);
 const settings={...defaultFittingSettings(),enabled:true,address:'Testovací adresa 1',weekly:defaultFittingSettings().weekly.map(d=>({...d,enabled:true,start:'09:00',end:'18:00'}))};
 const now=new Date('2030-01-01T00:00:00Z'),ops=[];
 const input=(date='2030-01-07',time='09:00',email=randomUUID()+'@example.test')=>{const v={operationId:randomUUID(),token:randomBytes(32).toString('hex'),date,time,name:'Test zákazník',email,phone:'+420123456789'};ops.push(v.operationId);return v;};
 const doc=async number=>FittingModel.findOne({number}).lean();
 const act=async(number,action,extra={},when=now)=>{const d=await doc(number);return api.actOnFitting(String(d._id),{action,revision:d.revision,...extra},'admin-test',when);};
 const reject=(promise,code)=>assert.rejects(promise,e=>e.code===code);
 try{
  await test('Fittings settings reject invalid schedules and handle Prague DST',async()=>{
   assert.equal(parseFittingSettings({...settings,weekly:settings.weekly.map(d=>({...d,start:'09:15'}))}),null);
   assert.equal(parseFittingSettings({...settings,address:''}),null);
   assert.equal(parseFittingSettings({...settings,blockedDates:['2030-02-31']}),null);
   assert.equal(fittingSlots('2030-01-07',{...settings,enabled:false},now).length,0);
   assert.equal(fittingSlots('2030-01-07',{...settings,blockedDates:['2030-01-07']},now).length,0);
   const dst={...settings,weekly:settings.weekly.map(d=>({...d,start:'00:00',end:'05:00'}))};
   assert.ok(!fittingSlots('2026-03-29',dst,new Date('2026-03-01')).some(s=>s.time.startsWith('02:')));
   assert.ok(!fittingSlots('2026-10-25',dst,new Date('2026-10-01')).some(s=>s.time.startsWith('02:')));
   await saveFittingSettings(settings);
  });
  await test('Fittings atomically reject two customers for one slot and protect private status',async()=>{
   const a=input(),b=input();const results=await Promise.allSettled([api.createFitting(a,now),api.createFitting(b,now)]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const winner=results[0].status==='fulfilled'?a:b,receipt=results.find(r=>r.status==='fulfilled').value;
   assert.equal(receipt.price,200);assert.ok(receipt.paymentInstructions.qrPayload.includes('*AM:200.00*'));assert.equal(receipt.customer,undefined);
   assert.deepEqual(await api.createFitting({...winner},now),receipt);
   await reject(api.createFitting({...winner,name:'Changed'},now),'IDEMPOTENCY_CONFLICT');
   await reject(api.readFitting(receipt.number,'a'.repeat(64),now),'FITTING_NOT_FOUND');
   assert.equal((await api.availableFittingSlots(a.date,now)).slots.includes(a.time),false);
  });
  await test('Fitting payment report holds slot without treating payment as received',async()=>{
   const v=input('2030-01-07','10:00'),r=await api.createFitting(v,now);
   const reported=await api.reportFittingPayment(r.number,v.token,now);
   assert.equal(reported.status,'review');assert.equal(reported.paymentStatus,'unpaid');assert.equal(reported.paymentInstructions,null);
   await api.expireFittings(new Date(now.getTime()+3600000));assert.equal((await doc(r.number)).status,'review');
   await act(r.number,'confirm');assert.equal((await doc(r.number)).paymentStatus,'paid');
   const second=input('2030-01-07','10:30'),r2=await api.createFitting(second,now);await act(r2.number,'confirm');
   await reject(act(r.number,'reschedule',{date:second.date,time:second.time}),'SLOT_UNAVAILABLE');
   assert.equal((await doc(r.number)).time,'10:00');
   await act(r.number,'reschedule',{date:'2030-01-08',time:'11:00'});assert.equal((await doc(r.number)).date,'2030-01-08');
   await reject(act(r.number,'complete'),'FITTING_CONFLICT');
  });
  await test('Expired fittings release time; late transfers never revive the slot',async()=>{
   const v=input('2030-01-09','09:00'),r=await api.createFitting(v,now),later=new Date(now.getTime()+31*60000);
   assert.equal((await api.readFitting(r.number,v.token,later)).status,'expired');
   assert.equal((await api.reportFittingPayment(r.number,v.token,later)).status,'expired');
   const other=await api.createFitting(input(v.date,v.time),later);assert.equal(other.status,'pending');
   await act(r.number,'late-payment',{},later);assert.equal((await doc(r.number)).slotKey,undefined);
   await act(r.number,'refund',{},later);assert.equal((await doc(r.number)).paymentStatus,'refunded');
  });
  await test('Public cancellation is private, releases time and retains paid ledger status',async()=>{
   const v=input('2030-01-10','09:00'),r=await api.createFitting(v,now);await act(r.number,'confirm');
   const cancelled=await api.cancelPublicFitting(r.number,v.token,now);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.paymentStatus,'paid');
   assert.equal((await doc(r.number)).slotKey,undefined);await act(r.number,'refund');
   assert.equal((await api.readFitting(r.number,v.token,now)).paymentStatus,'refunded');
  });
  await test('Fitting credit is atomic and unique across different rental reservations; replay never doubles credit',async()=>{
   const v=input('2030-01-11','09:00'),r=await api.createFitting(v,now);await act(r.number,'confirm');await act(r.number,'complete',{},new Date('2030-01-12'));
   const fitting=await doc(r.number);
   const makeReservation=async suffix=>{
    const number='AK-2030-'+suffix;
    const id=await insertOwned(Reservation,{reservationNumber:number,status:'confirmed',paymentStatus:'unpaid',advanceRequired:200,paymentRevision:0,paymentEntries:[],subtotal:800,deposit:2000,customerSnapshot:{firstName:'Test',lastName:'Customer',email:v.email,phone:v.phone}});return {number,id};
   };
   const a=await makeReservation('ABC001'),b=await makeReservation('ABC002');
   const results=await Promise.allSettled([act(r.number,'credit',{reservationNumber:a.number}),act(r.number,'credit',{reservationNumber:b.number})]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const credited=await Reservation.findOne({fittingCreditId:String(fitting._id)}).lean();assert.ok(credited);
   assert.equal(paymentSummary(credited).rentalBalance,600);assert.equal(paymentSummary(credited).advanceBalance,0);assert.equal(paymentSummary(credited).depositRequired,2000);
   await act(r.number,'credit',{reservationNumber:credited.reservationNumber});
   assert.equal((await Reservation.findById(credited._id).lean()).paymentEntries.length,1);
   await reject(act(r.number,'refund'),'FITTING_CONFLICT');
   const other=credited.reservationNumber===a.number?b:a;
   await reject(act(r.number,'credit',{reservationNumber:other.number}),'FITTING_ALREADY_CREDITED');
   const result=await api.adminFittings('2030-01-01','2030-01-31');assert.equal(result.items.find(i=>i.number===r.number).credit.reservationNumber,credited.reservationNumber);
   assert.equal(result.items.find(i=>i.number===r.number).tokenHash,undefined);
  });
  await test('Real HTTP fitting flow validates private bearer and admin boundaries',async()=>{
   const express=require('express'),{createV2Router}=require('../build/v2/routes');
   const keys=['V2_RESERVATION_API_ENABLED','V2_ADMIN_API_ENABLED','V2_ADMIN_USER_IDS','SECRET_KEY'];
   const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
   process.env.V2_RESERVATION_API_ENABLED='true';process.env.V2_ADMIN_API_ENABLED='true';process.env.V2_ADMIN_USER_IDS='111111111111111111111111';process.env.SECRET_KEY='isolated-fitting-test-only';
   const app=express();app.use(express.json());app.use('/api/v2',createV2Router(express,{ensureMongoConnection:(_q,_s,next)=>next()}));
   const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
   const base='http://127.0.0.1:'+server.address().port+'/api/v2';
   try{
    const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),v=input(date,'11:00');
    const slots=await fetch(base+'/fittings/slots?date='+date);assert.equal(slots.status,200);assert.ok((await slots.json()).slots.includes('11:00'));
    const created=await fetch(base+'/fittings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});assert.equal(created.status,200);const receipt=await created.json();
    assert.equal((await fetch(base+'/fittings/'+receipt.number)).status,404);
    const auth={Authorization:'Bearer '+v.token};
    assert.equal((await fetch(base+'/fittings/'+receipt.number,{headers:auth})).status,200);
    const report=await fetch(base+'/fittings/'+receipt.number+'/payment-sent',{method:'POST',headers:auth});assert.equal(report.status,200);assert.equal((await report.json()).paymentStatus,'unpaid');
    const cancelled=await fetch(base+'/fittings/'+receipt.number+'/cancel',{method:'POST',headers:auth});assert.equal((await cancelled.json()).status,'cancelled');
    for(const path of ['/admin/fitting-settings','/admin/fittings?from='+date+'&to='+date])assert.equal((await fetch(base+path)).status,401);
    assert.equal((await fetch(base+'/admin/fittings/111111111111111111111111/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"confirm","revision":0}'})).status,401);
   }finally{await new Promise(resolve=>server.close(resolve));for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
  });
  await test('Fittings keep existing bookings after disabling schedule; card payments parse for on-site rentals',async()=>{
   await saveFittingSettings({...settings,enabled:false});
   await reject(api.createFitting(input('2030-01-12','09:00'),now),'SLOT_UNAVAILABLE');
   assert.equal((await api.availableFittingSlots('2030-01-07',now)).enabled,false);
   assert.equal(parsePaymentInput({operationId:randomUUID(),expectedRevision:0,type:'rental_received',amount:100,method:'card'}).method,'card');
  });
 }finally{
  const owned=await FittingModel.find({operationId:{$in:ops}}).select('_id').lean();registry.get(FittingModel).push(...owned.map(d=>d._id));
 }
};
