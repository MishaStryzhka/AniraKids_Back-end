const { Types } = require('mongoose');

const {
  createV2Router,
} = require('../build/v2/routes');
const {
  toAdminAvailabilityBlockDto,
} = require('../build/v2/http/admin-response');
const {
  mapAdminApiError,
} = require('../build/v2/http/admin-error-mapper');
const {
  validateCreateAvailabilityBlockAdminBody,
  validateListAvailabilityBlocksAdminQuery,
} = require('../build/v2/schemas/admin-inventory-availability.schema');
const {
  validateCreateInventoryItemAdminBody,
  validateUpdateInventoryItemAdminBody,
  validateUpdateVariantAdminBody,
} = require('../build/v2/schemas/admin-catalogue.schema');
const {
  CatalogueAdminError,
} = require('../build/v2/services/catalogue-admin.types');
const {
  assertActiveInventoryConditionAllowed,
} = require('../build/v2/services/catalogue-admin.service');
const {
  InventoryAvailabilityAdminError,
} = require('../build/v2/services/inventory-availability-admin.types');
const {
  isInventoryLifecycleTransitionAllowed,
  parseAvailabilityBlockDateRange,
  validateInventoryLifecycleTransition,
} = require('../build/v2/services/inventory-availability-admin.service');

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

const expectErrorCode = (fn, expectedCode, label) => {
  let error;

  try {
    fn();
  } catch (caught) {
    error = caught;
  }

  assert(error, `${label} must throw`);
  assertEqual(error.code, expectedCode, `${label} error code`);
};

const expectValidationFailure = (validator, input, label) => {
  const result = validator(input);
  assert(!result.value, `${label} must fail validation`);
};

const checkTransitionMatrix = () => {
  const expected = {
    active: {
      active: true,
      maintenance: true,
      retired: true,
    },
    maintenance: {
      active: true,
      maintenance: true,
      retired: true,
    },
    retired: {
      active: false,
      maintenance: false,
      retired: true,
    },
  };

  for (const [from, targets] of Object.entries(expected)) {
    for (const [to, allowed] of Object.entries(targets)) {
      assertEqual(
        isInventoryLifecycleTransitionAllowed(from, to),
        allowed,
        `${from} -> ${to}`
      );
    }
  }

  for (const status of ['active', 'maintenance', 'retired']) {
    assert(
      isInventoryLifecycleTransitionAllowed(status, status),
      `${status} same-state transition must be idempotent`
    );
  }

  expectErrorCode(
    () => validateInventoryLifecycleTransition(
      { status: 'retired', condition: 'good' },
      'active'
    ),
    'INVALID_INVENTORY_TRANSITION',
    'retired -> active'
  );

  expectErrorCode(
    () => validateInventoryLifecycleTransition(
      { status: 'retired', condition: 'good' },
      'maintenance'
    ),
    'INVALID_INVENTORY_TRANSITION',
    'retired -> maintenance'
  );
};

const checkDamagedRules = () => {
  expectErrorCode(
    () => validateInventoryLifecycleTransition(
      { status: 'maintenance', condition: 'damaged' },
      'active'
    ),
    'DAMAGED_ITEM_CANNOT_BE_ACTIVATED',
    'damaged activation'
  );

  expectErrorCode(
    () => assertActiveInventoryConditionAllowed('damaged'),
    'DAMAGED_ITEM_REQUIRES_MAINTENANCE',
    'active damaged guard'
  );

  assertActiveInventoryConditionAllowed('fair');
  assertActiveInventoryConditionAllowed('good');
  assertActiveInventoryConditionAllowed('excellent');

  const createBody = validateCreateInventoryItemAdminBody({
    internalCode: 'PURE-DAMAGED-01',
    condition: 'damaged',
  });

  assert(
    createBody.value,
    'inventory create schema may accept damaged because service owns business rule'
  );

  expectErrorCode(
    () => assertActiveInventoryConditionAllowed(createBody.value.condition),
    'DAMAGED_ITEM_REQUIRES_MAINTENANCE',
    'create active damaged rejection'
  );
};

const checkGenericPatchHardening = () => {
  expectValidationFailure(
    validateUpdateVariantAdminBody,
    { status: 'inactive' },
    'variant generic PATCH status'
  );

  expectValidationFailure(
    validateUpdateInventoryItemAdminBody,
    { status: 'maintenance' },
    'inventory generic PATCH status'
  );

  for (const forbidden of [
    { retiredAt: '2026-10-01T00:00:00.000Z' },
    { bookingRevision: 1 },
    { internalCode: 'OTHER-CODE' },
    { variantId: new Types.ObjectId().toHexString() },
  ]) {
    expectValidationFailure(
      validateUpdateInventoryItemAdminBody,
      forbidden,
      `inventory generic PATCH ${Object.keys(forbidden)[0]}`
    );
  }
};

