// Real Mongo, explicit barriers, no application bootstrap/.env/provider access.
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomBytes } = require('node:crypto');
const { spawn, fork, execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const mongoose = require('mongoose');
const { ProductV2Model: Product, VariantV2Model: Variant, InventoryItemV2Model: Inventory } = require('../build/v2/models');
const { CatalogueAdminService } = require('../build/v2/services/catalogue-admin.service');
const { ProductMediaService } = require('../build/v2/services/product-media.service');
const { mapAdminApiError } = require('../build/v2/http/admin-error-mapper');
const { validateUpdateProductAdminBody } = require('../build/v2/schemas/admin-catalogue.schema');

const conflictMessage = 'Product changed during the operation. Refresh and try again.';
const context = new AsyncLocalStorage();
const service = new CatalogueAdminService();
const media = new ProductMediaService({ destroyImage: async () => {} });
const ownedInstances = new WeakSet();
const registry = new Map([[Product, []], [Variant, []], [Inventory, []]]);
const counters = { connections: 0, writes: 0 };
const evidence = { status: 'RUNNING', tests: [], guard: [], cleanup: {}, mongoVersion: '7.0.14' };
let activeOwned;
let hooks = {};
let operationStats = {};
const stats = actor => operationStats[actor] ||= { reads: 0, cas: 0, freshness: 0, commits: 0 };
const actor = () => context.getStore() || 'fixture';
const runAs = (name, fn) => context.run(name, fn);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const barrier = () => {
  const entered = deferred(); const release = deferred();
  return { entered: entered.promise, release: release.resolve,
    stop: async () => { entered.resolve(); await release.promise; } };
};
// Only a watchdog; never used to order concurrent operations.
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: deterministic suite stalled'); process.exitCode = 1;
  if (activeOwned?.child.exitCode === null) activeOwned.child.kill('SIGKILL');
  process.exit(1);
}, 180000);
watchdog.unref();

