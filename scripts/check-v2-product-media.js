const { Types } = require('mongoose');
const strict = require('node:assert/strict');

const {
  CloudinaryProductMediaGateway,
} = require('../build/v2/media/cloudinary-product-media.gateway');
const {
  ProductMediaConfigurationError,
  getProductMediaConfig,
} = require('../build/v2/media/product-media.config');
const {
  MAX_PRODUCT_PHOTOS,
  PRODUCT_MEDIA_ROOT_FOLDER,
  buildProductMediaFolder,
  canRemoveProductPhoto,
  generateProductMediaAssetBasename,
  hasProductPhoto,
  hasReachedProductPhotoLimit,
  isPublicIdInProductFolder,
  normalizeProductPhotoAlt,
  reorderProductPhotosExact,
} = require('../build/v2/media/product-media.policy');
const {
  createV2CorsOptions,
} = require('../build/v2/http/cors');
const { ProductV2Model } = require('../build/v2/models');
const { ProductMediaService } = require('../build/v2/services/product-media.service');
const { ProductMediaError } = require('../build/v2/services/product-media.types');
const { mapAdminApiError } = require('../build/v2/http/admin-error-mapper');
const { createAdminProductMediaHandlers } = require('../build/v2/controllers/admin-product-media.controller');

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

const checkMediaConfiguration = () => {
  const valid = getProductMediaConfig({
    CLOUDINARY_NAME: 'anirakids-test',
    CLOUDINARY_KEY: 'key',
    CLOUDINARY_SECRET: 'secret',
  });

  assertEqual(valid.cloudName, 'anirakids-test', 'cloud name');
  assertEqual(valid.apiKey, 'key', 'api key');
  assertEqual(valid.apiSecret, 'secret', 'api secret');

  for (const missing of [
    'CLOUDINARY_NAME',
    'CLOUDINARY_KEY',
    'CLOUDINARY_SECRET',
  ]) {
    const env = {
      CLOUDINARY_NAME: 'name',
      CLOUDINARY_KEY: 'key',
      CLOUDINARY_SECRET: 'secret',
    };

    delete env[missing];
    let error;

    try {
      getProductMediaConfig(env);
    } catch (caught) {
      error = caught;
    }

    assert(
      error instanceof ProductMediaConfigurationError,
      `${missing} must fail media configuration`
    );
  }
};

const checkSignedUpload = () => {
  const original = {
    name: process.env.CLOUDINARY_NAME,
    key: process.env.CLOUDINARY_KEY,
    secret: process.env.CLOUDINARY_SECRET,
  };

  try {
    process.env.CLOUDINARY_NAME = 'anirakids-pure';
    process.env.CLOUDINARY_KEY = '123456';
    process.env.CLOUDINARY_SECRET = 'never-return-this-secret';

    const productId = new Types.ObjectId().toHexString();
    const gateway = new CloudinaryProductMediaGateway();
    const first = gateway.createSignedUploadRequest(productId);
    const second = gateway.createSignedUploadRequest(productId);

    assertEqual(
      first.params.folder,
      `${PRODUCT_MEDIA_ROOT_FOLDER}/${productId}`,
      'signed folder contains Product id'
    );
    assert(
      first.params.public_id !== second.params.public_id,
      'server-generated public ids must be unique'
    );
    assert(
      /^[0-9a-f-]{36}$/i.test(first.params.public_id),
      'server-generated public id must be UUID-shaped'
    );
    assert(first.signature.length > 0, 'signature must be present');
    assertEqual(first.params.overwrite, false, 'overwrite disabled');

    const serialized = JSON.stringify(first);
    assert(
      !serialized.includes('never-return-this-secret'),
      'signed response must not expose apiSecret'
    );
    assert(
      !Object.prototype.hasOwnProperty.call(first, 'apiSecret'),
      'signed DTO must not contain apiSecret'
    );
  } finally {
    const restore = (name, value) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };

    restore('CLOUDINARY_NAME', original.name);
    restore('CLOUDINARY_KEY', original.key);
    restore('CLOUDINARY_SECRET', original.secret);
  }
};

