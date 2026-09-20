const { Types } = require('mongoose');

const {
  createV2Router,
} = require('../build/v2/routes');
const {
  AdminApiConfigurationError,
  adminApiConfigurationReady,
  adminApiEnabled,
  parseAdminUserIds,
} = require('../build/v2/middleware/admin.middleware');
const {
  validateCreateInventoryItemAdminBody,
  validateCreateProductAdminBody,
  validateCreateVariantAdminBody,
  validateUpdateInventoryItemAdminBody,
  validateUpdateProductAdminBody,
} = require('../build/v2/schemas/admin-catalogue.schema');
const {
  CatalogueAdminError,
} = require('../build/v2/services/catalogue-admin.types');
const {
  getProductActivationMissingRequirements,
} = require('../build/v2/services/catalogue-admin.service');
const {
  toAdminInventoryItemDto,
} = require('../build/v2/http/admin-response');
const {
  mapAdminApiError,
} = require('../build/v2/http/admin-error-mapper');
const {
  generateProductSlug,
} = require('../build/v2/utils/slug');

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

const createFakeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return body;
  },
});

const expectValidationFailure = (validator, input, label) => {
  const result = validator(input);
  assert(!result.value, `${label} must fail validation`);
  assert(result.errorMessage, `${label} must return a validation message`);
};

const checkAdminAllowlist = () => {
  const first = new Types.ObjectId().toHexString();
  const second = new Types.ObjectId().toHexString();

  const parsed = parseAdminUserIds(` ${first},${second},${first} `);

  assertEqual(parsed.size, 2, 'admin allowlist must deduplicate ids');
  assert(parsed.has(first), 'admin allowlist first id');
  assert(parsed.has(second), 'admin allowlist second id');

  for (const invalid of [undefined, '', 'not-an-object-id', `${first},bad`]) {
    let error;

    try {
      parseAdminUserIds(invalid);
    } catch (caught) {
      error = caught;
    }

    assert(
      error instanceof AdminApiConfigurationError,
      'invalid admin env must fail as configuration error'
    );
  }
};

const checkFeatureFlagAndConfiguration = () => {
  const originalFlag = process.env.V2_ADMIN_API_ENABLED;
  const originalIds = process.env.V2_ADMIN_USER_IDS;
  const originalSecret = process.env.SECRET_KEY;

  try {
    delete process.env.V2_ADMIN_API_ENABLED;

    const disabled = createFakeResponse();

    adminApiEnabled(
      { headers: {} },
      disabled,
      () => {
        throw new Error('disabled admin API must not call next');
      }
    );

    assertEqual(disabled.statusCode, 503, 'admin flag default deny status');
    assertEqual(
      disabled.body.error.code,
      'ADMIN_API_DISABLED',
      'admin flag default deny code'
    );

    process.env.V2_ADMIN_API_ENABLED = 'true';
    delete process.env.V2_ADMIN_USER_IDS;
    process.env.SECRET_KEY = 'pure-check-secret';

    const invalidConfiguration = createFakeResponse();

    adminApiConfigurationReady(
      { headers: {} },
      invalidConfiguration,
      () => {
        throw new Error('invalid admin config must not call next');
      }
    );

    assertEqual(
      invalidConfiguration.statusCode,
      503,
      'invalid admin configuration status'
    );
    assertEqual(
      invalidConfiguration.body.error.code,
      'ADMIN_API_CONFIGURATION_ERROR',
      'invalid admin configuration code'
    );
  } finally {
    if (originalFlag === undefined) {
      delete process.env.V2_ADMIN_API_ENABLED;
    } else {
      process.env.V2_ADMIN_API_ENABLED = originalFlag;
    }

    if (originalIds === undefined) {
      delete process.env.V2_ADMIN_USER_IDS;
    } else {
      process.env.V2_ADMIN_USER_IDS = originalIds;
    }

    if (originalSecret === undefined) {
      delete process.env.SECRET_KEY;
    } else {
      process.env.SECRET_KEY = originalSecret;
    }
  }
};

