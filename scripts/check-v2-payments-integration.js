// Owns a fresh loopback-only replica set. Never accepts database URIs or loads .env.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const mongoose = require('mongoose');
const express = require('express');
const { createV2Router } = require('../build/v2/routes');
const models = require('../build/v2/models');
const {
  ProductV2Model: Product,
  VariantV2Model: Variant,
  InventoryItemV2Model: Inventory,
  AvailabilityBlockV2Model: Block,
  ReservationV2Model: Reservation,
} = models;
const {
  parseDateOnly,
  addCalendarDays,
  formatDateOnly,
  getBusinessDateOnly,
} = require('../build/v2/utils/date-only');

assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV=test is required');
assert.equal(
  process.env.PUBLIC_BOOKING_TEST_ALLOW,
  '1',
  'Explicit test opt-in is required'
);
process.env.V2_RESERVATION_API_ENABLED = 'true';
process.env.V2_GUEST_TOKEN_SECRET =
  'isolated-public-booking-fixture-secret-at-least-32-bytes';
mongoose.set('strictQuery', true);
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);
const evidence = [];
let child, server, directory;
const watchdog = setTimeout(() => {
  child?.kill('SIGKILL');
  process.exit(1);
}, 120000);
watchdog.unref();
const pause = () => new Promise(resolve => setTimeout(resolve, 100));

