const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Types } = mongoose;

const {
  InventoryItemV2Model,
  ProductV2Model,
  VariantV2Model,
} = require('../build/v2/models');
const {
  createV2Router,
} = require('../build/v2/routes');

const LegacyUserModel = require('../models/user');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error(
    'TEST_MONGODB_URI is required for Phase 1H.3 admin integration checks'
  );
}

if (process.env.MONGODB_URI && testUri === process.env.MONGODB_URI) {
  throw new Error(
    'Refusing to run: TEST_MONGODB_URI matches MONGODB_URI'
  );
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

const TEST_SECRET =
  'phase-1h3-admin-integration-secret-at-least-32-bytes';
const marker = new Types.ObjectId().toHexString().slice(-10);

const originalEnvironment = {
  adminFlag: process.env.V2_ADMIN_API_ENABLED,
  adminIds: process.env.V2_ADMIN_USER_IDS,
  secret: process.env.SECRET_KEY,
  reservationFlag: process.env.V2_RESERVATION_API_ENABLED,
};

const created = {
  users: [],
  products: [],
  variants: [],
  inventory: [],
};

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

const restoreEnvironment = () => {
  const restore = (name, value) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  restore('V2_ADMIN_API_ENABLED', originalEnvironment.adminFlag);
  restore('V2_ADMIN_USER_IDS', originalEnvironment.adminIds);
  restore('SECRET_KEY', originalEnvironment.secret);
  restore(
    'V2_RESERVATION_API_ENABLED',
    originalEnvironment.reservationFlag
  );
};

const ensureTestIndexes = async () => {
  const db = mongoose.connection.db;

  await db.collection('v2_products').createIndex(
    { slug: 1 },
    {
      unique: true,
      name: 'uniq_v2_product_slug',
    }
  );

  await db.collection('v2_variants').createIndex(
    { productId: 1, size: 1 },
    {
      unique: true,
      name: 'uniq_v2_variant_product_size',
    }
  );

  await db.collection('v2_variants').createIndex(
    { sku: 1 },
    {
      unique: true,
      name: 'uniq_v2_variant_sku',
      partialFilterExpression: {
        sku: { $exists: true },
      },
    }
  );

  await db.collection('v2_inventory_items').createIndex(
    { internalCode: 1 },
    {
      unique: true,
      name: 'uniq_v2_inventory_internal_code',
    }
  );

  await db.collection('v2_inventory_items').createIndex(
    { variantId: 1, status: 1 },
    {
      name: 'idx_v2_inventory_variant_status',
    }
  );
};

const createLegacyUser = async label => {
  const _id = new Types.ObjectId();
  const token = jwt.sign(
    {
      id: _id.toHexString(),
    },
    TEST_SECRET
  );

  const user = await LegacyUserModel.create({
    _id,
    email: `phase1h3-${label}-${marker}@example.test`,
    provider: 'Google',
    tokens: [
      {
        token,
        device: {
          test: true,
        },
      },
    ],
  });

  created.users.push(user._id);

  return {
    id: user._id,
    token,
  };
};

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v2',
    createV2Router(express, {
      ensureMongoConnection: (_request, _response, next) => next(),
    })
  );

  return app;
};

const startServer = app =>
  new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () =>
      resolve(server)
    );
  });

const closeServer = server =>
  new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const sendJson = (
  server,
  method,
  path,
  {
    token,
    body,
  } = {}
) =>
  new Promise((resolve, reject) => {
    const address = server.address();

    if (!address || typeof address === 'string') {
      reject(new Error('Test server did not expose a TCP address'));
      return;
    }

    const payload =
      body === undefined ? undefined : JSON.stringify(body);

    const headers = {};

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }

    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers,
      },
      response => {
        let data = '';

        response.setEncoding('utf8');
        response.on('data', chunk => {
          data += chunk;
        });
        response.on('end', () => {
          let parsed;

          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch (_error) {
            reject(
              new Error(
                `Unable to parse admin API response: ${data}`
              )
            );
            return;
          }

          resolve({
            status: response.statusCode,
            body: parsed,
          });
        });
      }
    );

    request.on('error', reject);

    if (payload !== undefined) {
      request.write(payload);
    }

    request.end();
  });

