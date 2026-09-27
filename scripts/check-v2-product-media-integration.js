const mongoose = require('mongoose');
const { Types } = mongoose;
const strict = require('node:assert/strict');

const {
  ProductV2Model,
} = require('../build/v2/models');
const {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_PHOTOS,
  PRODUCT_MEDIA_ROOT_FOLDER,
  buildProductMediaFolder,
  generateProductMediaAssetBasename,
} = require('../build/v2/media/product-media.policy');
const {
  ProductMediaGatewayError,
} = require('../build/v2/media/product-media.gateway');
const {
  mapAdminApiError,
} = require('../build/v2/http/admin-error-mapper');
const {
  validateUpdateProductAdminBody,
} = require('../build/v2/schemas/admin-catalogue.schema');
const {
  ProductMediaService,
} = require('../build/v2/services/product-media.service');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error(
    'TEST_MONGODB_URI is required for product media integration checks'
  );
}

// Fail before connecting, without echoing a URI from a URL parser exception.
const parseMongoUri = uri => {
  try {
    const parsed = new URL(uri);
    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) throw new Error();
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!name || name.includes('/') || parsed.searchParams.has('dbName')) throw new Error();
    return { parsed, name, identity: `${parsed.host.toLowerCase()}/${name.toLowerCase()}` };
  } catch (_error) {
    throw new Error('Explicit valid MongoDB test database URI is required (value redacted)');
  }
};
const testTarget = parseMongoUri(testUri);
const databaseName = testTarget.name;

for (const productionEnvName of [
  'MONGODB_URI',
  'MONGO_URI',
  'DB_HOST',
]) {
  const productionUri = process.env[productionEnvName];
  if (productionUri && (
    productionUri === testUri ||
    parseMongoUri(productionUri).identity === testTarget.identity
  )) {
    throw new Error(`TEST_MONGODB_URI must not target the same database as ${productionEnvName}`);
  }
}

if (
  !/(test|testing|dev|ci)/i.test(databaseName) ||
  /(prod|production)/i.test(databaseName) ||
  databaseName.toLowerCase() === 'anirakids'
) {
  throw new Error(
    'TEST_MONGODB_URI must contain an explicit non-production test/testing/dev/ci database name'
  );
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const marker = `phase1h4-${new Types.ObjectId().toHexString().slice(-10)}`;

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${expected}, received ${actual}`
    );
  }
};

class FakeProductMediaGateway {
  constructor(rootFolder = PRODUCT_MEDIA_ROOT_FOLDER) {
    this.rootFolder = rootFolder;
    this.resources = new Map();
    this.destroyed = [];
    this.destroyFailures = new Set();
  }

  getProductFolder(productId) {
    return buildProductMediaFolder(productId, this.rootFolder);
  }

  createSignedUploadRequest(productId) {
    return {
      cloudName: 'fake-cloud',
      apiKey: 'fake-key',
      signature: 'fake-signature',
      resourceType: 'image',
      params: {
        timestamp: 1700000000,
        folder: this.getProductFolder(productId),
        public_id: generateProductMediaAssetBasename(),
        overwrite: false,
        allowed_formats: 'jpg,jpeg,png,webp',
      },
    };
  }

  addResource(productId, options = {}) {
    const basename =
      options.basename || generateProductMediaAssetBasename();
    const publicId =
      `${this.getProductFolder(productId)}/${basename}`;
    const resource = {
      publicId,
      secureUrl:
        options.secureUrl ||
        `https://res.cloudinary.test/${encodeURIComponent(publicId)}.jpg`,
      resourceType: options.resourceType || 'image',
      format: options.format || 'jpg',
      bytes: options.bytes === undefined ? 1024 : options.bytes,
      width: options.width === undefined ? 1200 : options.width,
      height: options.height === undefined ? 1600 : options.height,
    };

    this.resources.set(publicId, resource);
    return resource;
  }

  async verifyUploadedImage(publicId) {
    const resource = this.resources.get(publicId);

    if (!resource) {
      throw new ProductMediaGatewayError('fake resource missing');
    }

    return resource;
  }

  async destroyImage(publicId) {
    if (this.destroyFailures.has(publicId)) {
      throw new ProductMediaGatewayError('fake destroy failure');
    }

    this.destroyed.push(publicId);
    this.resources.delete(publicId);
  }
}

const createdIds = [];

