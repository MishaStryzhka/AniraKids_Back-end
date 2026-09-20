const mongoose = require('mongoose');

const {
  ProductV2Model,
} = require('../build/v2/models');
const {
  CloudinaryProductMediaGateway,
} = require('../build/v2/media/cloudinary-product-media.gateway');
const {
  ProductMediaGatewayError,
} = require('../build/v2/media/product-media.gateway');
const {
  ProductMediaService,
} = require('../build/v2/services/product-media.service');

if (process.env.RUN_CLOUDINARY_INTEGRATION !== 'true') {
  console.log(
    'Phase 1H.4 real Cloudinary smoke test SKIPPED: RUN_CLOUDINARY_INTEGRATION is not true'
  );
  process.exit(0);
}

const testUri = process.env.TEST_MONGODB_URI;
const requiredCloudinary = [
  'CLOUDINARY_NAME',
  'CLOUDINARY_KEY',
  'CLOUDINARY_SECRET',
];

if (!testUri || requiredCloudinary.some(name => !process.env[name])) {
  console.log(
    'Phase 1H.4 real Cloudinary smoke test SKIPPED: TEST_MONGODB_URI or Cloudinary test configuration is missing'
  );
  process.exit(0);
}

for (const productionEnvName of [
  'MONGODB_URI',
  'MONGO_URI',
  'DB_HOST',
]) {
  if (
    process.env[productionEnvName] &&
    process.env[productionEnvName] === testUri
  ) {
    throw new Error(
      `TEST_MONGODB_URI must not equal ${productionEnvName}`
    );
  }
}

const databaseName = decodeURIComponent(
  new URL(testUri).pathname.replace(/^\//, '')
);

if (
  !databaseName ||
  !/(test|testing|dev|ci)/i.test(databaseName) ||
  /(prod|production)/i.test(databaseName) ||
  databaseName === 'AniraKids'
) {
  throw new Error(
    'TEST_MONGODB_URI must contain an explicit non-production test/testing/dev/ci database name'
  );
}

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const rootFolder = `AniraKids_Products/v2-test/${runId}`;
const gateway = new CloudinaryProductMediaGateway(rootFolder);
const service = new ProductMediaService(gateway);

let productId;
let uploadedPublicId;

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64'
);

const directUpload = async signed => {
  const form = new FormData();

  form.append(
    'file',
    new Blob([tinyPng], { type: 'image/png' }),
    'phase1h4.png'
  );
  form.append('api_key', signed.apiKey);
  form.append('signature', signed.signature);

  for (const [key, value] of Object.entries(signed.params)) {
    form.append(key, String(value));
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName)}/image/upload`,
    {
      method: 'POST',
      body: form,
    }
  );

  const body = await response.json();

  if (!response.ok || !body.public_id) {
    throw new Error(
      `Cloudinary direct upload failed with status ${response.status}`
    );
  }

  return body;
};

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const product = await ProductV2Model.create({
      name: 'Phase 1H.4 Cloudinary Smoke',
      slug: `phase1h4-cloudinary-${runId}`.toLowerCase(),
      status: 'draft',
      photos: [],
      occasion: [],
      ageTags: [],
      rentalEnabled: false,
      saleEnabled: false,
      defaultDeposit: 0,
      seo: { noIndex: true },
    });

    productId = product._id;

    const signed = await service.signUpload(product._id);
    const uploaded = await directUpload(signed);
    uploadedPublicId = uploaded.public_id;

    const attached = await service.completeUpload(product._id, {
      publicId: uploadedPublicId,
    });

    if (attached.photos.length !== 1) {
      throw new Error(
        'Cloudinary smoke attach did not persist one photo'
      );
    }

    const removed = await service.removePhoto(
      product._id,
      uploadedPublicId
    );

    if (removed.photos.length !== 0) {
      throw new Error(
        'Cloudinary smoke delete did not remove DB photo'
      );
    }

    let verifyError;
    try {
      await gateway.verifyUploadedImage(uploadedPublicId);
    } catch (error) {
      verifyError = error;
    }

    if (!(verifyError instanceof ProductMediaGatewayError)) {
      throw new Error(
        'Cloudinary smoke cleanup was not confirmed'
      );
    }

    console.log('Phase 1H.4 real Cloudinary smoke test PASS');
  } finally {
    if (uploadedPublicId) {
      try {
        await gateway.destroyImage(uploadedPublicId);
      } catch (_error) {
        console.warn('Phase 1H.4 final Cloudinary cleanup failed', {
          publicId: uploadedPublicId,
        });
      }
    }

    if (productId) {
      await ProductV2Model.deleteOne({ _id: productId }).exec();
    }

    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error);

  try {
    if (uploadedPublicId) {
      await gateway.destroyImage(uploadedPublicId);
    }

    if (productId) {
      await ProductV2Model.deleteOne({ _id: productId }).exec();
    }

    await mongoose.disconnect();
  } catch (_cleanupError) {
    console.error('Phase 1H.4 smoke cleanup failed');
  }

  process.exitCode = 1;
});