const rememberProduct = response => {
  const id = response?.body?.product?.id;

  if (id && Types.ObjectId.isValid(id)) {
    const value = new Types.ObjectId(id);

    if (!created.products.some(item => item.equals(value))) {
      created.products.push(value);
    }
  }
};

const rememberVariant = response => {
  const id = response?.body?.variant?.id;

  if (id && Types.ObjectId.isValid(id)) {
    const value = new Types.ObjectId(id);

    if (!created.variants.some(item => item.equals(value))) {
      created.variants.push(value);
    }
  }
};

const rememberInventory = response => {
  const id = response?.body?.inventoryItem?.id;

  if (id && Types.ObjectId.isValid(id)) {
    const value = new Types.ObjectId(id);

    if (!created.inventory.some(item => item.equals(value))) {
      created.inventory.push(value);
    }
  }
};

const cleanup = async () => {
  if (created.inventory.length > 0) {
    await InventoryItemV2Model.deleteMany({
      _id: {
        $in: created.inventory,
      },
    });
  }

  if (created.variants.length > 0) {
    await VariantV2Model.deleteMany({
      _id: {
        $in: created.variants,
      },
    });
  }

  if (created.products.length > 0) {
    await ProductV2Model.deleteMany({
      _id: {
        $in: created.products,
      },
    });
  }

  if (created.users.length > 0) {
    await LegacyUserModel.deleteMany({
      _id: {
        $in: created.users,
      },
    });
  }
};

const createAdminProduct = async (
  server,
  token,
  body
) => {
  const response = await sendJson(
    server,
    'POST',
    '/api/v2/admin/products',
    {
      token,
      body,
    }
  );

  rememberProduct(response);
  return response;
};

const checkAuthentication = async (
  server,
  admin,
  nonAdmin
) => {
  const unauthenticated = await sendJson(
    server,
    'GET',
    '/api/v2/admin/products'
  );

  assertEqual(
    unauthenticated.status,
    401,
    'A unauthenticated status'
  );
  assertEqual(
    unauthenticated.body.error.code,
    'ADMIN_UNAUTHORIZED',
    'A unauthenticated code'
  );

  const forbidden = await sendJson(
    server,
    'GET',
    '/api/v2/admin/products',
    {
      token: nonAdmin.token,
    }
  );

  assertEqual(
    forbidden.status,
    403,
    'B non-admin status'
  );
  assertEqual(
    forbidden.body.error.code,
    'ADMIN_FORBIDDEN',
    'B non-admin code'
  );

  const allowed = await sendJson(
    server,
    'GET',
    '/api/v2/admin/products?page=1&limit=5',
    {
      token: admin.token,
    }
  );

  assertEqual(allowed.status, 200, 'C admin access status');
  assert(
    Array.isArray(allowed.body.items),
    'C admin product list items'
  );
};