const checkSlugGeneration = () => {
  assertEqual(
    generateProductSlug('Dětské šaty Sofia'),
    'detske-saty-sofia',
    'Czech-aware slug'
  );
  assertEqual(
    generateProductSlug('  Žluté šaty 116  '),
    'zlute-saty-116',
    'slug whitespace and diacritics'
  );
};

const checkStrictSchemas = () => {
  assert(
    validateCreateProductAdminBody({
      name: 'Dětské šaty Sofia',
      rentalEnabled: true,
      rentalPrices: {
        studio: 0,
        external: 800,
      },
    }).value,
    'valid product draft body'
  );

  expectValidationFailure(
    validateCreateProductAdminBody,
    {
      name: 'Dětské šaty Sofia',
      status: 'active',
    },
    'product create status injection'
  );

  expectValidationFailure(
    validateCreateProductAdminBody,
    {
      name: 'Dětské šaty Sofia',
      photos: [{
        url: 'https://example.test/photo.jpg',
        publicId: 'test/photo',
      }],
    },
    'product create photos injection'
  );

  expectValidationFailure(
    validateUpdateProductAdminBody,
    {
      status: 'active',
    },
    'product patch status injection'
  );

  expectValidationFailure(
    validateUpdateProductAdminBody,
    {
      _id: new Types.ObjectId().toHexString(),
    },
    'product patch _id injection'
  );

  const grouped = validateCreateVariantAdminBody({
    size: '74-80-86',
    status: 'active',
  });

  assert(grouped.value, 'grouped size must be accepted');
  assertEqual(grouped.value.size, '74-80-86', 'grouped size preserved');

  expectValidationFailure(
    validateCreateInventoryItemAdminBody,
    {
      internalCode: 'SOF-116-01',
      status: 'maintenance',
    },
    'inventory create status injection'
  );

  expectValidationFailure(
    validateCreateInventoryItemAdminBody,
    {
      internalCode: 'SOF-116-01',
      bookingRevision: 1,
    },
    'inventory create bookingRevision injection'
  );

  for (const forbidden of [
    { status: 'maintenance' },
    { internalCode: 'NEW-CODE' },
    { bookingRevision: 5 },
    { variantId: new Types.ObjectId().toHexString() },
  ]) {
    expectValidationFailure(
      validateUpdateInventoryItemAdminBody,
      forbidden,
      `inventory patch forbidden field ${Object.keys(forbidden)[0]}`
    );
  }

  assert(
    validateUpdateInventoryItemAdminBody({
      condition: 'good',
      notes: 'Checked',
      acquiredAt: '2026-09-20T10:00:00.000Z',
    }).value,
    'allowed inventory patch'
  );
};

const checkAdminDtoBoundary = () => {
  const dto = toAdminInventoryItemDto({
    _id: new Types.ObjectId(),
    variantId: new Types.ObjectId(),
    internalCode: 'DET001',
    status: 'active',
    condition: 'good',
    bookingRevision: 99,
  });

  const serialized = JSON.stringify(dto);

  assert(
    !serialized.includes('bookingRevision'),
    'admin DTO must hide bookingRevision'
  );
  assert(
    serialized.includes('DET001'),
    'admin DTO may expose internalCode'
  );
};

const checkActivationRequirements = () => {
  const missing = getProductActivationMissingRequirements(
    {
      name: 'Dětské šaty DET001',
      slug: 'detske-saty-det001',
      category: 'dress',
      gender: 'girls',
      rentalEnabled: true,
      rentalPrices: {
        studio: 600,
        external: 800,
      },
      status: 'draft',
      photos: [],
    },
    {
      activeVariantCount: 1,
      activeInventoryCount: 0,
    }
  );

  for (const required of [
    'description',
    'color',
    'photos',
    'inventory',
  ]) {
    assert(
      missing.includes(required),
      `activation missing requirements must include ${required}`
    );
  }

  assert(
    !missing.includes('rentalPrices.studio'),
    'zero/defined pricing semantics must not be confused with missing price'
  );

  const ready = getProductActivationMissingRequirements(
    {
      name: 'Ready Dress',
      slug: 'ready-dress',
      description: 'Ready description',
      category: 'dress',
      gender: 'girls',
      color: 'ivory',
      rentalEnabled: true,
      rentalPrices: {
        studio: 0,
        external: 0,
      },
      status: 'draft',
      photos: [{
        url: 'https://example.test/photo.jpg',
        publicId: 'test/photo',
      }],
    },
    {
      activeVariantCount: 1,
      activeInventoryCount: 1,
    }
  );

  assertEqual(ready.length, 0, 'fully ready product requirements');
};