const createDraftProduct = async name => {
  // Track ownership before insertion, so cleanup also covers a failed response.
  const _id = new Types.ObjectId();
  createdIds.push(_id);
  return ProductV2Model.create({
    _id,
    name,
    slug: `${marker}-${createdIds.length}-${_id.toHexString().slice(-6)}`,
    status: 'draft',
    photos: [],
    occasion: [],
    ageTags: [],
    rentalEnabled: false,
    saleEnabled: false,
    defaultDeposit: 0,
    seo: {
      noIndex: true,
    },
  });
};

const expectMediaError = async (operation, code, status, label) => {
  let error;

  try {
    await operation();
  } catch (caught) {
    error = caught;
  }

  assert(error, `${label} must fail`);
  assertEqual(error.code, code, `${label} error code`);
  assertEqual(
    mapAdminApiError(error).status,
    status,
    `${label} HTTP mapping`
  );

  return error;
};

const readProduct = id => ProductV2Model.findById(id).lean().exec();
const photoIds = product => product.photos.map(photo => photo.publicId);
const coreState = product => {
  const { photos, updatedAt, ...core } = product;
  return core;
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const captured = promise => promise.then(value => ({ value }), error => ({ error }));
const successful = outcome => {
  if (outcome.error) throw outcome.error;
  return outcome.value;
};
const failedWith = (outcome, code, status = 409) => {
  strict.ok(outcome.error, `${code} expected`);
  strict.equal(outcome.error.code, code);
  strict.equal(mapAdminApiError(outcome.error).status, status);
};

// A timeout is only a failure watchdog, never an ordering mechanism.
const deadline = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Barrier not reached: ${label}`)), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const queryKind = query => {
  if (query.op !== 'findOneAndUpdate') return null;
  const update = query.getUpdate();
  if (Object.prototype.hasOwnProperty.call(update.$set || {}, 'photos.$.alt')) return 'alt';
  if (Object.prototype.hasOwnProperty.call(update.$set || {}, 'photos')) return 'reorder';
  if (update.$push && update.$push.photos) return 'complete';
  if (update.$pull && update.$pull.photos) return 'delete';
  return null;
};

// Intercept only this model + fixture ID and only the first selected write.
// Both barriers live in the test process; production has no test hooks.
const gatedWrite = async (id, kind, start, interleave) => {
  const originalExec = mongoose.Query.prototype.exec;
  const before = deferred();
  const execute = deferred();
  const after = deferred();
  const returnResult = deferred();
  const stats = { reorderAttempts: 0, reorderWrites: 0 };
  let claimed = false;

  mongoose.Query.prototype.exec = async function (...args) {
    const target = this.model === ProductV2Model && String(this.getFilter()._id) === String(id);
    const currentKind = target ? queryKind(this) : null;
    if (currentKind === 'reorder') stats.reorderAttempts += 1;
    const pause = !claimed && currentKind === kind;
    if (pause) {
      claimed = true;
      before.resolve(this);
      await execute.promise;
    }
    const result = await originalExec.apply(this, args);
    if (currentKind === 'reorder' && result) stats.reorderWrites += 1;
    if (pause) {
      after.resolve(result);
      await returnResult.promise;
    }
    return result;
  };

  const operation = captured(Promise.resolve().then(start));
  const stoppedEarly = operation.then(outcome => {
    if (outcome.error) throw outcome.error;
    throw new Error(`Operation completed without expected ${kind} barrier`);
  });
  // Attach a handler immediately; the same promise is also raced below.
  stoppedEarly.catch(() => {});

  try {
    const query = await deadline(Promise.race([before.promise, stoppedEarly]), `${kind}:before`);
    await interleave({
      query,
      executeAndWait: async () => {
        execute.resolve();
        return deadline(Promise.race([after.promise, stoppedEarly]), `${kind}:after`);
      },
    });
    execute.resolve();
    returnResult.resolve();
    const outcome = await operation;
    return { ...outcome, stats };
  } finally {
    execute.resolve();
    returnResult.resolve();
    await operation;
    mongoose.Query.prototype.exec = originalExec;
  }
};

const checkConcurrency = async (gateway, service) => {
  let count = 0;
  const check = async (label, operation) => {
    await operation();
    count += 1;
    console.log(`02C-01 PASS: ${label}`);
  };
  const fixture = async (size = 2) => {
    const product = await createDraftProduct('Concurrency Fixture');
    const ids = [];
    for (let index = 0; index < size; index += 1) {
      const resource = gateway.addResource(String(product._id));
      await service.completeUpload(product._id, { publicId: resource.publicId, alt: `Photo ${index}` });
      ids.push(resource.publicId);
    }
    return { id: product._id, ids, before: await readProduct(product._id) };
  };
  const assertCore = async f => strict.deepEqual(coreState(await readProduct(f.id)), coreState(f.before));
  const alt = (f, index, value) => service.updateAlt(f.id, { publicId: f.ids[index], alt: value });
  const add = (f, resource) => service.completeUpload(f.id, { publicId: resource.publicId });

  for (const altFirst of [false, true]) {
    await check(`ALT / COMPLETE: ALT commits ${altFirst ? 'first' : 'last'}`, async () => {
      const f = await fixture(1);
      const resource = gateway.addResource(String(f.id));
      const outcome = await gatedWrite(f.id, 'alt', () => alt(f, 0, 'New A'), async control => {
        if (altFirst) await control.executeAndWait();
        await add(f, resource);
      });
      successful(outcome);
      const stored = await readProduct(f.id);
      strict.deepEqual(photoIds(stored), [f.ids[0], resource.publicId]);
      strict.equal(stored.photos[0].alt, 'New A');
      await assertCore(f);
    });
  }

  for (const altFirst of [false, true]) {
    await check(`ALT / DELETE same target: ALT commits ${altFirst ? 'first' : 'last'}`, async () => {
      const f = await fixture();
      const outcome = await gatedWrite(f.id, 'alt', () => alt(f, 0, 'New A'), async control => {
        if (altFirst) await control.executeAndWait();
        await service.removePhoto(f.id, f.ids[0]);
      });
      if (altFirst) successful(outcome);
      else failedWith(outcome, 'PHOTO_NOT_FOUND', 404);
      strict.deepEqual(photoIds(await readProduct(f.id)), [f.ids[1]]);
      await assertCore(f);
    });
  }

  await check('ALT / DELETE different target preserves both changes', async () => {
    const f = await fixture();
    successful(await gatedWrite(f.id, 'alt', () => alt(f, 0, 'New A'), async () => {
      await service.removePhoto(f.id, f.ids[1]);
    }));
    const stored = await readProduct(f.id);
    strict.deepEqual(photoIds(stored), [f.ids[0]]);
    strict.equal(stored.photos[0].alt, 'New A');
    await assertCore(f);
  });

  await check('ALT / ALT different photos both survive', async () => {
    const f = await fixture();
    successful(await gatedWrite(f.id, 'alt', () => alt(f, 0, 'New A'), () => alt(f, 1, 'New B')));
    strict.deepEqual((await readProduct(f.id)).photos.map(p => p.alt), ['New A', 'New B']);
    await assertCore(f);
  });

  await check('Same-photo ALT is last committed writer wins', async () => {
    const f = await fixture();
    successful(await gatedWrite(f.id, 'alt', () => alt(f, 0, 'Last committed'), () => alt(f, 0, 'Earlier committed')));
    strict.equal((await readProduct(f.id)).photos[0].alt, 'Last committed');
    await assertCore(f);
  });

  await check('REORDER snapshot / ALT produces 409 without overwriting alt', async () => {
    const f = await fixture(3);
    const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, [...f.ids].reverse()), () => alt(f, 1, 'New B'));
    failedWith(outcome, 'PHOTO_STATE_CONFLICT');
    strict.deepEqual(outcome.stats, { reorderAttempts: 1, reorderWrites: 0 });
    const stored = await readProduct(f.id);
    strict.deepEqual(photoIds(stored), f.ids);
    strict.equal(stored.photos[1].alt, 'New B');
    await assertCore(f);
  });

  await check('REORDER commits before ALT: order and targeted alt survive', async () => {
    const f = await fixture(3);
    successful(await gatedWrite(f.id, 'alt', () => alt(f, 1, 'New B'), () => service.reorderPhotos(f.id, [...f.ids].reverse())));
    const stored = await readProduct(f.id);
    strict.deepEqual(photoIds(stored), [...f.ids].reverse());
    strict.equal(stored.photos.find(p => p.publicId === f.ids[1]).alt, 'New B');
    await assertCore(f);
  });

  for (const reorderFirst of [false, true]) {
    await check(`REORDER / COMPLETE: REORDER commits ${reorderFirst ? 'first' : 'last'}`, async () => {
      const f = await fixture();
      const resource = gateway.addResource(String(f.id));
      const desired = [...f.ids].reverse();
      const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, desired), async control => {
        if (reorderFirst) await control.executeAndWait();
        await add(f, resource);
      });
      if (reorderFirst) successful(outcome);
      else failedWith(outcome, 'PHOTO_STATE_CONFLICT');
      strict.deepEqual(photoIds(await readProduct(f.id)), [...(reorderFirst ? desired : f.ids), resource.publicId]);
      strict.equal(outcome.stats.reorderAttempts, 1);
      strict.equal(outcome.stats.reorderWrites, reorderFirst ? 1 : 0);
      await assertCore(f);
    });
  }

  for (const reorderFirst of [false, true]) {
    await check(`REORDER / DELETE: REORDER commits ${reorderFirst ? 'first' : 'last'}`, async () => {
      const f = await fixture(3);
      const desired = [...f.ids].reverse();
      const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, desired), async control => {
        if (reorderFirst) await control.executeAndWait();
        await service.removePhoto(f.id, f.ids[2]);
      });
      if (reorderFirst) successful(outcome);
      else failedWith(outcome, 'PHOTO_STATE_CONFLICT');
      strict.deepEqual(photoIds(await readProduct(f.id)), (reorderFirst ? desired : f.ids).filter(id => id !== f.ids[2]));
      strict.equal(outcome.stats.reorderAttempts, 1);
      strict.equal(outcome.stats.reorderWrites, reorderFirst ? 1 : 0);
      await assertCore(f);
    });
  }

  await check('Concurrent REORDER: loser cannot overwrite committed order', async () => {
    const f = await fixture(3);
    const winner = [f.ids[2], f.ids[0], f.ids[1]];
    const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, [...f.ids].reverse()), () => service.reorderPhotos(f.id, winner));
    failedWith(outcome, 'PHOTO_STATE_CONFLICT');
    strict.deepEqual(outcome.stats, { reorderAttempts: 2, reorderWrites: 1 });
    strict.deepEqual(photoIds(await readProduct(f.id)), winner);
    await assertCore(f);
  });

  await check('Sequential same-membership REORDER: last successful writer wins', async () => {
    const f = await fixture(3);
    await service.reorderPhotos(f.id, [...f.ids].reverse());
    const desired = [f.ids[1], f.ids[0], f.ids[2]];
    await service.reorderPhotos(f.id, desired);
    strict.deepEqual(photoIds(await readProduct(f.id)), desired);
    await assertCore(f);
  });

  await check('R1: S0 -> S1, CAS miss, S1 -> S0 before classification remains 409', async () => {
    const f = await fixture();
    const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, [...f.ids].reverse()), async control => {
      await alt(f, 0, 'S1');
      strict.equal(await control.executeAndWait(), null, 'CAS must miss against S1');
      await alt(f, 0, f.before.photos[0].alt);
      strict.deepEqual((await readProduct(f.id)).photos, f.before.photos);
    });
    failedWith(outcome, 'PHOTO_STATE_CONFLICT');
    strict.deepEqual(outcome.stats, { reorderAttempts: 1, reorderWrites: 0 });
    strict.deepEqual((await readProduct(f.id)).photos, f.before.photos);
    await assertCore(f);
  });

  await check('R1: S0 -> S1 -> S0 before CAS permits success (no history token)', async () => {
    const f = await fixture();
    const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, [...f.ids].reverse()), async () => {
      await alt(f, 0, 'S1');
      await alt(f, 0, f.before.photos[0].alt);
    });
    successful(outcome);
    strict.deepEqual(outcome.stats, { reorderAttempts: 1, reorderWrites: 1 });
    strict.deepEqual((await readProduct(f.id)).photos, [...f.before.photos].reverse());
    await assertCore(f);
  });

  await check('Unrelated Core change does not invalidate photo CAS or get overwritten', async () => {
    const f = await fixture();
    const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, [...f.ids].reverse()), async () => {
      await ProductV2Model.updateOne({ _id: f.id }, { $set: { name: 'Concurrent Core name' } }, { runValidators: true }).exec();
    });
    successful(outcome);
    const stored = await readProduct(f.id);
    strict.deepEqual(coreState(stored), { ...coreState(f.before), name: 'Concurrent Core name' });
    strict.deepEqual(photoIds(stored), [...f.ids].reverse());
    strict.ok(stored.updatedAt instanceof Date);
    strict.ok(stored.updatedAt >= f.before.updatedAt);
  });

  await check('Zero-photo reorder [] succeeds; missing Product and missing ALT target map 404', async () => {
    const f = await fixture(0);
    strict.deepEqual((await service.reorderPhotos(f.id, [])).photos.toObject(), []);
    await expectMediaError(() => service.reorderPhotos(new Types.ObjectId(), []), 'PRODUCT_NOT_FOUND', 404, 'missing reorder Product');
    await expectMediaError(() => service.updateAlt(new Types.ObjectId(), { publicId: 'missing', alt: 'x' }), 'PRODUCT_NOT_FOUND', 404, 'missing ALT Product');
    await expectMediaError(() => service.updateAlt(f.id, { publicId: 'missing', alt: 'x' }), 'PHOTO_NOT_FOUND', 404, 'missing ALT target');
    await assertCore(f);
  });

  for (const kind of ['alt', 'reorder']) {
    await check(`${kind} Product disappears at write point: 404, never recreated`, async () => {
      const f = await fixture();
      const outcome = await gatedWrite(f.id, kind, () => kind === 'alt' ? alt(f, 0, 'x') : service.reorderPhotos(f.id, [...f.ids].reverse()), async () => {
        await ProductV2Model.deleteOne({ _id: f.id }).exec();
      });
      failedWith(outcome, 'PRODUCT_NOT_FOUND', 404);
      strict.equal(await readProduct(f.id), null);
    });
  }

  await check('Missing/extra/duplicate initial order rejected without mutation', async () => {
    const f = await fixture(3);
    for (const ids of [f.ids.slice(1), [f.ids[0], f.ids[1], 'extra'], [f.ids[0], f.ids[0], f.ids[2]]]) {
      await expectMediaError(() => service.reorderPhotos(f.id, ids), 'VALIDATION_ERROR', 400, 'invalid membership');
      strict.deepEqual((await readProduct(f.id)).photos, f.before.photos);
    }
    await assertCore(f);
  });

  await check('Canonical CAS ignores BSON key order; preserves missing/null/empty/dollar alt', async () => {
    const f = await fixture(4);
    const photos = [
      { url: f.before.photos[0].url, publicId: f.ids[0] },
      { alt: null, publicId: f.ids[1], url: f.before.photos[1].url },
      { publicId: f.ids[2], alt: '', url: f.before.photos[2].url },
      { alt: '$literal text', url: f.before.photos[3].url, publicId: f.ids[3] },
    ];
    // Raw fixture write deliberately preserves alternate BSON key order.
    await ProductV2Model.collection.updateOne({ _id: f.id }, { $set: { photos } });
    await service.reorderPhotos(f.id, [...f.ids].reverse());
    const stored = await readProduct(f.id);
    strict.deepEqual(stored.photos, [...photos].reverse());
    await assertCore(f);
  });

  const setOptionalAlt = (id, value) => ProductV2Model.collection.updateOne(
    { _id: id },
    value === undefined ? { $unset: { 'photos.0.alt': '' } } : { $set: { 'photos.0.alt': value } }
  );
  const altStates = [undefined, null, ''];
  const altStateName = value => value === undefined ? 'missing' : value === null ? 'null' : 'empty';
  for (const from of altStates) {
    for (const to of altStates) {
      if (from === to) continue;
      await check(`CAS distinguishes alt ${altStateName(from)} -> ${altStateName(to)}`, async () => {
        const f = await fixture();
        await setOptionalAlt(f.id, from);
        const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, [...f.ids].reverse()), () => setOptionalAlt(f.id, to));
        failedWith(outcome, 'PHOTO_STATE_CONFLICT');
        const stored = await readProduct(f.id);
        strict.deepEqual(photoIds(stored), f.ids);
        strict.equal(stored.photos[0].alt, to);
        strict.equal(Object.prototype.hasOwnProperty.call(stored.photos[0], 'alt'), to !== undefined);
        strict.deepEqual(outcome.stats, { reorderAttempts: 1, reorderWrites: 0 });
        await assertCore(f);
      });
    }
  }

  await check('Concurrent URL change is protected by CAS', async () => {
    const f = await fixture();
    const url = 'https://example.test/new-url.jpg';
    const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, [...f.ids].reverse()), async () => {
      await ProductV2Model.collection.updateOne({ _id: f.id }, { $set: { 'photos.0.url': url } });
    });
    failedWith(outcome, 'PHOTO_STATE_CONFLICT');
    const stored = await readProduct(f.id);
    strict.equal(stored.photos[0].url, url);
    strict.deepEqual(photoIds(stored), f.ids);
    await assertCore(f);
  });

  await check('Database expression error propagates as 500, not conflict', async () => {
    const f = await fixture();
    const outcome = await gatedWrite(f.id, 'reorder', () => service.reorderPhotos(f.id, [...f.ids].reverse()), async control => {
      // Inject a genuine query execution failure only in this test process.
      control.query.setQuery({ _id: f.id, $expr: { $eq: [{ $divide: [1, 0] }, 0] } });
    });
    strict.ok(outcome.error);
    strict.notEqual(outcome.error.code, 'PHOTO_STATE_CONFLICT');
    strict.equal(mapAdminApiError(outcome.error).status, 500);
    strict.deepEqual((await readProduct(f.id)).photos, f.before.photos);
    await assertCore(f);
  });

  await check('ALT query validators still reject >180 characters without mutation', async () => {
    const f = await fixture();
    await strict.rejects(() => alt(f, 0, 'x'.repeat(181)), error => error.name === 'ValidationError');
    strict.deepEqual((await readProduct(f.id)).photos, f.before.photos);
    await assertCore(f);
  });

  await check('Concurrent COMPLETE of same publicId keeps one attachment', async () => {
    const f = await fixture(0);
    const resource = gateway.addResource(String(f.id));
    successful(await gatedWrite(f.id, 'complete', () => add(f, resource), () => add(f, resource)));
    strict.deepEqual(photoIds(await readProduct(f.id)), [resource.publicId]);
    await assertCore(f);
  });

  await check('Concurrent COMPLETE at limit cannot attach an eleventh photo', async () => {
    const f = await fixture(9);
    const first = gateway.addResource(String(f.id));
    const winner = gateway.addResource(String(f.id));
    const outcome = await gatedWrite(f.id, 'complete', () => add(f, first), () => add(f, winner));
    failedWith(outcome, 'PHOTO_LIMIT_REACHED');
    strict.deepEqual(photoIds(await readProduct(f.id)), [...f.ids, winner.publicId]);
    await assertCore(f);
  });

  await check('Concurrent DELETE cannot remove active Product last distinct photo', async () => {
    const f = await fixture();
    await ProductV2Model.updateOne({ _id: f.id }, { $set: {
      status: 'active', description: 'Active fixture', category: 'dress', gender: 'girls', color: 'ivory',
    } }, { runValidators: true }).exec();
    f.before = await readProduct(f.id);
    const outcome = await gatedWrite(f.id, 'delete', () => service.removePhoto(f.id, f.ids[0]), () => service.removePhoto(f.id, f.ids[1]));
    failedWith(outcome, 'PRODUCT_PHOTO_REQUIRED');
    strict.deepEqual(photoIds(await readProduct(f.id)), [f.ids[0]]);
    await assertCore(f);
  });

  console.log(`02C-01 deterministic media concurrency/regression checks passed: ${count}`);
};

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 15000,
  });

  try {
    strict.equal(mongoose.connection.name, databaseName, 'Connected TEST DB must match guarded name');
    console.log('TEST_DB_GUARD=PASS; autoIndex=false; autoCreate=false; fake provider only');
    const gateway = new FakeProductMediaGateway();
    const service = new ProductMediaService(gateway);

    const signedProduct = await createDraftProduct('Signed Dress');
    const signed = await service.signUpload(signedProduct._id);

    assertEqual(
      signed.params.folder,
      gateway.getProductFolder(signedProduct._id.toHexString()),
      'A sign existing Product folder'
    );

    await expectMediaError(
      () => service.signUpload(new Types.ObjectId()),
      'PRODUCT_NOT_FOUND',
      404,
      'B sign missing Product'
    );

    const attachProduct = await createDraftProduct('Attach Dress');
    const attachId = attachProduct._id.toHexString();
    const firstResource = gateway.addResource(attachId, {
      secureUrl: 'https://res.cloudinary.test/trusted-first.jpg',
    });

    const firstComplete = await service.completeUpload(
      attachProduct._id,
      {
        publicId: firstResource.publicId,
        url: 'https://attacker.example/not-trusted.jpg',
      }
    );

    assertEqual(firstComplete.photos.length, 1, 'C complete adds photo');
    assertEqual(
      firstComplete.photos[0].url,
      firstResource.secureUrl,
      'D stored URL comes from gateway'
    );
    assertEqual(
      firstComplete.photos[0].publicId,
      firstResource.publicId,
      'D stored publicId comes from gateway'
    );
    assertEqual(
      firstComplete.photos[0].alt,
      'Attach Dress',
      'E missing alt falls back to Product name'
    );

    const duplicate = await service.completeUpload(
      attachProduct._id,
      {
        publicId: firstResource.publicId,
        alt: 'Ignored duplicate alt',
      }
    );

    assertEqual(
      duplicate.photos.length,
      1,
      'F duplicate complete idempotent'
    );
    assertEqual(duplicate.photos[0].alt, firstComplete.photos[0].alt, 'F COMPLETE retry is not ALT update');

    for (
      let index = 1;
      index < MAX_PRODUCT_PHOTOS;
      index += 1
    ) {
      const resource = gateway.addResource(attachId);
      await service.completeUpload(attachProduct._id, {
        publicId: resource.publicId,
        alt: `Photo ${index + 1}`,
      });
    }

    const atLimit = await ProductV2Model.findById(
      attachProduct._id
    )
      .lean()
      .exec();

    assert(atLimit, 'G limit fixture exists');
    assertEqual(
      atLimit.photos.length,
      MAX_PRODUCT_PHOTOS,
      'G attach up to limit'
    );

    const eleventh = gateway.addResource(attachId);
    await expectMediaError(
      () =>
        service.completeUpload(attachProduct._id, {
          publicId: eleventh.publicId,
        }),
      'PHOTO_LIMIT_REACHED',
      409,
      'H 11th photo'
    );

    const edited = await service.updateAlt(attachProduct._id, {
      publicId: firstResource.publicId,
      alt: '  Upravený alt  ',
    });
    assertEqual(
      edited.photos[0].alt,
      'Upravený alt',
      'I edit alt'
    );

    const reorderProduct = await createDraftProduct('Reorder Dress');
    const reorderId = reorderProduct._id.toHexString();
    const reorderResources = [];

    for (let index = 0; index < 3; index += 1) {
      const resource = gateway.addResource(reorderId);
      reorderResources.push(resource);
      await service.completeUpload(reorderProduct._id, {
        publicId: resource.publicId,
      });
    }

    const desiredOrder = [
      reorderResources[2].publicId,
      reorderResources[0].publicId,
      reorderResources[1].publicId,
    ];
    const reordered = await service.reorderPhotos(
      reorderProduct._id,
      desiredOrder
    );

    assertEqual(
      reordered.photos.map(photo => photo.publicId).join('|'),
      desiredOrder.join('|'),
      'J reorder 3 photos'
    );

    const beforeInvalidOrder = await ProductV2Model.findById(
      reorderProduct._id
    )
      .lean()
      .exec();

    let invalidOrderError;
    try {
      await service.reorderPhotos(reorderProduct._id, [
        reorderResources[0].publicId,
        reorderResources[1].publicId,
      ]);
    } catch (caught) {
      invalidOrderError = caught;
    }

    assertEqual(
      mapAdminApiError(invalidOrderError).status,
      400,
      'K invalid reorder status'
    );

    const afterInvalidOrder = await ProductV2Model.findById(
      reorderProduct._id
    )
      .lean()
      .exec();

    assertEqual(
      JSON.stringify(afterInvalidOrder.photos),
      JSON.stringify(beforeInvalidOrder.photos),
      'K invalid reorder does not mutate DB'
    );

    const draftDeleteProduct = await createDraftProduct(
      'Delete Draft'
    );
    const draftDeleteResource = gateway.addResource(
      draftDeleteProduct._id.toHexString()
    );

    await service.completeUpload(draftDeleteProduct._id, {
      publicId: draftDeleteResource.publicId,
    });

    const draftDeleted = await service.removePhoto(
      draftDeleteProduct._id,
      draftDeleteResource.publicId
    );
    assertEqual(
      draftDeleted.photos.length,
      0,
      'L draft delete removes photo'
    );

    const cleanupFailureProduct = await createDraftProduct(
      'Cleanup Failure Draft'
    );
    const cleanupFailureResource = gateway.addResource(
      cleanupFailureProduct._id.toHexString()
    );

    await service.completeUpload(cleanupFailureProduct._id, {
      publicId: cleanupFailureResource.publicId,
    });

    gateway.destroyFailures.add(cleanupFailureResource.publicId);

    const cleanupFailureDeleted = await service.removePhoto(
      cleanupFailureProduct._id,
      cleanupFailureResource.publicId
    );

    assertEqual(
      cleanupFailureDeleted.photos.length,
      0,
      'M cleanup failure does not roll back DB deletion'
    );

    const cleanupFailureStored = await ProductV2Model.findById(
      cleanupFailureProduct._id
    )
      .lean()
      .exec();

    assertEqual(
      cleanupFailureStored.photos.length,
      0,
      'M DB remains deleted after destroy failure'
    );

    const activeId = new Types.ObjectId().toHexString();
    const activeFolder = gateway.getProductFolder(activeId);
    const activePhotos = [
      {
        url: 'https://res.cloudinary.test/active-one.jpg',
        publicId:
          `${activeFolder}/${generateProductMediaAssetBasename()}`,
        alt: 'One',
      },
      {
        url: 'https://res.cloudinary.test/active-two.jpg',
        publicId:
          `${activeFolder}/${generateProductMediaAssetBasename()}`,
        alt: 'Two',
      },
    ];

    createdIds.push(new Types.ObjectId(activeId));
    const activeProduct = await ProductV2Model.create({
      _id: new Types.ObjectId(activeId),
      name: 'Active Two Photos',
      slug: `${marker}-active-two`,
      description: 'Active fixture',
      category: 'dress',
      gender: 'girls',
      color: 'ivory',
      status: 'active',
      photos: activePhotos,
      occasion: [],
      ageTags: [],
      rentalEnabled: false,
      saleEnabled: false,
      defaultDeposit: 0,
      seo: { noIndex: false },
    });

    const activeOneRemoved = await service.removePhoto(
      activeProduct._id,
      activePhotos[0].publicId
    );

    assertEqual(
      activeOneRemoved.photos.length,
      1,
      'N active delete one allowed'
    );

    await expectMediaError(
      () =>
        service.removePhoto(
          activeProduct._id,
          activePhotos[1].publicId
        ),
      'PRODUCT_PHOTO_REQUIRED',
      409,
      'O active last photo delete'
    );

    const wrongProduct = await createDraftProduct(
      'Wrong Folder Dress'
    );
    const otherProductId = new Types.ObjectId().toHexString();
    const wrongPublicId =
      `${gateway.getProductFolder(otherProductId)}/${generateProductMediaAssetBasename()}`;

    await expectMediaError(
      () =>
        service.completeUpload(wrongProduct._id, {
          publicId: wrongPublicId,
        }),
      'PHOTO_WRONG_PRODUCT',
      400,
      'P wrong Product folder'
    );

    const tooLargeProduct = await createDraftProduct(
      'Oversize Dress'
    );
    const tooLargeResource = gateway.addResource(
      tooLargeProduct._id.toHexString(),
      {
        bytes: MAX_PRODUCT_IMAGE_BYTES + 1,
      }
    );

    await expectMediaError(
      () =>
        service.completeUpload(tooLargeProduct._id, {
          publicId: tooLargeResource.publicId,
        }),
      'IMAGE_TOO_LARGE',
      400,
      'Q resource too large'
    );

    const tooLargeStored = await ProductV2Model.findById(
      tooLargeProduct._id
    )
      .lean()
      .exec();

    assertEqual(
      tooLargeStored.photos.length,
      0,
      'Q oversize not attached'
    );
    assert(
      gateway.destroyed.includes(tooLargeResource.publicId),
      'Q oversize cleanup attempted'
    );

    const genericPhotoPatch = validateUpdateProductAdminBody({
      photos: [
        {
          url: 'https://attacker.example/photo.jpg',
          publicId: 'attacker/photo',
        },
      ],
    });

    assert(
      !genericPhotoPatch.value,
      'R generic Product PATCH must still reject photos'
    );

    console.log(
      'Phase 1H.4 product media integration checks passed: A-R'
    );
    await checkConcurrency(gateway, service);
  } finally {
    try {
      if (createdIds.length > 0) {
        const owned = { _id: { $in: createdIds } };
        await ProductV2Model.deleteMany(owned).exec();
        strict.equal(await ProductV2Model.countDocuments(owned).exec(), 0, 'Owned fixtures must be removed');
      }
      console.log(`TEST_FIXTURE_CLEANUP=PASS; owned IDs=${createdIds.length}; REAL_PROVIDER_OPERATIONS=ZERO`);
    } finally {
      await mongoose.disconnect();
    }
  }
};

main().catch(async error => {
  // Never print a connection string from a driver/parser exception.
  const message = String(error.message || 'Unknown integration failure')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s'"<>]+/gi, '<redacted MongoDB URI>');
  console.error('Product media integration checks failed:', error.name, message);
  await mongoose.disconnect();
  process.exitCode = 1;
});