const checkProductFlow = async (
  server,
  admin
) => {
  const injectedActive = await sendJson(
    server,
    'POST',
    '/api/v2/admin/products',
    {
      token: admin.token,
      body: {
        name: 'Injected Active Dress',
        status: 'active',
      },
    }
  );

  assertEqual(
    injectedActive.status,
    400,
    'D create active injection status'
  );
  assertEqual(
    injectedActive.body.error.code,
    'VALIDATION_ERROR',
    'D create active injection code'
  );

  const slugName = `Dětské šaty Sofia ${marker}`;

  const createdProduct = await createAdminProduct(
    server,
    admin.token,
    {
      name: slugName,
      rentalEnabled: true,
      rentalPrices: {
        studio: 0,
        external: 800,
      },
      defaultDeposit: 0,
    }
  );

  assertEqual(
    createdProduct.status,
    201,
    'D create draft Product status'
  );
  assertEqual(
    createdProduct.body.product.status,
    'draft',
    'D Product must be draft'
  );

  const expectedSlug =
    `detske-saty-sofia-${marker}`;

  assertEqual(
    createdProduct.body.product.slug,
    expectedSlug,
    'E generated slug'
  );

  const duplicateSlug = await createAdminProduct(
    server,
    admin.token,
    {
      name: 'Another dress',
      slug: expectedSlug,
    }
  );

  assertEqual(
    duplicateSlug.status,
    409,
    'F duplicate slug status'
  );
  assertEqual(
    duplicateSlug.body.error.code,
    'SLUG_ALREADY_EXISTS',
    'F duplicate slug code'
  );

  const productId = createdProduct.body.product.id;

  const updated = await sendJson(
    server,
    'PATCH',
    `/api/v2/admin/products/${productId}`,
    {
      token: admin.token,
      body: {
        description: 'Integration test description',
        category: 'dress',
        gender: 'girls',
        color: 'ivory',
        brand: 'Integration Brand',
      },
    }
  );

  assertEqual(updated.status, 200, 'G update Product status');
  assertEqual(
    updated.body.product.color,
    'ivory',
    'G Product allowed field'
  );

  const statusPatch = await sendJson(
    server,
    'PATCH',
    `/api/v2/admin/products/${productId}`,
    {
      token: admin.token,
      body: {
        status: 'active',
      },
    }
  );

  assertEqual(statusPatch.status, 400, 'H status patch');
  assertEqual(
    statusPatch.body.error.code,
    'VALIDATION_ERROR',
    'H status patch code'
  );

  return {
    productId,
    slug: expectedSlug,
  };
};

const checkVariantAndInventoryFlow = async (
  server,
  admin,
  productId
) => {
  const variant = await sendJson(
    server,
    'POST',
    `/api/v2/admin/products/${productId}/variants`,
    {
      token: admin.token,
      body: {
        size: '74-80-86',
      },
    }
  );

  rememberVariant(variant);

  assertEqual(variant.status, 201, 'I grouped Variant status');
  assertEqual(
    variant.body.variant.size,
    '74-80-86',
    'I grouped Variant size'
  );

  const duplicateSize = await sendJson(
    server,
    'POST',
    `/api/v2/admin/products/${productId}/variants`,
    {
      token: admin.token,
      body: {
        size: '74-80-86',
      },
    }
  );

  assertEqual(
    duplicateSize.status,
    409,
    'J duplicate Product+size status'
  );
  assertEqual(
    duplicateSize.body.error.code,
    'VARIANT_SIZE_ALREADY_EXISTS',
    'J duplicate Product+size code'
  );

  const variantId = variant.body.variant.id;
  const internalCode = `H3-${marker.toUpperCase()}-01`;

  const inventory = await sendJson(
    server,
    'POST',
    `/api/v2/admin/variants/${variantId}/inventory-items`,
    {
      token: admin.token,
      body: {
        internalCode,
        condition: 'good',
        notes: 'Initial integration note',
      },
    }
  );

  rememberInventory(inventory);

  assertEqual(inventory.status, 201, 'K inventory create status');
  assertEqual(
    inventory.body.inventoryItem.internalCode,
    internalCode,
    'K normalized inventory code'
  );
  assertEqual(
    inventory.body.inventoryItem.status,
    'active',
    'K inventory status'
  );

  const duplicateCode = await sendJson(
    server,
    'POST',
    `/api/v2/admin/variants/${variantId}/inventory-items`,
    {
      token: admin.token,
      body: {
        internalCode,
      },
    }
  );

  assertEqual(
    duplicateCode.status,
    409,
    'L duplicate internalCode status'
  );
  assertEqual(
    duplicateCode.body.error.code,
    'INVENTORY_CODE_ALREADY_EXISTS',
    'L duplicate internalCode code'
  );

  const inventoryId = inventory.body.inventoryItem.id;

  const patch = await sendJson(
    server,
    'PATCH',
    `/api/v2/admin/inventory-items/${inventoryId}`,
    {
      token: admin.token,
      body: {
        condition: 'excellent',
        notes: 'Checked and ready',
      },
    }
  );

  assertEqual(patch.status, 200, 'M inventory patch status');
  assertEqual(
    patch.body.inventoryItem.condition,
    'excellent',
    'M inventory condition'
  );
  assertEqual(
    patch.body.inventoryItem.notes,
    'Checked and ready',
    'M inventory notes'
  );

  for (const forbiddenBody of [
    { status: 'maintenance' },
    { internalCode: 'CHANGED-CODE' },
    { bookingRevision: 9 },
  ]) {
    const forbidden = await sendJson(
      server,
      'PATCH',
      `/api/v2/admin/inventory-items/${inventoryId}`,
      {
        token: admin.token,
        body: forbiddenBody,
      }
    );

    assertEqual(
      forbidden.status,
      400,
      `N forbidden inventory patch ${Object.keys(forbiddenBody)[0]}`
    );
    assertEqual(
      forbidden.body.error.code,
      'VALIDATION_ERROR',
      'N forbidden inventory patch code'
    );
  }

  return {
    variantId,
    inventoryId,
  };
};

