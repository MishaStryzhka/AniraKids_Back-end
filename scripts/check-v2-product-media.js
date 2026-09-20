const { Types } = require('mongoose');

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

checkMediaConfiguration();
checkSignedUpload();
checkPolicyHelpers();
checkCors();

console.log('Phase 1H.4 product media pure checks passed');