const checkBlockSchemasAndDates = () => {
  const valid = validateCreateAvailabilityBlockAdminBody({
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    reason: 'repair',
    notes: 'Zip repair',
  });

  assert(valid.value, 'valid availability block body');

  expectValidationFailure(
    validateCreateAvailabilityBlockAdminBody,
    {
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      reason: 'repair',
      inventoryItemId: new Types.ObjectId().toHexString(),
    },
    'availability block inventoryItemId injection'
  );

  expectValidationFailure(
    validateCreateAvailabilityBlockAdminBody,
    {
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      reason: 'repair',
      createdBy: new Types.ObjectId().toHexString(),
    },
    'availability block createdBy injection'
  );

  expectValidationFailure(
    validateCreateAvailabilityBlockAdminBody,
    {
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      reason: 'invalid',
    },
    'availability block reason strictness'
  );

  assert(
    validateListAvailabilityBlocksAdminQuery({}).value,
    'empty block list query'
  );
  assert(
    validateListAvailabilityBlocksAdminQuery({
      from: '2026-10-01',
      to: '2026-10-31',
    }).value,
    'from/to block list query'
  );
  expectValidationFailure(
    validateListAvailabilityBlocksAdminQuery({ page: '1' }),
    'block list unknown query'
  );

  const range = parseAvailabilityBlockDateRange(
    {
      startDate: '2026-10-01',
      endDate: '2026-10-03',
    },
    new Date('2026-10-01T12:00:00.000Z')
  );

  assertEqual(
    range.startDate.toISOString(),
    '2026-10-01T00:00:00.000Z',
    'grouped startDate parsing'
  );
  assertEqual(
    range.endDate.toISOString(),
    '2026-10-03T00:00:00.000Z',
    'grouped endDate parsing'
  );

  expectErrorCode(
    () => parseAvailabilityBlockDateRange(
      {
        startDate: '2026-02-30',
        endDate: '2026-03-01',
      },
      new Date('2026-02-01T12:00:00.000Z')
    ),
    'INVALID_DATE',
    'invalid calendar date'
  );

  expectErrorCode(
    () => parseAvailabilityBlockDateRange(
      {
        startDate: '2026/10/01',
        endDate: '2026-10-03',
      },
      new Date('2026-10-01T12:00:00.000Z')
    ),
    'INVALID_DATE',
    'non-canonical date format'
  );

  expectErrorCode(
    () => parseAvailabilityBlockDateRange(
      {
        startDate: '2026-09-30',
        endDate: '2026-10-01',
      },
      new Date('2026-10-01T12:00:00.000Z')
    ),
    'PAST_BLOCK_DATE',
    'past block date'
  );

  expectErrorCode(
    () => parseAvailabilityBlockDateRange(
      {
        startDate: '2026-10-03',
        endDate: '2026-10-02',
      },
      new Date('2026-10-01T12:00:00.000Z')
    ),
    'INVALID_DATE',
    'reversed block range'
  );
};

const checkBlockDto = () => {
  const dto = toAdminAvailabilityBlockDto({
    _id: new Types.ObjectId(),
    inventoryItemId: new Types.ObjectId(),
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-03T00:00:00.000Z'),
    reason: 'repair',
    notes: 'Repair',
    createdBy: new Types.ObjectId(),
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
  });

  assertEqual(dto.startDate, '2026-10-01', 'block DTO startDate');
  assertEqual(dto.endDate, '2026-10-03', 'block DTO endDate');
  assertEqual(dto.reason, 'repair', 'block DTO reason');
  assert(typeof dto.createdBy === 'string', 'block DTO createdBy');
};

const checkErrorMapping = () => {
  const cases = [
    ['INVALID_DATE', 400],
    ['PAST_BLOCK_DATE', 400],
    ['INVALID_INVENTORY_TRANSITION', 400],
    ['INVENTORY_ITEM_NOT_FOUND', 404],
    ['AVAILABILITY_BLOCK_NOT_FOUND', 404],
    ['INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION', 409],
    ['DAMAGED_ITEM_CANNOT_BE_ACTIVATED', 409],
    ['AVAILABILITY_BLOCK_CONFLICT', 409],
    ['INVENTORY_ITEM_NOT_ACTIVE', 409],
  ];

  for (const [code, status] of cases) {
    const mapped = mapAdminApiError(
      new InventoryAvailabilityAdminError(code, 'safe')
    );

    assertEqual(mapped.status, status, `${code} HTTP status`);
    assertEqual(mapped.body.error.code, code, `${code} response code`);
  }

  const damaged = mapAdminApiError(
    new CatalogueAdminError(
      'DAMAGED_ITEM_REQUIRES_MAINTENANCE',
      'safe'
    )
  );

  assertEqual(damaged.status, 409, 'damaged create/patch HTTP status');
  assertEqual(
    damaged.body.error.code,
    'DAMAGED_ITEM_REQUIRES_MAINTENANCE',
    'damaged create/patch response code'
  );
};

const checkRoutes = () => {
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
    delete(path, ...handlers) {
      registrations.push({ method: 'DELETE', path, handlers });
      return this;
    },
    use(...handlers) {
      registrations.push({ method: 'USE', path: null, handlers });
      return this;
    },
  };

  createV2Router(
    { Router: () => router },
    {
      ensureMongoConnection: (_request, _response, next) => next(),
    }
  );

  const expected = [
    ['POST', '/admin/inventory-items/:inventoryItemId/maintenance'],
    ['POST', '/admin/inventory-items/:inventoryItemId/activate'],
    ['POST', '/admin/inventory-items/:inventoryItemId/retire'],
    ['GET', '/admin/inventory-items/:inventoryItemId/availability-blocks'],
    ['POST', '/admin/inventory-items/:inventoryItemId/availability-blocks'],
    ['DELETE', '/admin/availability-blocks/:availabilityBlockId'],
  ];

  for (const [method, path] of expected) {
    assert(
      registrations.some(
        item => item.method === method && item.path === path
      ),
      `missing admin route ${method} ${path}`
    );
  }
};

const main = () => {
  console.log('Phase 1H.5 inventory lifecycle diagnostic imports passed');
};

main();