const checkActivation = async (
  server,
  admin,
  productId
) => {
  const incomplete = await createAdminProduct(
    server,
    admin.token,
    {
      name: `Incomplete Dress ${marker}`,
      slug: `phase1h3-incomplete-${marker}`,
      rentalEnabled: true,
      rentalPrices: {
        studio: 500,
        external: 700,
      },
    }
  );

  assertEqual(incomplete.status, 201, 'O incomplete Product create');

  const incompleteActivation = await sendJson(
    server,
    'POST',
    `/api/v2/admin/products/${incomplete.body.product.id}/activate`,
    {
      token: admin.token,
    }
  );

  assertEqual(
    incompleteActivation.status,
    409,
    'O incomplete activation status'
  );
  assertEqual(
    incompleteActivation.body.error.code,
    'PRODUCT_NOT_READY',
    'O incomplete activation code'
  );
  assert(
    Array.isArray(incompleteActivation.body.error.details),
    'O activation missing details'
  );

  for (const field of [
    'description',
    'category',
    'gender',
    'color',
    'photos',
    'variants',
    'inventory',
  ]) {
    assert(
      incompleteActivation.body.error.details.includes(field),
      `O missing activation field ${field}`
    );
  }

  const ready = await createAdminProduct(
    server,
    admin.token,
    {
      name: `Ready Dress ${marker}`,
      slug: `phase1h3-ready-${marker}`,
      description: 'Ready product description',
      category: 'dress',
      gender: 'girls',
      color: 'ivory',
      rentalEnabled: true,
      rentalPrices: {
        studio: 600,
        external: 800,
      },
      defaultDeposit: 0,
    }
  );

  assertEqual(ready.status, 201, 'P ready Product create');
  const readyProductId = new Types.ObjectId(
    ready.body.product.id
  );

  await ProductV2Model.updateOne(
    {
      _id: readyProductId,
    },
    {
      $set: {
        photos: [
          {
            url: 'https://example.test/photo.jpg',
            publicId: 'test/photo',
          },
        ],
      },
    }
  ).exec();

  const readyVariant = await sendJson(
    server,
    'POST',
    `/api/v2/admin/products/${readyProductId.toHexString()}/variants`,
    {
      token: admin.token,
      body: {
        size: '116',
      },
    }
  );

  rememberVariant(readyVariant);
  assertEqual(readyVariant.status, 201, 'P ready Variant create');

  const readyInventory = await sendJson(
    server,
    'POST',
    `/api/v2/admin/variants/${readyVariant.body.variant.id}/inventory-items`,
    {
      token: admin.token,
      body: {
        internalCode: `H3-${marker.toUpperCase()}-READY`,
        condition: 'good',
      },
    }
  );

  rememberInventory(readyInventory);
  assertEqual(readyInventory.status, 201, 'P ready inventory create');

  const activation = await sendJson(
    server,
    'POST',
    `/api/v2/admin/products/${readyProductId.toHexString()}/activate`,
    {
      token: admin.token,
    }
  );

  assertEqual(activation.status, 200, 'P activation status');
  assertEqual(
    activation.body.product.status,
    'active',
    'Q activation Product status'
  );
  assertEqual(
    activation.body.product.seo.noIndex,
    false,
    'Q activation seo.noIndex'
  );

  const draftArchive = await createAdminProduct(
    server,
    admin.token,
    {
      name: `Archive Dress ${marker}`,
      slug: `phase1h3-archive-${marker}`,
    }
  );

  assertEqual(draftArchive.status, 201, 'R archive fixture create');

  const archived = await sendJson(
    server,
    'POST',
    `/api/v2/admin/products/${draftArchive.body.product.id}/archive`,
    {
      token: admin.token,
    }
  );

  assertEqual(archived.status, 200, 'R archive status');
  assertEqual(
    archived.body.product.status,
    'archived',
    'R archived Product status'
  );
  assertEqual(
    archived.body.product.seo.noIndex,
    true,
    'R archive noIndex'
  );

  const activeArchive = await sendJson(
    server,
    'POST',
    `/api/v2/admin/products/${readyProductId.toHexString()}/archive`,
    {
      token: admin.token,
    }
  );

  assertEqual(
    activeArchive.status,
    409,
    'R active archive conservative status'
  );
  assertEqual(
    activeArchive.body.error.code,
    'PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW',
    'R active archive code'
  );

  return {
    readyProductId: readyProductId.toHexString(),
  };
};