const checkPolicyHelpers = () => {
  const productId = new Types.ObjectId().toHexString();
  const folder = buildProductMediaFolder(productId);
  const generatedOne = generateProductMediaAssetBasename();
  const generatedTwo = generateProductMediaAssetBasename();

  assert(generatedOne !== generatedTwo, 'UUID helper uniqueness');
  assert(
    isPublicIdInProductFolder(`${folder}/${generatedOne}`, folder),
    'correct product folder accepted'
  );
  assert(
    !isPublicIdInProductFolder(
      `${buildProductMediaFolder(new Types.ObjectId().toHexString())}/${generatedOne}`,
      folder
    ),
    'wrong product folder rejected'
  );
  assert(
    !isPublicIdInProductFolder(`${folder}/nested/${generatedOne}`, folder),
    'nested arbitrary public id rejected'
  );

  assertEqual(
    normalizeProductPhotoAlt(undefined, ' Sofia '),
    'Sofia',
    'missing alt falls back to Product name'
  );
  assertEqual(
    normalizeProductPhotoAlt('  Detail zezadu  ', 'Sofia'),
    'Detail zezadu',
    'alt normalization'
  );
  assertEqual(
    normalizeProductPhotoAlt('   ', 'Sofia'),
    'Sofia',
    'blank alt falls back to Product name'
  );

  assert(
    !hasReachedProductPhotoLimit(MAX_PRODUCT_PHOTOS - 1),
    'below max photo limit accepted'
  );
  assert(
    hasReachedProductPhotoLimit(MAX_PRODUCT_PHOTOS),
    'max photo limit enforced'
  );

  const photos = [
    { url: 'https://example.test/1.jpg', publicId: 'p/1', alt: '1' },
    { url: 'https://example.test/2.jpg', publicId: 'p/2', alt: '2' },
    { url: 'https://example.test/3.jpg', publicId: 'p/3', alt: '3' },
  ];

  assert(hasProductPhoto(photos, 'p/2'), 'duplicate attachment helper');
  assert(
    !hasProductPhoto(photos, 'p/4'),
    'duplicate attachment helper negative case'
  );

  const reordered = reorderProductPhotosExact(
    photos,
    ['p/3', 'p/1', 'p/2']
  );
  assert(reordered, 'valid reorder accepted');
  assertEqual(reordered[0].publicId, 'p/3', 'reorder first image');

  assert(
    !reorderProductPhotosExact(photos, ['p/1', 'p/2']),
    'reorder missing id rejected'
  );
  assert(
    !reorderProductPhotosExact(photos, ['p/1', 'p/2', 'p/4']),
    'reorder extra id rejected'
  );
  assert(
    !reorderProductPhotosExact(photos, ['p/1', 'p/1', 'p/2']),
    'reorder duplicate id rejected'
  );

  assert(
    !canRemoveProductPhoto('active', 1),
    'active last photo delete blocked'
  );
  assert(
    canRemoveProductPhoto('active', 2),
    'active Product may delete when one remains'
  );
  assert(
    canRemoveProductPhoto('draft', 1),
    'draft may delete last photo'
  );
};

const checkCors = () => {
  const options = createV2CorsOptions('https://preview.example.cz');
  assert(options.methods.includes('DELETE'), 'CORS must include DELETE');
  assert(!options.methods.includes('*'), 'CORS methods must not use wildcard');
};

