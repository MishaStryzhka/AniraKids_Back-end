require('./fitting-email-fixture');
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
// Install before loading routes: integration fixtures must never deliver real email.
require('./fitting-email-fixture');
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

async function main(){
 await startOwnedMongo();
 for(const model of [Product,Variant,Inventory,Block,Reservation]){await model.createCollection();await model.createIndexes();}
 const {reservationService}=require('../build/v2/services/reservation.service');
 const {publicCatalogueService}=require('../build/v2/services/public-catalogue.service');
 const {reservationAdminService}=require('../build/v2/services/reservation-admin.service');
 const {occupiedRentalRange,shiftWorkingDays}=require('../build/v2/utils/rental-policy');
 const {resolvePeriodPricing,rentalDays}=require('../build/v2/utils/pricing');
 const {catalogueAdminService}=require('../build/v2/services/catalogue-admin.service');
 const now=new Date('2030-01-02T12:00:00Z');
 const product=await Product.create({name:'Tariff test',slug:'tariff-test',description:'Test dress',category:'dress',gender:'girls',color:'white',photos:[{url:'https://example.test/dress.jpg',publicId:'test'}],status:'active',rentalEnabled:true,rentalPrices:{studio:500,external:800},defaultDeposit:2000});
 const variant=await Variant.create({productId:product._id,size:'110'});
 const inventory=await Inventory.create({variantId:variant._id,internalCode:'TARIFF-1',status:'active',condition:'good'});
 const customer={firstName:'Test',lastName:'Rental',email:'rental@example.test',phone:'+420777123456'};
 const base={productId:product._id,variantId:variant._id,rentalMode:'external',rentalPolicyVersion:'2026-11',startDate:'2030-02-11',endDate:'2030-02-11',customer};
 const create=(changes={})=>reservationService.createReservation({...base,...changes},{now});
 const quote=(changes={})=>publicCatalogueService.availability(String(product._id),{variantId:String(variant._id),rentalMode:base.rentalMode,startDate:base.startDate,endDate:base.endDate,...changes},now);
 for(const [days,expected] of [[1,800],[2,1000],[7,2000]])assert.equal(resolvePeriodPricing(product,variant,'external',days).rentalPrice,expected);
 assert.equal(resolvePeriodPricing(product,variant,'studio').deposit,2000);
 assert.throws(()=>rentalDays('external',parseDateOnly('2030-02-11'),parseDateOnly('2030-02-18')));
 assert.throws(()=>rentalDays('studio',parseDateOnly('2030-02-11'),parseDateOnly('2030-02-12')));
 assert.equal(formatDateOnly(shiftWorkingDays(parseDateOnly('2026-12-28'),-2)),'2026-12-22','Christmas and weekends excluded');
 assert.equal(formatDateOnly(shiftWorkingDays(parseDateOnly('2026-04-07'),-2)),'2026-04-01','Good Friday and Easter Monday excluded');
 assert.equal((await quote({endDate:'2030-02-13'})).availability.pricing.rentalPrice,1200);
 await assert.rejects(create({endDate:'2030-02-18'}),{code:'INVALID_DATE'});
 await assert.rejects(create({rentalMode:'studio',endDate:'2030-02-12'}),{code:'INVALID_DATE'});
 await assert.rejects(create({rentalPolicyVersion:undefined}),{code:'RENTAL_POLICY_CHANGED'});
 const detail=await publicCatalogueService.detail(product.slug);
 assert.equal(detail.product.variants[0].pricing.studio.deposit,2000,'Photoshoot enabled without cooperation');
 const point={id:'10001',name:'Test point',address:'Test street 1, Praha',zip:'10000'};
 for(const method of ['balikovna','balikovna_address']){
  const delivery=method==='balikovna'?{fulfillmentMethod:method,balikovnaPoint:point}:{fulfillmentMethod:method,deliveryTariff:'2026-10',deliveryAddress:{street:'Test 1',city:'Praha',zip:'10000',country:'CZ'}};
  const result=await create({...delivery,endDate:'2030-02-13'}),r=result.reservation;
  const fee=method==='balikovna'?178:238;
  assert.equal(r.shippingPrice,fee);assert.equal(r.subtotal,1200+fee);assert.equal(r.totalDue,3200+fee);
  const stored=await Reservation.findById(r._id);
  assert.equal(formatDateOnly(stored.occupiedStartDate),'2030-02-07');
  assert.equal(formatDateOnly(stored.occupiedEndDate),'2030-02-16');
  for(const date of ['2030-02-07','2030-02-08','2030-02-15','2030-02-16']){
   assert.equal((await quote({startDate:date,endDate:date,rentalMode:'studio'})).availability.available,false,'Transit blocked '+date);
   await assert.rejects(create({startDate:date,endDate:date,rentalMode:'studio'}),{code:'NO_AVAILABLE_INVENTORY'});
  }
  const calendar=await publicCatalogueService.calendar(String(product._id),{variantId:String(variant._id),rentalMode:'studio',month:'2030-02'},now);
  assert.equal(calendar.calendar.days.find(d=>d.date==='2030-02-07').available,false);
  await Reservation.updateOne({_id:r._id},{$set:{expiresAt:new Date(now.getTime()-1000),advanceRequired:0}});
  const blocker=await Block.create({inventoryItemId:inventory._id,startDate:parseDateOnly('2030-02-07'),endDate:parseDateOnly('2030-02-07'),reason:'cleaning',createdBy:new mongoose.Types.ObjectId()});
  await assert.rejects(reservationAdminService.confirm(r._id,{now}),{code:'RESERVATION_CONFIRMATION_CONFLICT'});
  await Block.deleteOne({_id:blocker._id});
  await Reservation.deleteOne({_id:r._id});
 }
 // Concurrent requests may not assign the same physical garment.
 const race=await Promise.allSettled([create(),create()]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 const winner=race.find(r=>r.status==='fulfilled').value.reservation;
 await catalogueAdminService.updateProduct(product._id,{additionalDayPrice:350});
 assert.equal((await Product.findById(product._id)).additionalDayPrice,350,'Admin rate update saved');
 assert.equal((await Reservation.findById(winner._id)).subtotal,800,'Existing price snapshot retained');
 assert.equal((await quote({endDate:'2030-02-12'})).availability.pricing.rentalPrice,1150,'Updated per-product extra day');
 await Reservation.deleteMany({});
 const photo=await create({rentalMode:'studio'});assert.equal(photo.reservation.deposit,2000);assert.equal(photo.reservation.totalDue,2500);
 await Reservation.deleteMany({});
 // Legacy records without occupied snapshots still block through their original cleaning day.
 await Reservation.collection.insertOne({reservationNumber:'AK-2030-LEGACY',rentalMode:'external',status:'confirmed',startDate:parseDateOnly('2030-02-11'),endDate:parseDateOnly('2030-02-11'),items:[{inventoryItemId:inventory._id}],subtotal:800,deposit:2000,totalDue:2800});
 assert.equal((await quote({rentalMode:'studio',startDate:'2030-02-12',endDate:'2030-02-12'})).availability.available,false);
 const {toAdminReservationCalendarEventDto}=require('../build/v2/http/admin-response');
 console.log('PASS: daily tariffs, 7-day limit, normal photoshoot deposit, two-way fees, 2 working day transit, holidays, quote/calendar/create consistency, confirmation conflict, concurrent booking and legacy snapshots');
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