const checkAdminDetail = async (
  server,
  admin,
  productId
) => {
  const detail = await sendJson(
    server,
    'GET',
    `/api/v2/admin/products/${productId}`,
    {
      token: admin.token,
    }
  );

  assertEqual(detail.status, 200, 'S admin detail status');
  assert(
    Array.isArray(detail.body.variants),
    'S admin detail variants'
  );
  assert(
    detail.body.variants.some(
      variant =>
        Array.isArray(variant.inventory) &&
        variant.inventory.length > 0
    ),
    'S admin detail inventory'
  );

  const serialized = JSON.stringify(detail.body);

  assert(
    !serialized.includes('bookingRevision'),
    'S admin detail must hide bookingRevision'
  );
};

const main = async () => {
  let server;

  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    await ensureTestIndexes();

    process.env.SECRET_KEY = TEST_SECRET;
    process.env.V2_ADMIN_API_ENABLED = 'true';
    process.env.V2_RESERVATION_API_ENABLED = 'false';

    const admin = await createLegacyUser('admin');
    const nonAdmin = await createLegacyUser('non-admin');

    process.env.V2_ADMIN_USER_IDS =
      admin.id.toHexString();

    server = await startServer(createTestApp());

    await checkAuthentication(server, admin, nonAdmin);

    const primary = await checkProductFlow(server, admin);

    await checkVariantAndInventoryFlow(
      server,
      admin,
      primary.productId
    );

    const activation = await checkActivation(
      server,
      admin,
      primary.productId
    );

    await checkAdminDetail(
      server,
      admin,
      activation.readyProductId
    );

    assertEqual(
      process.env.V2_RESERVATION_API_ENABLED,
      'false',
      'reservation feature flag must remain disabled in suite'
    );

    console.log(
      'Phase 1H.3 admin API integration checks passed: A-S'
    );
  } finally {
    if (server) {
      await closeServer(server);
    }

    await cleanup();
    await mongoose.disconnect();
    restoreEnvironment();
  }
};

main().catch(async error => {
  console.error(error);

  try {
    await cleanup();
    await mongoose.disconnect();
  } catch (cleanupError) {
    console.error(
      'Phase 1H.3 cleanup failed:',
      cleanupError
    );
  }

  restoreEnvironment();
  process.exitCode = 1;
});