async function startOwnedMongo() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  directory = mkdtempSync(path.join(tmpdir(), 'anirakids-public-booking-'));
  child = spawn(
    process.env.PUBLIC_BOOKING_MONGOD_BINARY || 'mongod',
    [
      '--bind_ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--dbpath',
      directory,
      '--replSet',
      'public-booking-test',
      '--nounixsocket',
      '--setParameter',
      'diagnosticDataCollectionEnabled=false',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('Waiting for connections')) resolve();
    });
    child.stderr.on('data', data => {
      output += data;
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Owned Mongo exited ${code}`)));
  });
  assert.ok(child.pid && child.exitCode === null && !child.killed);
  const database = `anirakids_public_test_${randomBytes(12).toString('hex')}`;
  const uri = `mongodb://127.0.0.1:${port}/${database}?directConnection=true`;
  // Only this locally constructed URI is used, irrespective of inherited environment.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongoose.connection.name, database);
  await mongoose.connection.db.admin().command({
    replSetInitiate: {
      _id: 'public-booking-test',
      members: [{ _id: 0, host: `127.0.0.1:${port}` }],
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await mongoose.connection.db.admin().command({ hello: 1 }))
        .isWritablePrimary
    ) {
      // Reconnect after election so the driver's topology includes session support.
      await mongoose.disconnect();
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
      return;
    }
    await pause();
  }
  throw new Error('Owned replica set did not elect primary');
}

async function main() {
  await startOwnedMongo();
  for (const model of [Product, Variant, Inventory, Block, Reservation]) {
    await model.createCollection(); await model.createIndexes();
  }
  const { parsePaymentInput, recordPayment, paymentSummary, publicPaymentSummary } = require('../build/v2/services/payment.service');
  const { reservationAdminService } = require('../build/v2/services/reservation-admin.service');
  const { BOOKING_POLICY, isValidCzechIban } = require('../build/v2/services/booking-policy');
  assert.ok(isValidCzechIban(BOOKING_POLICY.bank.iban));
  assert.ok(!isValidCzechIban('CZ0008000000006644781399'));
  for (const bad of [null, {}, {operationId:randomUUID(),expectedRevision:0,type:'rental_received',amount:'200',method:'cash'}, {operationId:randomUUID(),expectedRevision:0,type:'rental_refunded',amount:1,method:'cash'}, {operationId:randomUUID(),expectedRevision:0,type:'cancellation_fee',amount:200,method:'cash',note:'legal reason'}]) {
    assert.throws(()=>parsePaymentInput(bad), e=>e.code==='VALIDATION_ERROR');
  }
  const product=await Product.create({name:'Payment fixture',slug:'payment-fixture',rentalEnabled:true,rentalPrices:{studio:700},defaultDeposit:2000});
  const variant=await Variant.create({productId:product._id,size:'M'});
  const inventory=await Inventory.create({variantId:variant._id,internalCode:'PAYMENT-TEST-01',condition:'good'});
  const now=new Date(), startDate=parseDateOnly(formatDateOnly(addCalendarDays(parseDateOnly(getBusinessDateOnly(now)),30)));
  const r=await Reservation.create({reservationNumber:'AK-2030-PAY001',customerSnapshot:{firstName:'Test',lastName:'User',email:'test@example.test',phone:'+420777111222'},items:[{productId:product._id,variantId:variant._id,inventoryItemId:inventory._id,productNameSnapshot:'Payment fixture',sizeSnapshot:'M',rentalPriceSnapshot:700,depositSnapshot:2000}],rentalMode:'studio',startDate,endDate:startDate,status:'pending',expiresAt:new Date(Date.now()+3600000),subtotal:700,deposit:2000,totalDue:2700,advanceRequired:200,paymentRevision:0,paymentEntries:[],paymentStatus:'unpaid'});
  const actor=new mongoose.Types.ObjectId().toHexString();
  let rev=0;
  const input=(type,amount,extra={})=>parsePaymentInput({operationId:randomUUID(),expectedRevision:rev,type,amount,...(!type.startsWith('cancellation_')?{method:'bank_transfer'}:{}),...extra});
  const post=async(type,amount,extra={})=>{const result=await recordPayment(r._id,input(type,amount,extra),actor);rev=result.revision;return result;};
  assert.equal(publicPaymentSummary(r).paymentInstructions.amount,200);
  assert.match(publicPaymentSummary(r).paymentInstructions.qrPayload,/AM:200.00\*CC:CZK/);
  await assert.rejects(reservationAdminService.confirm(r._id),e=>e.code==='PAYMENT_ADVANCE_REQUIRED');
  const first=input('advance_received',200);
  const copies=await Promise.all([recordPayment(r._id,first,actor),recordPayment(r._id,first,actor)]);
  assert.deepEqual(copies.map(s=>s.revision),[1,1]); rev=1;
  await assert.rejects(recordPayment(r._id,{...first,amount:199},actor),e=>e.code==='PAYMENT_IDEMPOTENCY_CONFLICT');
  assert.equal((await Reservation.findById(r._id)).paymentEntries.length,1);
  const confirmed=await reservationAdminService.confirm(r._id);assert.equal(confirmed.status,'confirmed');
  assert.equal(publicPaymentSummary(confirmed).paymentInstructions,null);
  await reservationAdminService.prepare(r._id);
  await assert.rejects(reservationAdminService.rent(r._id),e=>e.code==='PAYMENT_RENTAL_REQUIRED');
  const races=await Promise.allSettled([recordPayment(r._id,input('rental_received',300),actor),recordPayment(r._id,input('rental_received',300),actor)]);
  assert.equal(races.filter(x=>x.status==='fulfilled').length,1);rev=2;
  await assert.rejects(post('rental_received',201),e=>e.code==='PAYMENT_LIMIT_EXCEEDED');
  await post('rental_received',200);
  const paid=await post('deposit_received',2000);assert.equal(paid.rentalBalance,0);assert.equal(paid.depositHeld,2000);
  assert.equal((await Reservation.findById(r._id)).paymentStatus,'paid');
  await assert.rejects(post('cancellation_fee',200,{note:'Reviewed cancellation rights'}),e=>e.code==='PAYMENT_NOT_ALLOWED');
  await reservationAdminService.cancel(r._id,{reason:'Customer cancellation outside free window'});
  const fee=await post('cancellation_fee',200,{note:'Reviewed applicable terms and statutory rights'});assert.equal(fee.refundableRental,500);
  await assert.rejects(post('cancellation_fee',1,{note:'Attempt extra fee'}),e=>e.code==='PAYMENT_LIMIT_EXCEEDED');
  await assert.rejects(post('rental_refunded',501,{note:'Attempt excess refund'}),e=>e.code==='PAYMENT_LIMIT_EXCEEDED');
  await post('rental_refunded',500,{note:'Refund after cancellation'});
  const refunded=await post('deposit_refunded',2000,{note:'Unused security deposit'});assert.equal(refunded.depositHeld,0);assert.equal(refunded.cancellationFee,200);
  await post('cancellation_fee_reversed',200,{note:'Customer statutory withdrawal accepted'});
  await post('rental_refunded',200,{note:'Return remaining advance'});
  assert.equal((await Reservation.findById(r._id)).paymentStatus,'refunded');
  await assert.rejects(post('deposit_refunded',1,{note:'Excess refund attempt'}),e=>e.code==='PAYMENT_LIMIT_EXCEEDED');
  const final=await Reservation.findById(r._id);assert.equal(final.paymentEntries.length,rev);assert.equal(publicPaymentSummary(final).paymentInstructions,null);
  assert.equal(paymentSummary({...final.toObject(),paymentEntries:[],paymentStatus:'paid'}).legacyUnreconciled,true);
  assert.equal(publicPaymentSummary({...final.toObject(),advanceRequired:undefined}),null);
  const expired={...final.toObject(),status:'pending',expiresAt:new Date(Date.now()-1)};assert.equal(publicPaymentSummary(expired).paymentInstructions,null);
  evidence.push('IBAN/SPAYD validation; strict input; mandatory refund/fee reasons; unknown fields/types rejected; advance gate; same-id concurrent replay; changed-body conflict; revision race; overpayment/refund bounds; cancellation fee allocation and reversal; immutable audit; legacy flag; no QR for expired/cancelled/confirmed');
  // Complete rental journeys and late-payment races use only this owned database.
  const makeBooking = async (name, offset, expiresAt = new Date(Date.now() + 86400000)) => {
    const day = addCalendarDays(startDate, offset);
    return Reservation.create({ ...r.toObject(), _id: new mongoose.Types.ObjectId(),
      reservationNumber: name, startDate: day, endDate: day, expiresAt,
      status: 'pending', paymentStatus: 'unpaid', paymentRevision: 0, paymentEntries: [] });
  };
  for (const [index, method] of ['bank_transfer', 'cash'].entries()) {
    const booking = await makeBooking(`AK-2030-FULL0${index}`, 10 + index * 5);
    let revision = 0;
    const record = async (type, amount, note) => {
      const result = await recordPayment(booking._id, parsePaymentInput({ operationId: randomUUID(),
        expectedRevision: revision, type, amount, method, ...(note ? { note } : {}) }), actor);
      revision = result.revision;
      return result;
    };
    await record('advance_received', 200);
    await reservationAdminService.confirm(booking._id);
    await reservationAdminService.prepare(booking._id);
    await assert.rejects(reservationAdminService.rent(booking._id), e => e.code === 'PAYMENT_RENTAL_REQUIRED');
    await record('rental_received', 500);
    await assert.rejects(reservationAdminService.rent(booking._id), e => e.code === 'PAYMENT_RENTAL_REQUIRED');
    await record('deposit_received', 2000);
    assert.equal((await reservationAdminService.rent(booking._id)).status, 'rented');
    assert.equal((await reservationAdminService.returnReservation(booking._id)).status, 'returned');
    const settled = await record('deposit_refunded', 2000, 'Garment checked and deposit returned');
    assert.equal(settled.depositHeld, 0); assert.equal(settled.rentalNet, 700);
    assert.equal((await Reservation.findById(booking._id)).status, 'returned');
    assert.equal((await Reservation.findById(booking._id)).paymentStatus, 'paid');
    evidence.push(`Full ${method} lifecycle: advance, confirmation, balance, deposit, handover, return, deposit refund`);
  }
  const old = await makeBooking('AK-2030-LATE01', 30, new Date(Date.now() - 1));
  const replacement = await makeBooking('AK-2030-LATE02', 30);
  await recordPayment(old._id, parsePaymentInput({operationId:randomUUID(),expectedRevision:0,
    type:'advance_received',amount:200,method:'bank_transfer',note:'Transfer arrived after hold expired'}),actor);
  await assert.rejects(reservationAdminService.confirm(old._id), e => e.code === 'RESERVATION_CONFIRMATION_CONFLICT');
  assert.equal((await Reservation.findById(old._id)).status, 'pending');
  assert.equal((await Reservation.findById(replacement._id)).status, 'pending');
  assert.equal(publicPaymentSummary(await Reservation.findById(old._id)).paymentInstructions, null);
  await reservationAdminService.cancel(old._id, {reason:'Late transfer; selected dates already reserved'});
  const lateRefund = await recordPayment(old._id, parsePaymentInput({operationId:randomUUID(),expectedRevision:1,
    type:'rental_refunded',amount:200,method:'bank_transfer',note:'Refund late advance; dates unavailable'}),actor);
  assert.equal(lateRefund.rentalNet,0); assert.equal(lateRefund.cancellationFee,0);
  evidence.push('Expired paid hold cannot displace a newer hold; cancellation and full late-payment refund preserve inventory');
  const jwt=require('jsonwebtoken'), User=require('../models/user');
  process.env.SECRET_KEY='owned-payment-fixture-key';process.env.V2_ADMIN_API_ENABLED='true';process.env.V2_ADMIN_USER_IDS=actor;
  const token=jwt.sign({id:actor},process.env.SECRET_KEY);
  await User.collection.insertOne({_id:new mongoose.Types.ObjectId(actor),tokens:[{token}]});
  const app=express();app.use(express.json());app.use('/api/v2',createV2Router(express,{ensureMongoConnection:(_req,_res,next)=>next()}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${server.address().port}/api/v2`;
  const route=`${root}/admin/reservations/${r.id}/payments`;
  assert.equal((await fetch(route)).status,401);
  assert.equal((await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const response=await fetch(route,{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);
  const dto=await response.json();assert.equal(dto.payments.reservationId,r.id);assert.equal(dto.payments.revision,rev);
  assert.equal(JSON.stringify(dto).includes('customerSnapshot'),false);
  const invalid=await fetch(route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(invalid.status,400);
  const late=input('advance_received',200,{note:'Late bank transfer after cancellation'});
  const httpPost=await fetch(route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(late)});assert.equal(httpPost.status,200);assert.equal((await httpPost.json()).payments.rentalNet,200);assert.equal((await Reservation.findById(r._id)).status,'cancelled');
  assert.deepEqual(await (await fetch(`${root}/booking-policy`)).json(),BOOKING_POLICY);
  evidence.push('HTTP admin authentication and validation; audit identity; late transfer recorded without reservation revival; public policy exact');
  console.log(JSON.stringify({status:'PASS',database:'owned disposable loopback replica set',tests:evidence},null,2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
    clearTimeout(watchdog);
  });
