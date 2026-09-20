const mongoose = require('mongoose');
const { Types } = mongoose;

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
  const product = await ProductV2Model.create({
    name,
    slug: `${marker}-${createdIds.length}-${new Types.ObjectId()
      .toHexString()
      .slice(-6)}`,
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

  createdIds.push(product._id);
  return product;
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

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
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

    createdIds.push(activeProduct._id);

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
  } finally {
    if (createdIds.length > 0) {
      await ProductV2Model.deleteMany({
        _id: {
          $in: createdIds,
        },
      }).exec();
    }

    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error);

  try {
    if (createdIds.length > 0) {
      await ProductV2Model.deleteMany({
        _id: {
          $in: createdIds,
        },
      }).exec();
    }
    await mongoose.disconnect();
  } catch (cleanupError) {
    console.error(
      'Phase 1H.4 integration cleanup failed:',
      cleanupError
    );
  }

  process.exitCode = 1;
});