function guard(target, env, owned) {
  assert.equal(env.NODE_ENV, 'test', 'NODE_ENV=test required');
  assert.equal(env.PRODUCT_CONCURRENCY_TEST_ALLOW, '1', 'explicit opt-in required');
  assert.match(target.runId, /^[a-f0-9]{32}$/, 'invalid runId');
  assert.ok(ownedInstances.has(owned) && owned.child && owned.child.exitCode === null &&
    !owned.child.killed && owned.child.pid > 0, 'harness ownership required');
  assert.equal(target.runId, owned.runId, 'runId must be harness-owned');
  assert.equal(target.port, owned.port, 'port must be harness-owned');
  assert.equal(target.database, `anirakids_cas_test_${owned.runId}`);
  assert.ok(Buffer.byteLength(target.database, 'utf8') < 64, 'test database name must be <64 bytes');
  assert.equal(target.uri, `mongodb://127.0.0.1:${owned.port}/${target.database}?directConnection=true`);
  assert.equal(target.uri, owned.uri, 'exact owned URI required');
}
async function connectOwned(target, env, owned, connect = async () => {}) {
  guard(target, env, owned);
  counters.connections += 1;
  return connect(target.uri);
}
async function checkGuards(owned) {
  const goodEnv = { NODE_ENV: 'test', PRODUCT_CONCURRENCY_TEST_ALLOW: '1' };
  const target = { ...owned };
  const cases = [
    ['missing opt-in', target, { NODE_ENV: 'test' }],
    ['wrong NODE_ENV', target, { ...goodEnv, NODE_ENV: 'production' }],
    ['malformed runId', { ...target, runId: 'A'.repeat(32) }, goodEnv],
    ['foreign runId', { ...target, runId: 'a'.repeat(32) }, goodEnv],
    ['foreign host', { ...target, uri: target.uri.replace('127.0.0.1', 'example.com') }, goodEnv],
    ['foreign port', { ...target, port: 1 }, goodEnv],
    ['wrong database', { ...target, database: 'AniraKids' }, goodEnv],
    ['old overlong prefix', { ...target, database: `anirakids_product_concurrency_test_${target.runId}`, uri: target.uri.replace('anirakids_cas_test_', 'anirakids_product_concurrency_test_') }, goodEnv],
    ['intermediate product prefix', { ...target, database: `anirakids_product_cas_test_${target.runId}`, uri: target.uri.replace('anirakids_cas_test_', 'anirakids_product_cas_test_') }, goodEnv],
    ['SRV URI', { ...target, uri: target.uri.replace('mongodb:', 'mongodb+srv:') }, goodEnv],
    ['multiple hosts', { ...target, uri: target.uri.replace('127.0.0.1:', 'localhost,127.0.0.1:') }, goodEnv],
    ['URI credentials', { ...target, uri: target.uri.replace('mongodb://', 'mongodb://user:pass@') }, goodEnv],
    ['URI database override', { ...target, uri: `${target.uri}&dbName=AniraKids` }, goodEnv],
    ['no owned instance', target, goodEnv, {}],
  ];
  for (const [name, bad, env, owner = owned] of cases) {
    const before = { ...counters };
    await assert.rejects(connectOwned(bad, env, owner, async () => {
      counters.writes += 1; throw new Error('must never reach connection');
    }));
    assert.deepEqual(counters, before, 'guard must reject before connection/write');
    evidence.guard.push({ name, connectionAttempts: 0, writes: 0 });
    console.log(`TEST_DB_GUARD=PASS: ${name}; connections=0 writes=0`);
  }
}
async function startMongo() {
  // Never accept an external/application/test URI. Only a binary executable may
  // be supplied; this harness owns its new process, dbpath and allocated port.
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.PRODUCT_CONCURRENCY_TEST_ALLOW, '1');
  const runId = randomBytes(16).toString('hex');
  const database = `anirakids_cas_test_${runId}`;
  const directory = mkdtempSync(path.join(tmpdir(), 'anirakids-product-concurrency-'));
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const selected = server.address().port;
      server.close(error => error ? reject(error) : resolve(selected));
    });
  });
  const child = spawn(process.env.PRODUCT_CONCURRENCY_MONGOD_BINARY || 'mongod', [
    '--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory,
    '--nounixsocket', '--setParameter', 'diagnosticDataCollectionEnabled=false',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const owned = { child, runId, database, port, directory,
    uri: `mongodb://127.0.0.1:${port}/${database}?directConnection=true` };
  ownedInstances.add(owned);
  activeOwned = owned;
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => {
      output += data.toString();
      if (output.includes('Waiting for connections')) resolve();
    });
    child.stderr.on('data', data => { output += data.toString(); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Owned mongod exited ${code}: ${output.slice(-2000)}`)));
  });
  return owned;
}
function installHooks() {
  const exec = mongoose.Query.prototype.exec;
  mongoose.Query.prototype.exec = async function (...args) {
    const who = actor();
    if (this.model === Product && this.op === 'findOneAndUpdate') {
      await hooks.beforeMediaCas?.(who);
    }
    const result = await exec.apply(this, args);
    if (this.model === Product && this.op === 'findOne' && this._mongooseOptions.lean) {
      stats(who).reads += 1;
      await hooks.afterRead?.(who, result);
    }
    return result;
  };
  const cas = Product.collection.findOneAndUpdate;
  Product.collection.findOneAndUpdate = async function (...args) {
    // Mongoose media queries use callbacks; keep their existing behavior.
    if (typeof args.at(-1) === 'function') return cas.apply(this, args);
    const who = actor(); stats(who).cas += 1;
    await hooks.beforeCas?.(who, args[0], args[1]);
    const result = await cas.apply(this, args);
    if (result.value) stats(who).commits += 1;
    await hooks.afterCas?.(who, result);
    return result;
  };
  const findOne = Product.collection.findOne;
  Product.collection.findOne = function (...args) {
    if (typeof args.at(-1) === 'function' || args[1]?.readPreference !== 'primary') {
      return findOne.apply(this, args);
    }
    const who = actor(); stats(who).freshness += 1;
    return (async () => {
      await hooks.beforeFreshness?.(who, args[0]);
      return findOne.apply(this, args);
    })();
  };
}
async function insertOwned(model, document) {
  const _id = document._id || new mongoose.Types.ObjectId();
  registry.get(model).push(_id); counters.writes += 1;
  await model.collection.insertOne({ ...document, _id });
  return _id;
}
async function fixture(overrides = {}) {
  const _id = new mongoose.Types.ObjectId();
  await insertOwned(Product, {
    _id, name: 'Ready dress', slug: `dress-${_id}`, description: 'Ready description',
    category: 'dress', gender: 'girls', color: 'white', occasion: ['wedding'], ageTags: ['4'],
    brand: 'Original brand', familyLookGroup: 'Family', rentalEnabled: true, saleEnabled: true,
    rentalPrices: { studio: 100, external: 200 }, defaultSalePrice: 1500, defaultDeposit: 0,
    photos: [{ url: 'https://example.invalid/photo', publicId: `photo-${_id}` }],
    status: 'draft', seo: { title: 'Original title', description: 'Original SEO', noIndex: true },
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
  const variantId = await insertOwned(Variant, { productId: _id, size: '104', status: 'active' });
  await insertOwned(Inventory, { variantId, internalCode: `item-${_id}`, status: 'active', condition: 'good' });
  return _id;
}
const get = id => Product.collection.findOne({ _id: id });
const patch = (id, input) => service.updateProduct(id, input);
const activate = id => service.activateProduct(id);
const archive = id => service.archiveProduct(id);
const resultOf = promise => promise.then(value => ({ value }), error => ({ error }));
function expectCode(result, code, details) {
  assert.equal(result.error?.code, code, result.error?.stack);
  if (details) assert.deepEqual(result.error.details, details);
  return mapAdminApiError(result.error);
}
async function test(name, fn) {
  hooks = {}; operationStats = {};
  await fn();
  evidence.tests.push({ name, result: 'PASS', operations: operationStats });
  console.log(`PASS ${name}`);
}
async function race(id, first, second) {
  const pause = barrier(); let once = true;
  hooks.afterRead = async who => {
    if (who === 'second' && once) { once = false; await pause.stop(); }
  };
  const secondResult = resultOf(runAs('second', () => second(id)));
  await pause.entered;
  const firstResult = await resultOf(runAs('first', () => first(id)));
  pause.release();
  return [firstResult, await secondResult];
}

async function suite() {
  await test('Core PATCH first: activation rereads newly invalid description', async () => {
    const id = await fixture();
    const [a, b] = await race(id, id => patch(id, { description: '' }), activate);
    assert.ok(a.value); expectCode(b, 'PRODUCT_NOT_READY', ['description']);
    assert.equal(stats('second').reads, 2); assert.equal((await get(id)).status, 'draft');
  });
  await test('Core PATCH first: stale not-ready rejection becomes successful activation', async () => {
    const id = await fixture({ description: '' });
    const [a, b] = await race(id, id => patch(id, { description: 'Now ready' }), activate);
    assert.ok(a.value && b.value); assert.equal(stats('second').reads, 2);
  });
  for (const [label, input] of Object.entries({
    description: { description: '' }, category: { category: null }, gender: { gender: null },
    color: { color: '' }, studio: { rentalPrices: { studio: null } },
    external: { rentalPrices: { external: null } },
  })) await test(`Activation first rejects invalid active PATCH: ${label}`, async () => {
    const id = await fixture(); const before = await get(id);
    const [a, b] = await race(id, activate, id => patch(id, input));
    assert.ok(a.value); const mapped = expectCode(b, 'VALIDATION_ERROR');
    assert.deepEqual(mapped, { status: 400, body: { error: {
      code: 'VALIDATION_ERROR', message: 'Catalogue data failed validation',
    } } });
    const after = await get(id);
    for (const field of Object.keys(input)) assert.deepEqual(after[field], before[field]);
    assert.equal(after.status, 'active'); assert.equal(after.seo.noIndex, false);
  });
  await test('Activation first rejects enabling rental without prices', async () => {
    const id = await fixture({ rentalEnabled: false, rentalPrices: {} });
    const [a, b] = await race(id, activate, id => patch(id, { rentalEnabled: true }));
    assert.ok(a.value); expectCode(b, 'VALIDATION_ERROR');
    assert.equal((await get(id)).rentalEnabled, false);
  });
  await test('Activation first allows disabling rental and clearing both prices', async () => {
    const id = await fixture();
    const [a, b] = await race(id, activate, id => patch(id, {
      rentalEnabled: false, rentalPrices: { studio: null, external: null },
    }));
    assert.ok(a.value && b.value); const after = await get(id);
    assert.equal(after.status, 'active'); assert.equal(after.seo.noIndex, false);
    assert.equal(after.rentalEnabled, false); assert.ok(!('rentalPrices' in after));
  });
  for (const lifecycle of [activate, archive]) {
    for (const first of [true, false]) {
      for (const input of [
        { seo: { title: ' New title ' } }, { seo: { description: ' New description ' } },
        { seo: { title: '   ' } }, { seo: { description: '' } },
        { brand: 'New brand', defaultDeposit: 0 },
      ]) await test(`${lifecycle.name} ${first ? 'first' : 'second'} with ${JSON.stringify(input)}`, async () => {
        const id = await fixture(); const update = id => patch(id, input);
        const [a, b] = await race(id, first ? lifecycle : update, first ? update : lifecycle);
        assert.ok(a.value && b.value); assert.equal(stats('second').reads, 2);
        const after = await get(id); assert.equal(after.status, lifecycle === activate ? 'active' : 'archived');
        assert.equal(after.seo.noIndex, lifecycle === archive);
        for (const key of ['title', 'description']) {
          const expected = input.seo?.[key] === undefined
            ? (key === 'title' ? 'Original title' : 'Original SEO') : input.seo[key].trim() || undefined;
          assert.equal(after.seo[key], expected);
        }
        if (input.brand) assert.equal(after.brand, input.brand);
      });
    }
  }
  for (const activationFirst of [true, false]) await test(`Lifecycle contenders: ${activationFirst ? 'activation' : 'archive'} wins`, async () => {
    const id = await fixture();
    const [a, b] = await race(id, activationFirst ? activate : archive, activationFirst ? archive : activate);
    assert.ok(a.value);
    expectCode(b, activationFirst ? 'PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW' : 'PRODUCT_NOT_READY', activationFirst ? undefined : ['status']);
    const after = await get(id); assert.equal(after.status, activationFirst ? 'active' : 'archived');
    assert.equal(after.seo.noIndex, !activationFirst);
  });
  for (const order of ['PAC', 'PCA', 'APC', 'ACP', 'CPA', 'CAP']) await test(`Three-way barrier order ${order} (P=patch A=activate C=archive)`, async () => {
    const id = await fixture(); const gates = { P: barrier(), A: barrier(), C: barrier() };
    const seen = new Set();
    hooks.afterRead = async who => {
      if (gates[who] && !seen.has(who)) { seen.add(who); await gates[who].stop(); }
    };
    const actions = { P: () => patch(id, { seo: { title: 'Three-way title' }, brand: 'Three-way brand' }),
      A: () => activate(id), C: () => archive(id) };
    const tasks = Object.fromEntries(Object.entries(actions).map(([key, fn]) => [key, resultOf(runAs(key, fn))]));
    await Promise.all(Object.values(gates).map(g => g.entered));
    const results = {};
    for (const key of order) { gates[key].release(); results[key] = await tasks[key]; }
    assert.ok(results.P.value);
    const activeWins = order.indexOf('A') < order.indexOf('C');
    assert.ok(results[activeWins ? 'A' : 'C'].value);
    expectCode(results[activeWins ? 'C' : 'A'], activeWins ? 'PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW' : 'PRODUCT_NOT_READY');
    const after = await get(id); assert.equal(after.status, activeWins ? 'active' : 'archived');
    assert.equal(after.seo.noIndex, !activeWins); assert.equal(after.seo.title, 'Three-way title');
    assert.equal(after.brand, 'Three-way brand');
  });
  await test('Partial fields, normalized clear/omit/zero/false/arrays preserved after retry', async () => {
    const id = await fixture();
    const [a, b] = await race(id,
      id => patch(id, { rentalPrices: { external: 333 }, seo: { description: 'New sibling' }, color: 'blue' }),
      id => patch(id, { category: null, gender: null, defaultSalePrice: null,
        rentalPrices: { studio: null }, seo: { title: '  ' }, brand: '  ',
        description: ' trimmed ', occasion: [], ageTags: [], saleEnabled: false, defaultDeposit: 0 }));
    assert.ok(a.value && b.value); const after = await get(id);
    for (const key of ['category', 'gender', 'defaultSalePrice']) assert.ok(!(key in after));
    assert.deepEqual(after.rentalPrices, { external: 333 });
    assert.deepEqual(after.seo, { description: 'New sibling', noIndex: true });
    assert.equal(after.description, 'trimmed'); assert.equal(after.brand, ''); assert.equal(after.color, 'blue');
    assert.deepEqual(after.occasion, []); assert.deepEqual(after.ageTags, []);
    assert.equal(after.saleEnabled, false); assert.equal(after.defaultDeposit, 0);
    assert.equal(after.familyLookGroup, 'Family');
    await patch(id, { rentalPrices: { external: null } });
    assert.ok(!('rentalPrices' in await get(id)));
  });
  await test('Request schema still rejects forbidden nulls', async () => {
    for (const input of [{ slug: null }, { defaultDeposit: null }, { rentalPrices: null }, { seo: null }]) {
      assert.ok(!validateUpdateProductAdminBody(input).value);
    }
  });
  // Raw collection fixtures deliberately cover representable legacy states;
  // these are not new allowed request values.
  for (const [name, original, change] of [
    ['missing vs null', { $unset: { brand: '' } }, { $set: { brand: null } }],
    ['null vs empty', { $set: { brand: null } }, { $set: { brand: '' } }],
    ['raw whitespace vs trimmed', { $set: { brand: ' Raw brand ' } }, { $set: { brand: 'Raw brand' } }],
    ['missing vs false', { $unset: { saleEnabled: '' } }, { $set: { saleEnabled: false } }],
    ['missing vs zero', { $unset: { defaultDeposit: '' } }, { $set: { defaultDeposit: 0 } }],
    ['missing vs empty array', { $unset: { ageTags: '' } }, { $set: { ageTags: [] } }],
    ['missing vs empty parent', { $unset: { rentalPrices: '' }, $set: { rentalEnabled: false } }, { $set: { rentalPrices: {} } }],
    ['null vs object parent', { $set: { seo: null } }, { $set: { seo: { noIndex: true } } }],
    ['missing SEO leaf vs null', { $unset: { 'seo.title': '' } }, { $set: { 'seo.title': null } }],
    ['array order', { $set: { ageTags: ['4', '5'] } }, { $set: { ageTags: ['5', '4'] } }],
  ]) await test(`Raw snapshot distinguishes ${name}`, async () => {
    const id = await fixture(); await Product.collection.updateOne({ _id: id }, original);
    let once = true;
    hooks.beforeCas = async who => {
      if (who === 'patch' && once) { once = false; await Product.collection.updateOne({ _id: id }, change); }
    };
    await runAs('patch', () => patch(id, { color: 'blue' }));
    assert.equal(stats('patch').reads, 2); assert.equal(stats('patch').cas, 2);
    assert.equal(stats('patch').commits, 1);
  });
  for (const [label, update] of [
    ['BSON parent key order', { $set: { seo: { noIndex: true, description: 'Original SEO', title: 'Original title' }, rentalPrices: { external: 200, studio: 100 } } }],
    ['updatedAt only', { $set: { updatedAt: new Date() } }],
    ['photo metadata', { $set: { 'photos.0.alt': 'Concurrent ALT' } }],
  ]) await test(`Core snapshot ignores ${label}`, async () => {
    const id = await fixture(); let once = true;
    hooks.beforeCas = async () => { if (once) { once = false; await Product.collection.updateOne({ _id: id }, update); } };
    await runAs('patch', () => patch(id, { color: 'blue' }));
    assert.equal(stats('patch').reads, 1); assert.equal(stats('patch').cas, 1);
    const after = await get(id);
    if (label === 'photo metadata') assert.equal(after.photos[0].alt, 'Concurrent ALT');
  });
  await test('Literal strings beginning with dollar and missing defaults never cause false conflict/writeback', async () => {
    const id = await fixture({ brand: '$status', seo: { title: '$description', noIndex: true } });
    await Product.collection.updateOne({ _id: id }, { $unset: { ageTags: '', defaultDeposit: '', saleEnabled: '' } });
    await runAs('patch', () => patch(id, { color: 'blue' }));
    const after = await get(id); assert.equal(after.brand, '$status'); assert.equal(after.seo.title, '$description');
    for (const key of ['ageTags', 'defaultDeposit', 'saleEnabled']) assert.ok(!(key in after));
    assert.equal(stats('patch').cas, 1);
  });
  for (const initialSeo of [null, undefined, {}, { noIndex: true }]) {
    for (const title of [' New title ', ' ']) await test(`SEO parent ${JSON.stringify(initialSeo)} with title ${JSON.stringify(title)}`, async () => {
      const id = await fixture();
      await Product.collection.updateOne({ _id: id }, initialSeo === undefined ? { $unset: { seo: '' } } : { $set: { seo: initialSeo } });
      await patch(id, { seo: { title } });
      const after = await get(id);
      assert.equal(after.seo?.title, title.trim() || undefined);
      assert.equal(after.seo?.noIndex, initialSeo?.noIndex);
      if (!title.trim() && initialSeo === null) assert.equal(after.seo, null);
      if (!title.trim() && initialSeo === undefined) assert.ok(!('seo' in after));
    });
    for (const lifecycle of [activate, archive]) await test(`${lifecycle.name} owns noIndex below ${JSON.stringify(initialSeo)}`, async () => {
      const id = await fixture();
      await Product.collection.updateOne({ _id: id }, initialSeo === undefined ? { $unset: { seo: '' } } : { $set: { seo: initialSeo } });
      await lifecycle(id); assert.equal((await get(id)).seo.noIndex, lifecycle === archive);
    });
  }
  await test('Missing raw status cannot be hydrated into activation permission', async () => {
    const id = await fixture(); await Product.collection.updateOne({ _id: id }, { $unset: { status: '' } });
    expectCode(await resultOf(activate(id)), 'PRODUCT_NOT_READY', ['status']);
    assert.ok(!('status' in await get(id)));
  });
  for (const operation of [id => patch(id, { brand: 'Must not commit' }), activate, archive]) {
    await test(`Three attempts exhausted for ${operation.name || 'patch'}: no fourth/no own commit`, async () => {
      const id = await fixture();
      hooks.beforeCas = async who => {
        await Product.collection.updateOne({ _id: id }, { $set: { color: `revision-${stats(who).cas}` } });
      };
      const result = await resultOf(runAs('loser', () => operation(id)));
      assert.deepEqual(expectCode(result, 'PRODUCT_STATE_CONFLICT'), { status: 409, body: { error: {
        code: 'PRODUCT_STATE_CONFLICT', message: conflictMessage,
      } } });
      assert.deepEqual(stats('loser'), { reads: 3, cas: 3, freshness: 0, commits: 0 });
      const after = await get(id); assert.equal(after.status, 'draft');
      assert.equal(after.brand, 'Original brand'); assert.equal(after.seo.noIndex, true);
    });
  }
  await test('Readiness rejection refreshes at the error boundary', async () => {
    const id = await fixture({ description: '' }); let once = true;
    hooks.beforeFreshness = async () => { if (once) { once = false; await patch(id, { description: 'Fixed now' }); } };
    await runAs('activation', () => activate(id));
    assert.equal(stats('activation').reads, 3); // includes concurrent repair in same actor
    assert.equal((await get(id)).status, 'active');
  });
  for (const [label, operation, initial] of [
    ['validation', id => patch(id, { description: '' }), { status: 'active', seo: { noIndex: false } }],
    ['archive policy', archive, { status: 'active', seo: { noIndex: false } }],
    ['archived no-op', archive, { status: 'archived', seo: { title: 'Old', noIndex: false } }],
  ]) await test(`${label} retries on freshness mismatch`, async () => {
    const id = await fixture(initial); let once = true;
    hooks.beforeFreshness = async who => {
      if (who === 'subject' && once) { once = false; await runAs('other', () => patch(id, { seo: { title: 'Current' } })); }
    };
    const result = await resultOf(runAs('subject', () => operation(id)));
    assert.equal(stats('subject').reads, 2); assert.equal(stats('subject').cas, 0);
    if (label === 'archived no-op') {
      assert.equal(result.value.seo.title, 'Current'); assert.equal(result.value.seo.noIndex, false);
    } else expectCode(result, label === 'validation' ? 'VALIDATION_ERROR' : 'PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW');
  });
  await test('Freshness retry exhaustion never leaks stale readiness details', async () => {
    const id = await fixture({ description: '' }); let revision = 0;
    hooks.beforeFreshness = async () => {
      await Product.collection.updateOne({ _id: id }, { $set: { color: `new-${++revision}` } });
    };
    const result = await resultOf(runAs('subject', () => activate(id)));
    expectCode(result, 'PRODUCT_STATE_CONFLICT'); assert.equal(result.error.details, undefined);
    assert.deepEqual(stats('subject'), { reads: 3, cas: 0, freshness: 3, commits: 0 });
  });
  await test('Archived no-op exhaustion is a known no-commit conflict', async () => {
    const id = await fixture({ status: 'archived' }); let revision = 0;
    hooks.beforeFreshness = async () => {
      await Product.collection.updateOne({ _id: id }, { $set: { color: `changed-${++revision}` } });
    };
    const result = await resultOf(runAs('subject', () => archive(id)));
    expectCode(result, 'PRODUCT_STATE_CONFLICT');
    assert.deepEqual(stats('subject'), { reads: 3, cas: 0, freshness: 3, commits: 0 });
    assert.equal((await get(id)).status, 'archived');
  });
  await test('Stable archived no-op performs no write or SEO repair', async () => {
    const id = await fixture({ status: 'archived', seo: { noIndex: false } }); const before = await get(id);
    await runAs('archive', () => archive(id));
    assert.deepEqual(await get(id), before); assert.equal(stats('archive').cas, 0);
  });
  await test('Photo delete first blocks stale activation', async () => {
    const id = await fixture(); const publicId = (await get(id)).photos[0].publicId;
    const [a, b] = await race(id, id => media.removePhoto(id, publicId), activate);
    assert.ok(a.value); expectCode(b, 'PRODUCT_NOT_READY', ['photos']);
    assert.equal(stats('second').reads, 2); assert.equal((await get(id)).status, 'draft');
  });
  await test('Activation first blocks delete that already read draft', async () => {
    const id = await fixture(); const publicId = (await get(id)).photos[0].publicId; const pause = barrier();
    hooks.beforeMediaCas = who => who === 'delete' ? pause.stop() : undefined;
    const removal = resultOf(runAs('delete', () => media.removePhoto(id, publicId)));
    await pause.entered; await activate(id); pause.release();
    expectCode(await removal, 'PRODUCT_PHOTO_REQUIRED');
    assert.equal((await get(id)).photos.length, 1);
  });
  await test('Missing photo rejection refreshes after photo addition', async () => {
    const id = await fixture({ photos: [] }); let once = true;
    hooks.beforeFreshness = async () => {
      if (once) { once = false; await Product.collection.updateOne({ _id: id }, { $set: { photos: [{ url: 'https://example.invalid/x', publicId: 'new-photo' }] } }); }
    };
    await activate(id); assert.equal((await get(id)).status, 'active');
  });
  await test('Core conflict repeats Variant/Inventory readiness queries', async () => {
    const id = await fixture(); let once = true;
    hooks.beforeCas = async who => {
      if (who === 'activation' && once) {
        once = false;
        await Product.collection.updateOne({ _id: id }, { $set: { color: 'New core' } });
        const variant = await Variant.collection.findOne({ productId: id });
        await Inventory.collection.updateMany({ variantId: variant._id }, { $set: { status: 'maintenance' } });
      }
    };
    expectCode(await resultOf(runAs('activation', () => activate(id))), 'PRODUCT_NOT_READY', ['inventory']);
    assert.equal(stats('activation').reads, 2); assert.equal((await get(id)).status, 'draft');
  });
  for (const field of ['name', 'slug', 'description', 'category', 'gender', 'color']) {
    await test(`Existing readiness error retained: ${field}`, async () => {
      const id = await fixture(); await Product.collection.updateOne({ _id: id }, { $unset: { [field]: '' } });
      const result = await resultOf(activate(id)); expectCode(result, 'PRODUCT_NOT_READY', [field]);
      assert.equal(mapAdminApiError(result.error).status, 409);
    });
  }
  for (const [label, mutation, details] of [
    ['prices', id => Product.collection.updateOne({ _id: id }, { $unset: { rentalPrices: '' } }), ['rentalPrices.studio', 'rentalPrices.external']],
    ['variants', id => Variant.collection.updateMany({ productId: id }, { $set: { status: 'inactive' } }), ['variants', 'inventory']],
    ['inventory', async id => { const v = await Variant.collection.findOne({ productId: id }); await Inventory.collection.updateMany({ variantId: v._id }, { $set: { status: 'maintenance' } }); }, ['inventory']],
  ]) await test(`Existing graph/readiness details retained: ${label}`, async () => {
    const id = await fixture(); await mutation(id); expectCode(await resultOf(activate(id)), 'PRODUCT_NOT_READY', details);
  });
  await test('Slug precheck and actual unique-index conflict retain exact mapping/atomicity', async () => {
    const id = await fixture(); const other = await fixture(); const duplicateSlug = (await get(other)).slug;
    expectCode(await resultOf(patch(id, { slug: duplicateSlug })), 'SLUG_ALREADY_EXISTS');
    const before = await get(id); const slug = `race-slug-${id}`;
    hooks.beforeCas = async who => {
      if (who === 'loser') await Product.collection.updateOne({ _id: other }, { $set: { slug } });
    };
    expectCode(await resultOf(runAs('loser', () => patch(id, { slug, brand: 'No partial write' }))), 'SLUG_ALREADY_EXISTS');
    assert.deepEqual(await get(id), before); assert.equal(stats('loser').cas, 1);
  });
  await test('Product disappears after read: known 404, no commit', async () => {
    const id = await fixture(); let once = true;
    hooks.beforeCas = async () => { if (once) { once = false; await Product.collection.deleteOne({ _id: id }); } };
    expectCode(await resultOf(activate(id)), 'PRODUCT_NOT_FOUND');
  });
  for (const operation of [id => patch(id, { brand: 'Maybe committed' }), activate, archive]) {
    for (const stage of ['before', 'after', 'writeConcern']) await test(`${operation.name || 'patch'} ${stage} write failure never replays`, async () => {
      const id = await fixture(); const before = await get(id);
      const failure = new Error(stage === 'writeConcern' ? 'injected ambiguous write concern' : 'injected transport failure');
      if (stage === 'writeConcern') failure.name = 'MongoWriteConcernError';
      hooks[stage === 'before' ? 'beforeCas' : 'afterCas'] = async () => { throw failure; };
      const result = await resultOf(runAs('subject', () => operation(id)));
      assert.equal(result.error, failure); assert.equal(mapAdminApiError(result.error).status, 500);
      assert.equal(stats('subject').reads, 1); assert.equal(stats('subject').cas, 1);
      assert.equal(stats('subject').commits, stage === 'before' ? 0 : 1);
      const after = await get(id);
      if (stage === 'before') assert.deepEqual(after, before);
      else assert.notDeepEqual(after, before);
    });
  }
}

async function independentProcessTest(owned) {
  await test('Independent server process: stale Core PATCH retries after parent activation', async () => {
    const id = await fixture(); const target = { runId: owned.runId, database: owned.database, port: owned.port, uri: owned.uri };
    guard(target, process.env, owned);
    const child = fork(__filename, ['--worker'], {
      env: { PATH: process.env.PATH, NODE_ENV: 'test', PRODUCT_CONCURRENCY_TEST_ALLOW: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const ready = deferred(); const done = deferred(); let workerResult;
    child.on('message', message => {
      if (message.type === 'snapshot') ready.resolve();
      if (message.type === 'done') { workerResult = message; done.resolve(); }
    });
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker failed: ${code}`)));
    });
    child.send({ type: 'start', target, productId: String(id), parentPid: process.pid, mongoPid: owned.child.pid });
    await Promise.race([ready.promise, exit.then(() => { throw new Error('Worker exited before snapshot'); })]);
    await activate(id); child.send({ type: 'release' });
    await Promise.race([done.promise, exit.then(() => { if (!workerResult) throw new Error('Worker exited without evidence'); })]);
    await exit; assert.equal(workerResult.reads, 2); assert.equal(workerResult.cas, 2);
    const after = await get(id); assert.equal(after.status, 'active');
    assert.equal(after.seo.noIndex, false); assert.equal(after.seo.title, 'Independent process');
  });
}
async function existingIntegrationRegressions(owned) {
  // Existing scripts retain their own fixture-ID registries and cleanup. The
  // parent admits their connection only to its exact guarded disposable target.
  for (const script of ['check-v2-admin-api-integration.js', 'check-v2-product-media-integration.js']) {
    await test(`Existing regression: ${script}`, async () => {
      guard(owned, process.env, owned);
      const child = spawn(process.execPath, [path.join(__dirname, script)], {
        env: { PATH: process.env.PATH, NODE_ENV: 'test',
          PRODUCT_CONCURRENCY_TEST_ALLOW: '1', TEST_MONGODB_URI: owned.uri },
        stdio: 'inherit',
      });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
      });
      // Read-only residual check; never delete another registry's fixture IDs.
      for (const [model, ids] of registry) {
        assert.equal(await model.collection.countDocuments({ _id: { $nin: ids } }), 0,
          `${script} must clean its own ${model.collection.name} fixtures`);
      }
      assert.equal(await mongoose.connection.db.collection('users').countDocuments({}), 0,
        'admin integration must clean its own users');
    });
  }
}
async function worker() {
  assert.ok(process.send, 'Worker must have harness-owned IPC');
  const start = await new Promise(resolve => process.once('message', resolve));
  assert.equal(start.type, 'start'); assert.equal(start.parentPid, process.ppid);
  process.kill(start.mongoPid, 0); // Parent-provided live owned process, no signal.
  const owned = { ...start.target, child: { pid: start.mongoPid, killed: false, exitCode: null } };
  ownedInstances.add(owned);
  mongoose.set('strictQuery', true);
  await connectOwned(start.target, process.env, owned, uri => mongoose.connect(uri, { autoIndex: false, autoCreate: false }));
  installHooks(); let once = true;
  hooks.afterRead = async () => {
    if (once) {
      once = false;
      const released = new Promise(resolve => process.once('message', message => { assert.equal(message.type, 'release'); resolve(); }));
      process.send({ type: 'snapshot' }); await released;
    }
  };
  await runAs('worker', () => patch(new mongoose.Types.ObjectId(start.productId), { seo: { title: 'Independent process' } }));
  process.send({ type: 'done', ...stats('worker') });
  await mongoose.disconnect(); process.disconnect(); clearTimeout(watchdog);
}
async function main() {
  let owned;
  try {
    owned = await startMongo(); await checkGuards(owned);
    mongoose.set('strictQuery', true);
    mongoose.set('autoIndex', false); mongoose.set('autoCreate', false);
    await connectOwned(owned, process.env, owned, uri => mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 }));
    // Existing declared Product index, created only inside this owned test DB.
    await Product.collection.createIndex({ slug: 1 }, { unique: true, name: 'uniq_v2_product_slug' });
    installHooks(); await suite(); await independentProcessTest(owned);
    await existingIntegrationRegressions(owned);
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'BLOCKED_OR_FAILED'; evidence.failure = error.message;
    throw error;
  } finally {
    hooks = {};
    try {
      if (mongoose.connection.readyState === 1) {
        for (const [model, ids] of registry) {
          if (ids.length) {
            await model.collection.deleteMany({ _id: { $in: ids } });
            const remaining = await model.collection.countDocuments({ _id: { $in: ids } });
            assert.equal(remaining, 0);
            evidence.cleanup[model.collection.name] = { registered: ids.length, remaining };
          }
        }
      }
    } finally {
      try { await mongoose.disconnect(); } finally {
        if (owned && owned.child.exitCode === null) {
          const exited = new Promise(resolve => owned.child.once('exit', resolve));
          owned.child.kill('SIGTERM'); await exited;
        }
        if (owned) {
          rmSync(owned.directory, { recursive: true, force: true });
          evidence.instanceDestroyed = true;
        }
        clearTimeout(watchdog);
        evidence.connections = counters.connections;
        evidence.fixtureWrites = counters.writes;
        const directory = process.env.PRODUCT_CONCURRENCY_EVIDENCE_DIR;
        if (directory) {
          mkdirSync(directory, { recursive: true });
          const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
          writeFileSync(path.join(directory, 'product-concurrency.json'), JSON.stringify({ head, ...evidence }, null, 2));
        }
      }
    }
  }
  console.log(`PRODUCT_CONCURRENCY=PASS tests=${evidence.tests.length} guard=${evidence.guard.length}`);
  console.log(`OWNED_FIXTURE_CLEANUP=${JSON.stringify(evidence.cleanup)}`);
}
(process.argv[2] === '--worker' ? worker() : main()).catch(error => {
  console.error(error); process.exitCode = 1;
});