const checkErrorMapping = () => {
  const cases = [
    ['PRODUCT_NOT_FOUND', 404],
    ['VARIANT_NOT_FOUND', 404],
    ['INVENTORY_ITEM_NOT_FOUND', 404],
    ['SLUG_ALREADY_EXISTS', 409],
    ['VARIANT_SIZE_ALREADY_EXISTS', 409],
    ['SKU_ALREADY_EXISTS', 409],
    ['INVENTORY_CODE_ALREADY_EXISTS', 409],
    ['PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW', 409],
  ];

  for (const [code, status] of cases) {
    const result = mapAdminApiError(
      new CatalogueAdminError(code, 'safe')
    );

    assertEqual(result.status, status, `admin error status ${code}`);
    assertEqual(result.body.error.code, code, `admin error code ${code}`);
  }

  const notReady = mapAdminApiError(
    new CatalogueAdminError(
      'PRODUCT_NOT_READY',
      'Product is not ready for activation',
      ['photos', 'inventory']
    )
  );

  assertEqual(notReady.status, 409, 'PRODUCT_NOT_READY status');
  assertEqual(
    notReady.body.error.details.join(','),
    'photos,inventory',
    'PRODUCT_NOT_READY details'
  );

  const internal = mapAdminApiError(new Error('sensitive raw error'));

  assertEqual(internal.status, 500, 'unknown admin error status');
  assertEqual(
    internal.body.error.code,
    'INTERNAL_ERROR',
    'unknown admin error code'
  );
  assert(
    !JSON.stringify(internal.body).includes('sensitive'),
    'raw internal error must not leak'
  );
};

const checkRouteRegistration = () => {
  const registrations = [];
  const router = {
    get(path, ...handlers) {
      registrations.push({ method: 'GET', path, handlers });
      return this;
    },
    post(path, ...handlers) {
      registrations.push({ method: 'POST', path, handlers });
      return this;
    },
    patch(path, ...handlers) {
      registrations.push({ method: 'PATCH', path, handlers });
      return this;
    },
    use(...handlers) {
      registrations.push({ method: 'USE', path: null, handlers });
      return this;
    },
  };

  createV2Router(
    {
      Router: () => router,
    },
    {
      ensureMongoConnection: (_request, _response, next) => next(),
    }
  );

  const expected = [
    ['GET', '/admin/products'],
    ['GET', '/admin/products/:productId'],
    ['POST', '/admin/products'],
    ['PATCH', '/admin/products/:productId'],
    ['POST', '/admin/products/:productId/activate'],
    ['POST', '/admin/products/:productId/archive'],
    ['POST', '/admin/products/:productId/variants'],
    ['PATCH', '/admin/variants/:variantId'],
    ['POST', '/admin/variants/:variantId/inventory-items'],
    ['PATCH', '/admin/inventory-items/:inventoryItemId'],
  ];

  for (const [method, path] of expected) {
    assert(
      registrations.some(
        registration =>
          registration.method === method &&
          registration.path === path
      ),
      `admin route missing: ${method} ${path}`
    );
  }

  assert(
    registrations.some(
      registration =>
        registration.method === 'POST' &&
        registration.path === '/reservations'
    ),
    'public reservation route must remain registered'
  );
};

const main = () => {
  checkAdminAllowlist();
  checkFeatureFlagAndConfiguration();
  checkSlugGeneration();
  checkStrictSchemas();
  checkAdminDtoBoundary();
  checkActivationRequirements();
  checkErrorMapping();
  checkRouteRegistration();

  console.log('Phase 1H.3 admin API pure checks passed');
};

main();