const checkAtomicWriteContracts = async () => {
  const original = {
    findOneAndUpdate: ProductV2Model.findOneAndUpdate,
    findById: ProductV2Model.findById,
    exists: ProductV2Model.exists,
  };
  const id = new Types.ObjectId();
  const photos = [
    { publicId: 'p/a', url: 'https://example.test/a.jpg' },
    { alt: '', url: 'https://example.test/b.jpg', publicId: 'p/b' },
    { publicId: 'p/c', alt: null, url: 'https://example.test/c.jpg' },
    { publicId: 'p/d', url: 'https://example.test/d.jpg', alt: '$literal text' },
  ];
  const product = { _id: id, photos };
  const calls = [];
  let result = product;
  let exists = { _id: id };
  let read = product;
  let queryError;
  let existenceCalls = 0;
  const service = new ProductMediaService({}); // ALT/REORDER never call provider.

  try {
    ProductV2Model.findOneAndUpdate = (...args) => {
      calls.push(args);
      return { exec: async () => {
        if (queryError) throw queryError;
        return result;
      } };
    };
    ProductV2Model.findById = () => ({
      lean: () => ({ exec: async () => read }),
    });
    ProductV2Model.exists = () => ({ exec: async () => {
      existenceCalls += 1;
      return exists;
    } });

    strict.equal(await service.updateAlt(id, { publicId: 'p/a', alt: '  New  ' }), product);
    strict.deepEqual(calls.pop(), [
      { _id: id, 'photos.publicId': 'p/a' },
      { $set: { 'photos.$.alt': 'New' } },
      { new: true, runValidators: true },
    ]);

    await service.reorderPhotos(id, ['p/d', 'p/c', 'p/b', 'p/a']);
    const [filter, update, options] = calls.pop();
    strict.deepEqual(Object.keys(filter).sort(), ['$expr', '_id']);
    strict.deepEqual(filter.$expr.$eq[0], {
      $map: { input: '$photos', as: 'photo', in: [
        '$$photo.publicId', '$$photo.url', { $type: '$$photo.alt' },
        { $ifNull: ['$$photo.alt', null] },
      ] },
    });
    strict.deepEqual(filter.$expr.$eq[1], { $literal: [
      ['p/a', photos[0].url, 'missing', null],
      ['p/b', photos[1].url, 'string', ''],
      ['p/c', photos[2].url, 'null', null],
      ['p/d', photos[3].url, 'string', '$literal text'],
    ] });
    strict.deepEqual(update, { $set: { photos: [...photos].reverse() } });
    strict.deepEqual(options, { new: true, runValidators: true });

    const expectCode = async (operation, code, status) => {
      await strict.rejects(operation, error => {
        strict.equal(error.code, code);
        strict.equal(mapAdminApiError(error).status, status);
        return true;
      });
    };
    result = null;
    await expectCode(() => service.updateAlt(id, { publicId: 'absent', alt: 'x' }), 'PHOTO_NOT_FOUND', 404);
    calls.length = 0;
    // The diagnostic lookup only checks existence, even if read.photos == S0.
    await expectCode(() => service.reorderPhotos(id, photos.map(p => p.publicId)), 'PHOTO_STATE_CONFLICT', 409);
    strict.equal(calls.length, 1, 'CAS miss must not trigger a second write');
    exists = null;
    await expectCode(() => service.updateAlt(id, { publicId: 'p/a', alt: 'x' }), 'PRODUCT_NOT_FOUND', 404);
    await expectCode(() => service.reorderPhotos(id, photos.map(p => p.publicId)), 'PRODUCT_NOT_FOUND', 404);
    read = null;
    await expectCode(() => service.reorderPhotos(id, []), 'PRODUCT_NOT_FOUND', 404);
    read = product;
    calls.length = 0;
    for (const order of [['p/a'], ['p/a', 'p/b', 'p/c', 'extra'], ['p/a', 'p/a', 'p/c', 'p/d']]) {
      await expectCode(() => service.reorderPhotos(id, order), 'VALIDATION_ERROR', 400);
    }
    strict.equal(calls.length, 0, 'invalid initial membership performs no write');
    read = { _id: id, photos: [] };
    result = read;
    strict.equal(await service.reorderPhotos(id, []), read);
    strict.deepEqual(calls.pop()[0].$expr.$eq[1], { $literal: [] });

    read = product;
    queryError = new Error('controlled query failure');
    const before = existenceCalls;
    await strict.rejects(() => service.updateAlt(id, { publicId: 'p/a', alt: 'x' }), e => e === queryError);
    await strict.rejects(() => service.reorderPhotos(id, photos.map(p => p.publicId)), e => e === queryError);
    strict.equal(existenceCalls, before, 'query exceptions do not enter no-match classification');
    strict.equal(mapAdminApiError(queryError).status, 500);
  } finally {
    Object.assign(ProductV2Model, original);
  }
};

const checkMediaEnvelopes = async () => {
  const conflict = new ProductMediaError('PHOTO_STATE_CONFLICT', 'Product photos changed; refresh and retry');
  strict.deepEqual(mapAdminApiError(conflict), {
    status: 409,
    body: { error: { code: 'PHOTO_STATE_CONFLICT', message: 'Product photos changed; refresh and retry' } },
  });
  strict.equal(mapAdminApiError(Object.assign(new Error('not a domain error'), { code: 'PHOTO_STATE_CONFLICT' })).status, 500);
  for (const [code, status] of [
    ['PRODUCT_NOT_FOUND', 404], ['PHOTO_NOT_FOUND', 404],
    ['PHOTO_LIMIT_REACHED', 409], ['PRODUCT_PHOTO_REQUIRED', 409],
    ['PHOTO_INVALID_RESOURCE', 400], ['PHOTO_WRONG_PRODUCT', 400],
    ['IMAGE_TOO_LARGE', 400], ['CLOUDINARY_OPERATION_FAILED', 502],
    ['MEDIA_CONFIGURATION_ERROR', 503],
  ]) strict.equal(mapAdminApiError(new ProductMediaError(code, code)).status, status);

  const product = new ProductV2Model({ name: 'Envelope', slug: 'envelope', photos: [] });
  const handlers = createAdminProductMediaHandlers({
    updateAlt: async () => product,
    reorderPhotos: async () => product,
  });
  for (const name of ['updateProductPhotoAlt', 'reorderProductPhotos']) {
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
    await handlers[name]({ params: { productId: product._id.toHexString() }, body: { publicId: 'p/a', alt: 'x', publicIds: [] } }, response, error => { throw error; });
    strict.equal(response.statusCode, 200);
    strict.deepEqual(Object.keys(response.body), ['product']);
    strict.equal(response.body.product.id, product._id.toHexString());
  }
};

const main = async () => {
  checkMediaConfiguration();
  checkSignedUpload();
  checkPolicyHelpers();
  checkCors();
  await checkAtomicWriteContracts();
  await checkMediaEnvelopes();
  console.log('Phase 1H.4 product media pure checks passed');
  console.log('02C-01 atomic ALT, snapshot CAS, classification and HTTP envelope pure checks passed');
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
