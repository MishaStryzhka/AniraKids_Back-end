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

async function main() {
  await startOwnedMongo();
  for (const model of [Product, Variant, Inventory, Block, Reservation]) {
    await model.createCollection();
    await model.createIndexes();
  }
  const fixture = {
    name: 'Public test dress',
    slug: 'public-test-dress',
    description: 'Disposable fixture',
    category: 'dress',
    gender: 'girls',
    color: 'white',
    status: 'active',
    rentalEnabled: true,
    rentalPrices: { studio: 600, external: 800 },
    defaultDeposit: 1000,
    photos: [
      {
        url: 'https://example.test/dress.jpg',
        publicId: 'private-cloudinary-id',
        alt: 'Dress',
      },
    ],
  };
  const product = await Product.create(fixture);
  const draft = await Product.create({
    ...fixture,
    slug: 'draft-secret-product',
    name: 'Draft secret',
    status: 'draft',
  });
  await Product.create({
    ...fixture,
    slug: 'archived-secret-product',
    status: 'archived',
  });
  const sale = await Product.create({
    ...fixture,
    slug: 'sale-only-product',
    rentalEnabled: false,
  });
  const variant = await Variant.create({
    productId: product._id,
    size: '110',
    sku: 'PRIVATE-SKU',
    rentalPriceOverrides: { external: 950 },
    depositOverride: 1200,
  });
  const inactive = await Variant.create({
    productId: product._id,
    size: '120',
    status: 'inactive',
  });
  const foreign = await Variant.create({ productId: sale._id, size: '100' });
  const inventory = await Inventory.create({
    variantId: variant._id,
    internalCode: 'PRIVATE-INVENTORY',
    status: 'active',
    condition: 'good',
    notes: 'private inventory notes',
  });
  await require('../build/v2/models/partner.model').PartnerModel.create({_id:'blaze',name:'Test Blaze',enabled:true,cooperationActive:true});
  const app = express();
  app.use(express.json());
  let connections = 0;
  app.use(
    '/api/v2',
    createV2Router(express, {
      ensureMongoConnection: (_req, _res, next) => {
        connections++;
        next();
      },
    })
  );
  server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}/api/v2`;
  const request = async (route, options) => {
    const response = await fetch(origin + route, options);
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const list = await request('/catalogue/products');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].id, product.id);
  assert.equal(list.body.items[0].gender, 'girls');
  const publicJson = JSON.stringify(list.body);
  for (const forbidden of [
    'publicId',
    'private-cloudinary',
    'rentalPrices',
    'PRIVATE-',
    'Draft secret',
  ])
    assert.ok(!publicJson.includes(forbidden));
  assert.equal(
    (await request('/catalogue/products?category=suit')).body.total,
    0
  );
  assert.equal(
    (await request('/catalogue/products?q=%5B')).body.total,
    0,
    'Search regex metacharacters are literal'
  );
  assert.equal(
    (await request('/catalogue/products?q=test&page=2&limit=1')).body.items
      .length,
    0
  );
  assert.equal(
    (await request(`/catalogue/products/${draft.slug}`)).status,
    404
  );
  assert.equal((await request(`/catalogue/products/${sale.slug}`)).status, 404);
  const detail = await request(`/catalogue/products/${product.slug}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.product.gender, 'girls');
  await Product.updateOne({ _id: product._id }, { gender: 'women' });
  assert.equal((await request(`/catalogue/products/${product.slug}`)).body.product.gender, 'women');
  await Product.updateOne({ _id: product._id }, { gender: 'girls' });
  assert.equal(detail.body.product.variants.length, 1);
  assert.deepEqual(detail.body.product.variants[0].pricing.studio, { rentalPrice: 600, deposit: 0, totalDue: 600 });
  assert.deepEqual(detail.body.product.variants[0].pricing.external, {
    rentalPrice: 950,
    deposit: 1200,
    totalDue: 2150,
  });
  for (const forbidden of ['sku', 'inventoryItemId', 'publicId', 'PRIVATE-'])
    assert.ok(!JSON.stringify(detail.body).includes(forbidden));
  evidence.push(
    'active-only catalogue, escaped search, pagination, private-field projection, variant pricing'
  );
  assert.deepEqual(list.body.facets, { colors: ['White'], sizes: ['110'] });
  assert.equal(list.body.items[0].rentalPriceFrom, 600);
  for (const filters of ['gender=children', 'color=white&size=110', 'rentalMode=external&minPrice=950&maxPrice=950']) {
    const filtered = await request('/catalogue/products?' + filters);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.total, 1);
  }
  for (const filters of ['gender=women', 'size=%24size', 'size=120', 'familyLook=true', 'rentalMode=external&maxPrice=900', 'color=black']) {
    assert.equal((await request('/catalogue/products?' + filters)).body.total, 0);
  }
  await Product.updateOne({ _id: product._id }, { familyLookGroup: 'test-family' });
  assert.equal((await request('/catalogue/products?familyLook=true')).body.total, 1);
  await Product.updateOne({ _id: product._id }, { $unset: { familyLookGroup: 1 } });
  const comparisonProduct = await Product.create({ ...fixture, slug: 'comparisonProduct-filter-test', rentalPrices: { studio: 300, external: 400 } });
  const comparisonProductVariant = await Variant.create({ productId: comparisonProduct._id, size: '140' });
  const override = await Variant.create({ productId: product._id, size: '150', rentalPriceOverrides: { studio: 100 } });
  assert.equal((await request('/catalogue/products?size=110&maxPrice=200')).body.total, 0, 'size and price must match same variant');
  assert.equal((await request('/catalogue/products?sort=priceAsc&limit=1')).body.items[0].id, product.id);
  assert.equal((await request('/catalogue/products?sort=priceDesc&limit=1')).body.items[0].id, comparisonProduct.id);
  const secondPage = await request('/catalogue/products?sort=priceAsc&limit=1&page=2');
  assert.equal(secondPage.body.total, 2);
  assert.equal(secondPage.body.items[0].id, comparisonProduct.id);
  await Variant.deleteMany({ _id: { $in: [comparisonProductVariant._id, override._id] } });
  await Product.deleteOne({ _id: comparisonProduct._id });
  evidence.push('catalogue facets, combined size/price filters, rental mode overrides, family look, sorting before pagination');
  {
  // Existing labels are interpreted at read time, without duplicating inventory.
  const { inferFitSizes, effectiveFitSizes, normalizeFitSizes } = require('../build/v2/utils/variant-sizes');
  const { validateCreateVariantAdminBody, validateUpdateVariantAdminBody } = require('../build/v2/schemas/admin-catalogue.schema');
  const { toAdminVariantDto } = require('../build/v2/http/admin-response');
  const { catalogueAdminService } = require('../build/v2/services/catalogue-admin.service');
  assert.deepEqual(inferFitSizes('XS–M'), ['XS','S','M']);
  assert.deepEqual(inferFitSizes('XS-M-L'), ['XS','S','M','L']);
  assert.deepEqual(inferFitSizes('98-104-116'), ['98','104','116']);
  assert.deepEqual(normalizeFitSizes(['M','XS','XS','S']), ['XS','S','M']);
  for (const fitSizes of [[], [''], ['74','74'], Array(31).fill('74'), null, '74']) {
    assert.ok(validateCreateVariantAdminBody({size:'74-80',fitSizes}).errorMessage);
    assert.ok(validateUpdateVariantAdminBody({fitSizes}).errorMessage);
  }
  const legacyCases = ['74-80-86', '74–80', 'XS–M', 'XS-M-L', 'S-M-L-XL', '98-104-116', 'M/L', 'UNI'];
  for (const label of legacyCases) {
    await Variant.collection.updateOne({_id:variant._id}, {$set:{size:label},$unset:{fitSizes:''}});
    const sizes = inferFitSizes(label);
    const filtered = await request('/catalogue/products');
    assert.deepEqual(filtered.body.facets.sizes, sizes, `legacy facet parity: ${label}`);
    for (const size of sizes) {
      const response = await request('/catalogue/products?size='+encodeURIComponent(size));
      assert.equal(response.body.total,1,`${label} includes ${size}`);
      assert.equal(response.body.items[0].id,product.id);
    }
    assert.equal(await Inventory.countDocuments({variantId:variant._id}),1);
  }
  await Variant.collection.updateOne({_id:variant._id}, {$set:{size:'74-80-86'}});
  assert.equal((await request('/catalogue/products?size=7')).body.total,0,'no substring matches');
  assert.equal((await request('/catalogue/products?size=92')).body.total,0,'no adjacent-size matches');
  assert.equal((await request('/catalogue/products?size=74-80-86')).body.total,1,'old filter links still work');
  const cheap = await Variant.create({productId:product._id,size:'152',fitSizes:['152'],rentalPriceOverrides:{studio:100}});
  assert.equal((await request('/catalogue/products?size=74&maxPrice=200')).body.total,0,'fit and price match the same variant');
  await Variant.deleteOne({_id:cheap._id});
  const updated = await catalogueAdminService.updateVariant(variant._id,{fitSizes:['74','86']});
  assert.deepEqual(toAdminVariantDto(updated).fitSizes,['74','86']);
  assert.equal((await request('/catalogue/products?size=80')).body.total,0,'explicit selection overrides inferred label');
  assert.equal((await request('/catalogue/products?size=74')).body.total,1);
  assert.equal(updated.id,variant.id,'same variant identity');
  assert.equal(await Inventory.countDocuments({variantId:variant._id}),1,'same physical item');
  const relabeled = await catalogueAdminService.updateVariant(variant._id,{size:'74–86'});
  assert.deepEqual(effectiveFitSizes(relabeled),['74','86'],'label-only PATCH preserves explicit selection');
  const created = await catalogueAdminService.createVariant(product._id,{size:'XS-M'});
  assert.deepEqual(toAdminVariantDto(created).fitSizes,['XS','S','M']);
  await Variant.deleteOne({_id:created._id});
  await Variant.collection.updateOne({_id:variant._id}, {$set:{size:'110'},$unset:{fitSizes:''}});
  evidence.push('fit sizes: legacy fallback, inclusive letter ranges, explicit override, atomic facets, exact matching, same-variant price and unchanged inventory');
  }
  {
    const combined = ' Bílá, růžová, ČERVENÁ, bílá, světle růžová, ';
    await Product.updateOne({_id:product._id}, {color:combined});
    const listed = await request('/catalogue/products');
    assert.deepEqual(listed.body.facets.colors, ['Bílá','Červená','Růžová','Světle růžová']);
    for (const color of ['Bílá','bílá',' RŮŽOVÁ ', 'červená','ČERVENÁ','Světle růžová', combined]) {
      const found = await request('/catalogue/products?color='+encodeURIComponent(color));
      assert.equal(found.body.total,1, color);
      assert.equal(found.body.items[0].id,product.id);
      assert.equal(found.body.items[0].color,combined.trim(),'display label is preserved');
    }
    for (const color of ['růž','Modrá','$color']) {
      assert.equal((await request('/catalogue/products?color='+encodeURIComponent(color))).body.total,0);
    }
    await Product.updateOne({_id:product._id},{color:'Světle růžová'});
    assert.equal((await request('/catalogue/products?color='+encodeURIComponent('Růžová'))).body.total,0,'shades are distinct');
    await Product.updateOne({_id:product._id},{color:''});
    assert.deepEqual((await request('/catalogue/products')).body.facets.colors,[]);
    await Product.updateOne({_id:product._id},{color:'white'});
    evidence.push('colors: atomic facets, Czech case folding, deduplication, legacy multi-color matching, shade boundaries and unchanged display');
  }
  const beforeValidation = connections;
  for (const route of [
    '/catalogue/products?page=0',
    '/catalogue/products?limit=25',
    '/catalogue/products?q[$ne]=x',
    '/catalogue/products/bad/availability',
    '/catalogue/products/public-test-dress?admin=true',
  ])
    assert.equal((await request(route)).status, 400);
  assert.equal(
    connections,
    beforeValidation,
    'Invalid input rejected before Mongo dependency'
  );
  const today = parseDateOnly(getBusinessDateOnly());
  const startDate = formatDateOnly(addCalendarDays(today, 30));
  const endDate = formatDateOnly(addCalendarDays(today, 32));
  const selection = {
    variantId: variant.id,
    rentalMode: 'external',
    startDate,
    endDate,
  };
  const quote = async (changes = {}) =>
    request(
      `/catalogue/products/${product.id}/availability?${new URLSearchParams({ ...selection, ...changes })}`
    );
  assert.equal(
    (await quote({ startDate: '2030-02-30' })).body.error.code,
    'INVALID_DATE'
  );
  assert.equal(
    (await quote({ startDate: formatDateOnly(addCalendarDays(today, -1)) }))
      .body.error.code,
    'PAST_START_DATE'
  );
  assert.equal(
    (await quote({ variantId: inactive.id })).body.error.code,
    'VARIANT_NOT_ACTIVE'
  );
  assert.equal(
    (await quote({ variantId: foreign.id })).body.error.code,
    'VARIANT_PRODUCT_MISMATCH'
  );
  const calendar = async (changes = {}) => request(
    `/catalogue/products/${product.id}/availability-calendar?${new URLSearchParams({
      variantId: variant.id, rentalMode: 'external', month: startDate.slice(0, 7), ...changes
    })}`
  );
  const calendarAvailable = async (date, start) => {
    const result = await calendar({ month: date.slice(0, 7), ...(start ? { startDate: start } : {}) });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(result.body.calendar.days[0]).sort(), ['available', 'date']);
    for (const forbidden of ['inventoryItemId', 'customer', 'PRIVATE-', 'reason', 'reservationNumber'])
      assert.ok(!JSON.stringify(result.body).includes(forbidden));
    return result.body.calendar.days.find(day => day.date === date).available;
  };
  const beforeCalendarValidation = connections;
  for (const changes of [{month:'2030-02-30'}, {month:'2030-13'}, {month:'9999-12'}, {startDate:'2030-02-30'}, {startDate:'2000-01-01'}, {month:['2030-01','2030-02']}]) {
    assert.equal((await calendar(changes)).status, 400);
  }
  assert.equal(connections, beforeCalendarValidation);
  assert.equal((await calendar({variantId: foreign.id})).body.error.code, 'VARIANT_PRODUCT_MISMATCH');
  assert.equal((await calendar({variantId: inactive.id})).body.error.code, 'VARIANT_NOT_ACTIVE');
  assert.equal(await calendarAvailable(startDate), true);
  assert.equal(await calendarAvailable(endDate, startDate), true);
  const leap = await calendar({month:'2032-02'});
  assert.equal(leap.body.calendar.days.length, 29);
  assert.equal(leap.body.calendar.days[28].date, '2032-02-29');
  // Separate physical pieces can cover individual days but cannot be swapped mid-rental.
  const secondItem = await Inventory.create({variantId: variant._id, internalCode:'CALENDAR-SECOND', status:'active', condition:'good'});
  const farEnd = formatDateOnly(addCalendarDays(parseDateOnly(startDate), 10));
  const crossingBlocks = await Block.create([
    { inventoryItemId: inventory._id, startDate: parseDateOnly(farEnd), endDate: parseDateOnly(farEnd), reason:'cleaning', createdBy:new mongoose.Types.ObjectId() },
    { inventoryItemId: secondItem._id, startDate: parseDateOnly(startDate), endDate: parseDateOnly(startDate), reason:'cleaning', createdBy:new mongoose.Types.ObjectId() }
  ]);
  assert.equal(await calendarAvailable(startDate), true);
  assert.equal(await calendarAvailable(farEnd), true);
  assert.equal(await calendarAvailable(farEnd, startDate), false);
  assert.equal((await quote({endDate:farEnd})).body.availability.available, false);
  await Block.deleteMany({_id:{$in:crossingBlocks.map(block=>block._id)}});
  await Inventory.deleteOne({_id:secondItem._id});
  evidence.push('calendar month/leap validation, no-store/public projection, same physical piece over full range');
  const studioQuote = await quote({rentalMode:'studio'});
  assert.deepEqual(studioQuote.body.availability.pricing, { rentalPrice:600, deposit:0, totalDue:600 });
  const available = await quote();
  assert.equal(available.body.availability.available, true);
  assert.deepEqual(available.body.availability.pricing, {
    rentalPrice: 950,
    deposit: 1200,
    totalDue: 2150,
  });
  const bufferDate = addCalendarDays(parseDateOnly(endDate), 1);
  const block = await Block.create({
    inventoryItemId: inventory._id,
    startDate: bufferDate,
    endDate: bufferDate,
    reason: 'cleaning',
    createdBy: new mongoose.Types.ObjectId(),
  });
  assert.equal(
    (await quote()).body.availability.available,
    false,
    'Quote includes cleaning buffer in requested occupancy'
  );
  assert.equal(await calendarAvailable(endDate, startDate), false, 'Calendar includes requested cleaning day');
  await Block.deleteOne({ _id: block._id });
  evidence.push(
    'date validation, variant ownership/status, available quote, manual block on cleaning day'
  );
  const body = {
    productId: product.id,
    ...selection,
    customer: {
      firstName: 'Test',
      lastName: 'Customer',
      email: 'public-booking@example.test',
      phone: '+420777123456',
    },
  };
  const key = randomUUID();
  const post = (payload, idempotencyKey = randomUUID()) =>
    request('/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
  const created = await post(body, key);
  assert.equal(created.status, 201);
  assert.equal(created.body.reservation.status, 'pending');
  assert.equal(created.body.reservation.totalDue, 2150);
  assert.ok(created.body.reservation.expiresAt);
  assert.equal((await quote()).body.availability.available, false);
  assert.equal(await calendarAvailable(endDate, startDate), false, 'Pending holds block calendar');
  const activePending = await Reservation.findOne();
  await Reservation.updateOne({_id:activePending._id}, {$set:{expiresAt:new Date(Date.now()-1000)}});
  assert.equal(await calendarAvailable(endDate, startDate), true, 'Expired pending does not block');
  await Reservation.updateOne({_id:activePending._id}, {$set:{expiresAt:activePending.expiresAt}});
  const statusPath = '/reservations/' + created.body.reservation.reservationNumber;
  const statusAuth = { headers: { Authorization: 'Reservation ' + created.body.guestAccessToken } };
  assert.equal((await request(statusPath)).status, 404, 'A number alone grants no access');
  assert.equal((await request(statusPath + '?token=' + created.body.guestAccessToken)).status, 404, 'Query credentials are not accepted');
  assert.equal((await request(statusPath, { headers: { Authorization: 'Reservation ' + 'x'.repeat(43) } })).status, 404);
  assert.equal((await request('/reservations/AK-2000-000000', statusAuth)).status, 404);
  const statusRead = await request(statusPath, statusAuth);
  assert.equal(statusRead.status, 200);
  assert.equal(statusRead.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(statusRead.body, { reservation: created.body.reservation });
  assert.ok(!JSON.stringify(statusRead.body).includes(body.customer.email));
  assert.ok(!JSON.stringify(statusRead.body).includes(created.body.guestAccessToken));
  assert.equal(await Reservation.countDocuments(), 1, 'Read cannot create a reservation');
  const replay = await post(body, key);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, created.body);
  assert.equal(await Reservation.countDocuments(), 1);
  const changed = await post({ ...body, notes: 'Changed payload' }, key);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await post(body)).status, 409, 'Stale quote cannot oversell');
  const occupied = await Reservation.findOne();
  occupied.status = 'confirmed';
  await occupied.save();
  assert.equal(
    (await post(body, key)).body.reservation.status,
    'confirmed',
    'Replay returns actual lifecycle state'
  );
  assert.equal((await request(statusPath, statusAuth)).body.reservation.status, 'confirmed', 'GET returns the current lifecycle state');
  occupied.status = 'cancelled';
  await occupied.save();
  assert.equal((await quote()).body.availability.available, true);
  assert.equal(await calendarAvailable(endDate, startDate), true, 'Cancellation frees calendar');
  const concurrent = await Promise.all([post(body), post(body)]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
  assert.equal(await Reservation.countDocuments({ status: 'pending' }), 1);
  const other = concurrent.find(result => result.status === 201);
  assert.equal((await request('/reservations/' + other.body.reservation.reservationNumber, statusAuth)).status, 404, 'Guest token cannot read another reservation');
  evidence.push('Scoped status access; missing/wrong/cross-booking/query token rejected; no-store headers; no PII/token disclosure; current lifecycle; read-only counts');
  evidence.push(
    'HTTP catalogue → detail → quote → transactional booking; replay and changed-key payload conflict; actual replay status; concurrent oversell prevention'
  );

  // Authenticated creation and capability-based guest recovery use only this owned database.
  const jwt = require('jsonwebtoken'), User = require('../models/user');
  process.env.SECRET_KEY = 'owned-account-booking-fixture-secret';
  const owner = new mongoose.Types.ObjectId(), stranger = new mongoose.Types.ObjectId();
  const ownerToken = jwt.sign({id:owner.toHexString()},process.env.SECRET_KEY);
  const strangerToken = jwt.sign({id:stranger.toHexString()},process.env.SECRET_KEY);
  await User.collection.insertMany([
    {_id:owner,tokens:[{token:ownerToken}]}, {_id:stranger,tokens:[{token:strangerToken}]}
  ]);
  const ownerAuth = {headers:{Authorization:'Bearer '+ownerToken}};
  const strangerAuth = {headers:{Authorization:'Bearer '+strangerToken}};
  assert.equal((await request('/account/reservations',ownerAuth)).body.total,0);
  const claimPath = '/account/reservations/'+created.body.reservation.reservationNumber+'/claim';
  const claim = (token, capability, extra={}) => request(claimPath,{
    method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    body:JSON.stringify({guestAccessToken:capability,...extra})
  });
  assert.equal((await claim(null,created.body.guestAccessToken)).status,401);
  assert.equal((await claim(ownerToken,'x'.repeat(43))).status,404);
  assert.equal((await claim(ownerToken,created.body.guestAccessToken,{customerId:stranger.toHexString()})).status,400);
  const countBeforeClaim = await Reservation.countDocuments();
  const claims = await Promise.all([claim(ownerToken,created.body.guestAccessToken),claim(ownerToken,created.body.guestAccessToken)]);
  const claimAudit=await Reservation.findOne({reservationNumber:created.body.reservation.reservationNumber}).lean();
  assert.equal(claimAudit.partnerAudit.filter(e=>e.action==='account_claimed').length,1);
  assert.equal(claimAudit.partnerAudit.find(e=>e.action==='account_claimed').by,'customer:'+owner);
  assert.deepEqual(claims.map(x=>x.status),[200,200]);
  assert.equal(await Reservation.countDocuments(),countBeforeClaim);
  assert.equal((await request('/account/reservations',ownerAuth)).body.items[0].reservation.reservationNumber,created.body.reservation.reservationNumber);
  assert.equal((await request('/account/reservations',strangerAuth)).body.total,0);
  assert.equal((await claim(strangerToken,created.body.guestAccessToken)).status,404);
  assert.equal((await request(statusPath,ownerAuth)).status,200);
  assert.equal((await request(statusPath,strangerAuth)).status,404);
  assert.equal((await request(statusPath,statusAuth)).status,200);
  assert.equal((await post(body,key)).status,200,'Original guest idempotent recovery remains valid after claim');
  const pendingAfterClaim = await Reservation.findOne({reservationNumber:created.body.reservation.reservationNumber});
  assert.equal(pendingAfterClaim.status,'cancelled','Claim must not change lifecycle/payment/dates');
  assert.equal(pendingAfterClaim.totalDue,2150);
  const later = formatDateOnly(addCalendarDays(today,60));
  const accountBody={...body,startDate:later,endDate:later};
  const accountKey=randomUUID();
  const createAs = token => request('/reservations',{
    method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':accountKey,Authorization:'Bearer '+token},
    body:JSON.stringify(accountBody)
  });
  const ownedCreated=await createAs(ownerToken);
  assert.equal(ownedCreated.status,201);
  assert.equal(ownedCreated.body.guestAccessToken,undefined);
  const ownedRow=await Reservation.findOne({reservationNumber:ownedCreated.body.reservation.reservationNumber});
  assert.equal(ownedRow.customerId.toHexString(),owner.toHexString());
  assert.equal((await createAs(ownerToken)).status,200);
  assert.equal((await createAs(strangerToken)).status,409);
  assert.equal((await createAs('invalid-token')).status,401);
  assert.equal((await request('/account/reservations',ownerAuth)).body.total,2);
  assert.equal((await request('/account/reservations',strangerAuth)).body.total,0);
  evidence.push('Authenticated POST belongs to bearer owner; same-key retry preserved; different account and expired token rejected; guest claim requires bearer plus exact capability; atomic same-owner replay; no takeover, duplicates, lifecycle/payment change or cross-account history leakage');

  // Multi-item orders: one atomic reservation, one advance, summed prices and deposits.
  const basketProduct = await Product.create({...fixture,slug:'basket-dress',name:'Basket dress',rentalPrices:{studio:700,external:900},defaultDeposit:1500});
  const basketVariant = await Variant.create({productId:basketProduct._id,size:'M'});
  const basketInventory = await Inventory.create({variantId:basketVariant._id,internalCode:'BASKET-ONE',status:'active',condition:'good'});
  const basketDate = formatDateOnly(addCalendarDays(today,90));
  const basketBody = {
    items:[{productId:product.id,variantId:variant.id},{productId:basketProduct.id,variantId:basketVariant.id}],
    rentalMode:'external',startDate:basketDate,endDate:basketDate,
    customer:{...body.customer,email:'basket@example.test'},
  };
  const beforeBasket = await Reservation.countDocuments();
  const blockedBasket = await Block.create({inventoryItemId:basketInventory._id,startDate:parseDateOnly(basketDate),endDate:parseDateOnly(basketDate),reason:'cleaning',createdBy:owner});
  assert.equal((await post(basketBody)).status,409);
  assert.equal(await Reservation.countDocuments(),beforeBasket,'Unavailable second item must not reserve first item');
  await Block.deleteOne({_id:blockedBasket._id});
  for (const invalid of [
    {...basketBody,items:[]},
    {...basketBody,items:Array(21).fill(basketBody.items[0])},
    {...basketBody,productId:product.id,variantId:variant.id},
    {...basketBody,items:[{...basketBody.items[0],rentalPrice:1}]},
  ]) assert.equal((await post(invalid)).status,400);
  const basketKey = randomUUID();
  const multiPost = (payload=basketBody,key=basketKey) => request('/reservations',{
    method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,Authorization:'Bearer '+ownerToken},body:JSON.stringify(payload)
  });
  const basket = await multiPost();
  assert.equal(basket.status,201,JSON.stringify(basket.body));
  const br=basket.body.reservation;
  assert.equal(br.items.length,2);
  assert.equal(br.subtotal,1670,'Active cooperation applies existing 20% second-dress discount');
  assert.equal(br.deposit,2700);
  assert.equal(br.totalDue,4370);
  assert.equal(br.payment.advanceRequired,200,'One advance per reservation');
  assert.deepEqual(br.items.map(x=>x.productId),basketBody.items.map(x=>x.productId));
  const basketRow=await Reservation.findOne({reservationNumber:br.reservationNumber});
  assert.equal(basketRow.items.length,2);
  assert.equal(new Set(basketRow.items.map(x=>x.inventoryItemId.toHexString())).size,2);
  assert.equal(await Reservation.countDocuments(),beforeBasket+1);
  assert.deepEqual((await multiPost()).body,basket.body,'Exact multi-item retry must not create duplicates');
  assert.equal((await multiPost({...basketBody,items:[...basketBody.items].reverse()})).status,409,'Idempotency covers every item');
  const multiHistory=(await request('/account/reservations',ownerAuth)).body.items.find(x=>x.reservation.reservationNumber===br.reservationNumber);
  assert.equal(multiHistory.reservation.items.length,2);
  assert.equal((await request('/reservations/'+br.reservationNumber,ownerAuth)).body.reservation.items.length,2);
  assert.equal((await request('/reservations/'+br.reservationNumber,strangerAuth)).status,404);
  // Delivery is a reservation snapshot; no carrier booking or price is inferred.
  const point={id:'B10103',name:'Praha 10',address:'Černokostelecká 2020/20, Praha',zip:'10030'};
  const deliveryDate=formatDateOnly(addCalendarDays(today,400));
  const deliveryBody={...body,startDate:deliveryDate,endDate:deliveryDate,deliveryTariff:'2026-10',fulfillmentMethod:'balikovna',balikovnaPoint:point};
  const deliveryKey=randomUUID();
  const shipped=await post(deliveryBody,deliveryKey);
  assert.equal(shipped.status,201,JSON.stringify(shipped.body));
  assert.deepEqual(shipped.body.reservation.balikovnaPoint,point);
  assert.equal(shipped.body.reservation.totalDue,2239);
  assert.equal(shipped.body.reservation.shippingPrice,89);
  const shippedRow=await Reservation.findOne({reservationNumber:shipped.body.reservation.reservationNumber}).lean();
  assert.deepEqual(shippedRow.balikovnaPoint,point);
  assert.deepEqual((await post(deliveryBody,deliveryKey)).body,shipped.body);
  assert.equal((await post({...deliveryBody,balikovnaPoint:{...point,id:'456'}},deliveryKey)).status,409);
  assert.equal((await post({...deliveryBody,rentalMode:'studio'})).status,400);
  assert.equal((await post({...deliveryBody,balikovnaPoint:undefined})).status,400);
  const guestDelivery=await request('/reservations/'+shipped.body.reservation.reservationNumber,{headers:{Authorization:'Reservation '+shipped.body.guestAccessToken}});
  assert.deepEqual(guestDelivery.body.reservation.balikovnaPoint,point);
  const adminDetail=await require('../build/v2/services/reservation-admin.service').reservationAdminService.getReservationDetail(shippedRow._id);
  assert.deepEqual(require('../build/v2/http/admin-response').toAdminReservationDetailDto(adminDetail).balikovnaPoint,point);
  const shippedBasket=await multiPost({...basketBody,startDate:deliveryDate,endDate:deliveryDate,deliveryTariff:'2026-10',fulfillmentMethod:'balikovna',balikovnaPoint:point},randomUUID());
  assert.equal(shippedBasket.status,409,'Shipping cannot bypass occupied inventory');
  const basketDeliveryDate=formatDateOnly(addCalendarDays(today,410));
  const basketDelivery=await multiPost({...basketBody,startDate:basketDeliveryDate,endDate:basketDeliveryDate,deliveryTariff:'2026-10',fulfillmentMethod:'balikovna',balikovnaPoint:point},randomUUID());
  assert.equal(basketDelivery.status,201,JSON.stringify(basketDelivery.body));
  const deliveryHistory=(await request('/account/reservations',ownerAuth)).body.items.find(x=>x.reservation.reservationNumber===basketDelivery.body.reservation.reservationNumber);
  assert.deepEqual(deliveryHistory.reservation.balikovnaPoint,point);
  const address={street:'Testovací 12',city:'Praha',zip:'19000',country:'CZ'};
  const homeBody={...body,customer:{...body.customer,email:'shipping-home@example.test'},startDate:formatDateOnly(addCalendarDays(today,420)),endDate:formatDateOnly(addCalendarDays(today,420)),deliveryTariff:'2026-10',fulfillmentMethod:'balikovna_address',deliveryAddress:address};
  const homeKey=randomUUID(),home=await post(homeBody,homeKey);
  assert.equal(home.status,201,JSON.stringify(home.body));assert.equal(home.body.reservation.shippingPrice,119);assert.equal(home.body.reservation.totalDue,2269);
  assert.deepEqual(home.body.reservation.deliveryAddress,address);
  assert.equal((await post({...homeBody,deliveryAddress:{...address,city:'Brno'}},homeKey)).status,409);
  assert.equal((await post({...homeBody,shippingPrice:0})).status,400);
  assert.equal((await post({...homeBody,deliveryAddress:{...address,zip:'bad'}})).status,400);
  const row=await Reservation.findOne({reservationNumber:home.body.reservation.reservationNumber}).lean();
  const payments=require('../build/v2/services/payment.service').publicPaymentSummary(row);
  assert.equal(payments.fullPaymentInstructions.amount,2269);
  await Reservation.updateOne({_id:row._id},{$set:{status:'returned'}});
  const invoice=await require('../build/v2/services/invoice.service').invoicePreview({type:'reservation',number:row.reservationNumber,buyerName:'Test',buyerAddress:'Test'});
  assert.equal(invoice.snapshot.lines.find(x=>x.description==='Doprava – Balíkovna na adresu').amount,119);
  assert.equal(invoice.snapshot.total,row.subtotal);
  assert.equal(invoice.snapshot.lines.reduce((n,x)=>n+x.amount,0),row.subtotal);
  await Reservation.deleteMany({reservationNumber:{$in:[shipped.body.reservation.reservationNumber,basketDelivery.body.reservation.reservationNumber,home.body.reservation.reservationNumber]}});
  evidence.push('Balikovna single/basket storage, guest/account/admin readback, retry safety, validation, shipping totals and inventory protection');
  // Two baskets racing for the same pieces can create only one complete order.
  await Reservation.updateOne({_id:basketRow._id},{$set:{status:'cancelled'}});
  const race=await Promise.all([multiPost(basketBody,randomUUID()),multiPost(basketBody,randomUUID())]);
  assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
  assert.equal(await Reservation.countDocuments(),beforeBasket+2);
  assert.equal(await Reservation.countDocuments({status:'pending','items.inventoryItemId':basketInventory._id}),1);
  const winner=race.find(x=>x.status===201).body.reservation;
  assert.equal(winner.items.length,2);
  // Quantity must allocate distinct physical pieces, never count one piece twice.
  const quantityDate=formatDateOnly(addCalendarDays(today,100));
  assert.equal((await post({...basketBody,startDate:quantityDate,endDate:quantityDate,items:[basketBody.items[1],basketBody.items[1]]})).status,409);
  const extraPiece=await Inventory.create({variantId:basketVariant._id,internalCode:'BASKET-TWO',status:'active',condition:'good'});
  const quantity=await post({...basketBody,startDate:quantityDate,endDate:quantityDate,items:[basketBody.items[1],basketBody.items[1]]});
  assert.equal(quantity.status,201);
  const quantityRow=await Reservation.findOne({reservationNumber:quantity.body.reservation.reservationNumber});
  assert.equal(new Set(quantityRow.items.map(x=>x.inventoryItemId.toHexString())).size,2);
  evidence.push('Multi-item atomic basket, no partial booking, one 200 CZK advance, summed rental and deposit, all-item receipt/history, complete idempotent replay, changed item conflict, cross-account denial, concurrent all-or-none allocation and distinct pieces for quantity');
  // Mode-specific occupancy: test both orderings, quote, calendar and actual writes.
  const studioCustomer = {...body.customer,email:'studio-buffer@example.test'};
  const studioDay = addCalendarDays(today, 120);
  const studioDate = formatDateOnly(studioDay);
  for (const heldMode of ['studio', 'external']) {
    const held = await post({...body, customer:studioCustomer, rentalMode:heldMode, startDate:studioDate, endDate:studioDate});
    assert.equal(held.status, 201);
    for (const requestedMode of ['studio', 'external']) {
      for (const offset of [-1, 0, 1]) {
        const date = formatDateOnly(addCalendarDays(studioDay, offset));
        const expected = offset === -1 ? requestedMode === 'studio'
          : offset === 1 ? heldMode === 'studio' : false;
        const label = `${heldMode} held; ${requestedMode} requested; offset ${offset}`;
        assert.equal((await quote({rentalMode:requestedMode, startDate:date, endDate:date})).body.availability.available, expected, label + ' quote');
        const month = await calendar({rentalMode:requestedMode, month:date.slice(0,7)});
        assert.equal(month.body.calendar.days.find(day=>day.date===date).available, expected, label + ' calendar');
        const range = await calendar({rentalMode:requestedMode, month:date.slice(0,7), startDate:date});
        assert.equal(range.body.calendar.days.find(day=>day.date===date).available, expected, label + ' return calendar');
        const result = await post({...body, customer:studioCustomer, rentalMode:requestedMode, startDate:date, endDate:date});
        assert.equal(result.status, expected ? 201 : 409, label + ' create');
        if (result.status === 201) await Reservation.deleteOne({reservationNumber:result.body.reservation.reservationNumber});
      }
    }
    await Reservation.deleteOne({reservationNumber:held.body.reservation.reservationNumber});
  }
  evidence.push('Studio/external mode matrix: adjacent dates in both directions, same-day conflict, quote/calendar/create agreement');

  const studioBody = {...body, customer:studioCustomer, rentalMode:'studio', startDate:studioDate, endDate:studioDate};
  const nextDate = formatDateOnly(addCalendarDays(studioDay, 1));
  const manual = await Block.create({inventoryItemId:inventory._id, startDate:parseDateOnly(nextDate), endDate:parseDateOnly(nextDate), reason:'cleaning', createdBy:owner});
  assert.equal((await quote({rentalMode:'studio',startDate:studioDate,endDate:studioDate})).body.availability.available,true);
  assert.equal((await quote({rentalMode:'external',startDate:studioDate,endDate:studioDate})).body.availability.available,false);
  assert.equal((await post({...studioBody,rentalMode:'external'})).status,409,'External create respects its buffer against a manual block');
  assert.equal((await post({...studioBody,startDate:nextDate,endDate:nextDate})).status,409,'Studio still respects actual manual block days');
  const studioRace = await Promise.all([post(studioBody),post(studioBody)]);
  assert.deepEqual(studioRace.map(result=>result.status).sort(),[201,409],'Concurrent studio requests cannot double-book');
  const studioWinner = studioRace.find(result=>result.status===201).body.reservation;
  const studioRow = await Reservation.findOne({reservationNumber:studioWinner.reservationNumber});
  assert.equal(studioWinner.deposit,0);
  assert.equal(studioWinner.totalDue,studioWinner.subtotal);
  assert.equal(studioRow.items[0].depositSnapshot,0);
  assert.equal(studioRow.deposit,0);
  const {reservationAdminService} = require('../build/v2/services/reservation-admin.service');
  const {toAdminReservationCalendarEventDto} = require('../build/v2/http/admin-response');
  await Reservation.updateOne({_id:studioRow._id},{$set:{advanceRequired:0}});
  const confirmedStudio = await reservationAdminService.confirm(studioRow._id);
  assert.equal(confirmedStudio.status,'confirmed','Studio confirmation ignores the following manual block');
  assert.equal(toAdminReservationCalendarEventDto(confirmedStudio).occupiedThrough,studioDate);
  const nextCalendar = await reservationAdminService.getCalendar({from:nextDate,to:nextDate});
  assert.ok(!nextCalendar.items.some(item=>item._id.equals(studioRow._id)),'Admin calendar has no phantom studio cleaning day');
  await Block.deleteOne({_id:manual._id});
  const adjacent = await post({...studioBody,startDate:nextDate,endDate:nextDate});
  assert.equal(adjacent.status,201,'Next-day studio booking after confirmation');
  const adjacentRow = await Reservation.findOne({reservationNumber:adjacent.body.reservation.reservationNumber});
  await Reservation.updateOne({_id:adjacentRow._id},{$set:{advanceRequired:0,expiresAt:new Date(Date.now()-1000)}});
  assert.equal((await reservationAdminService.confirm(adjacentRow._id)).status,'confirmed','Expired studio confirmation rechecks adjacent occupancy correctly');
  await Reservation.deleteOne({_id:adjacentRow._id});
  const {inventoryAvailabilityAdminService} = require('../build/v2/services/inventory-availability-admin.service');
  const lifecycleNow = new Date(nextDate+'T12:00:00Z');
  await Reservation.updateOne({_id:studioRow._id},{$set:{rentalMode:'external'}});
  await assert.rejects(()=>inventoryAvailabilityAdminService.moveToMaintenance(inventory._id,{now:lifecycleNow}),{code:'INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION'});
  await Reservation.updateOne({_id:studioRow._id},{$set:{rentalMode:'studio'}});
  assert.equal((await inventoryAvailabilityAdminService.moveToMaintenance(inventory._id,{now:lifecycleNow})).status,'maintenance','Completed studio day imposes no lifecycle cleaning buffer');
  await inventoryAvailabilityAdminService.activate(inventory._id,{now:lifecycleNow});
  await Reservation.deleteOne({_id:studioRow._id});
  const studioBasketDate = formatDateOnly(addCalendarDays(today,130));
  const studioBasket = {...basketBody,customer:studioCustomer,rentalMode:'studio',startDate:studioBasketDate,endDate:studioBasketDate};
  const studioBasketResult = await post(studioBasket);
  assert.equal(studioBasketResult.status,201);
  assert.equal(studioBasketResult.body.reservation.deposit,0);
  assert.equal(studioBasketResult.body.reservation.totalDue,studioBasketResult.body.reservation.subtotal);
  assert.ok(studioBasketResult.body.reservation.items.every(item=>item.deposit===0));
  evidence.push('Studio catalogue, availability, single and basket reservations omit deposit; external deposit and totals preserved');
  const nextBasketDate = formatDateOnly(addCalendarDays(today,131));
  assert.equal((await post({...studioBasket,startDate:nextBasketDate,endDate:nextBasketDate})).status,201,'Consecutive studio baskets use the same pieces without an extra blocked day');
  evidence.push('Studio manual-block safety, concurrent oversell prevention, confirmation/reconfirmation, admin occupancy/calendar, lifecycle and consecutive multi-item baskets');

  // Remove only this added product from catalogue assertions below.
  await Product.updateOne({_id:basketProduct._id},{$set:{status:'draft'}});

  await Inventory.updateOne(
    { _id: inventory._id },
    { $set: { status: 'maintenance' } }
  );
  assert.equal((await quote()).body.availability.available, false);
  assert.equal(await calendarAvailable(startDate), false, 'Maintenance inventory unavailable');
  await Product.updateOne({ _id: product._id }, { $set: { status: 'draft' } });
  assert.equal((await calendar()).status, 404);
  assert.equal((await quote()).status, 404);
  assert.equal((await request('/catalogue/products')).body.total, 0);
  evidence.push('inactive inventory and product unpublished after selection');
  await require('./check-partner-integration')({request,models});
  await require('./check-partner-reward-policy')();
  await require('./check-partner-invoices')({request,models});
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        database: 'owned disposable loopback replica set',
        tests: evidence,
      },
      null,
      2
    )
  );
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
