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
  assert.equal(detail.body.product.variants.length, 1);
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
  assert.deepEqual(list.body.facets, { colors: ['white'], sizes: ['110'] });
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
  const concurrent = await Promise.all([post(body), post(body)]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
  assert.equal(await Reservation.countDocuments({ status: 'pending' }), 1);
  const other = concurrent.find(result => result.status === 201);
  assert.equal((await request('/reservations/' + other.body.reservation.reservationNumber, statusAuth)).status, 404, 'Guest token cannot read another reservation');
  evidence.push('Scoped status access; missing/wrong/cross-booking/query token rejected; no-store headers; no PII/token disclosure; current lifecycle; read-only counts');
  evidence.push(
    'HTTP catalogue → detail → quote → transactional booking; replay and changed-key payload conflict; actual replay status; concurrent oversell prevention'
  );
  await Inventory.updateOne(
    { _id: inventory._id },
    { $set: { status: 'maintenance' } }
  );
  assert.equal((await quote()).body.availability.available, false);
  await Product.updateOne({ _id: product._id }, { $set: { status: 'draft' } });
  assert.equal((await quote()).status, 404);
  assert.equal((await request('/catalogue/products')).body.total, 0);
  evidence.push('inactive inventory and product unpublished after selection');
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
