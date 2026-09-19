const mongoose = require('mongoose');
const { Types } = mongoose;

const {
  AvailabilityBlockV2Model,
  InventoryItemV2Model,
  ProductV2Model,
  ReservationV2Model,
  VariantV2Model,
} = require('../build/v2/models');
const {
  AvailabilityService,
} = require('../build/v2/services/availability.service');
const { parseDateOnly } = require('../build/v2/utils/date-only');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  console.log('Phase 1D integration checks SKIPPED: TEST_MONGODB_URI is not set');
  process.exit(0);
}

if (process.env.MONGODB_URI && testUri === process.env.MONGODB_URI) {
  throw new Error('Refusing to run: TEST_MONGODB_URI matches MONGODB_URI');
}

const getExplicitDatabaseName = uri => {
  const parsed = new URL(uri);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
};

const databaseName = getExplicitDatabaseName(testUri);

if (
  !databaseName ||
  !/(test|testing|ci|dev)/i.test(databaseName) ||
  /(prod|production)/i.test(databaseName)
) {
  throw new Error(
    'TEST_MONGODB_URI must contain an explicit non-production database name with test/testing/ci/dev'
  );
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);

const service = new AvailabilityService();
const created = {
  products: [],
  variants: [],
  inventoryItems: [],
  reservations: [],
  blocks: [],
};

let sequence = 0;
const nextReservationNumber = () => {
  sequence += 1;
  return `AK-2026-${sequence.toString(36).toUpperCase().padStart(6, '0')}`;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
};

const createProduct = async overrides => {
  const product = await ProductV2Model.create({
    name: 'Phase 1D Test Product',
    slug: `phase-1d-${new Types.ObjectId().toString()}`,
    description: 'Disposable integration test product.',
    category: 'dress',
    gender: 'girls',
    color: 'white',
    rentalEnabled: true,
    saleEnabled: false,
    rentalPrices: { studio: 600, external: 800 },
    defaultDeposit: 1000,
    photos: [],
    status: 'active',
    seo: { noIndex: true },
    ...overrides,
  });
  created.products.push(product._id);
  return product;
};

const createVariant = async (productId, size, overrides = {}) => {
  const variant = await VariantV2Model.create({
    productId,
    size,
    status: 'active',
    sortOrder: 0,
    ...overrides,
  });
  created.variants.push(variant._id);
  return variant;
};

const createItem = async (variantId, code, overrides = {}) => {
  const item = await InventoryItemV2Model.create({
    variantId,
    internalCode: code,
    status: 'active',
    condition: 'good',
    ...overrides,
  });
  created.inventoryItems.push(item._id);
  return item;
};

const createReservation = async ({
  inventoryItemId,
  productId,
  variantId,
  startDate,
  endDate,
  status = 'confirmed',
  rentalMode = 'external',
  expiresAt = null,
}) => {
  const reservation = await ReservationV2Model.create({
    reservationNumber: nextReservationNumber(),
    customerSnapshot: {
      firstName: 'Phase',
      lastName: 'Test',
      email: `phase1d-${new Types.ObjectId().toString()}@example.test`,
      phone: '+420700000000',
    },
    items: [{
      productId,
      variantId,
      inventoryItemId,
      productNameSnapshot: 'Phase 1D Test Product',
      sizeSnapshot: '116',
      rentalPriceSnapshot: 800,
      depositSnapshot: 1000,
    }],
    rentalMode,
    startDate: parseDateOnly(startDate),
    endDate: parseDateOnly(endDate),
    status,
    expiresAt,
    subtotal: 800,
    deposit: 1000,
    totalDue: 1800,
    paymentStatus: 'unpaid',
  });
  created.reservations.push(reservation._id);
  return reservation;
};

const createBlock = async (inventoryItemId, startDate, endDate) => {
  const block = await AvailabilityBlockV2Model.create({
    inventoryItemId,
    startDate: parseDateOnly(startDate),
    endDate: parseDateOnly(endDate),
    reason: 'repair',
    createdBy: new Types.ObjectId(),
  });
  created.blocks.push(block._id);
  return block;
};

const checkCoreScenarios = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id, '116');
  const busyItem = await createItem(variant._id, `TST-${new Types.ObjectId().toString().slice(-8)}-01`);
  const freeItem = await createItem(variant._id, `TST-${new Types.ObjectId().toString().slice(-8)}-02`);

  await createReservation({
    inventoryItemId: busyItem._id,
    productId: product._id,
    variantId: variant._id,
    startDate: '2026-10-10',
    endDate: '2026-10-12',
    rentalMode: 'external',
  });

  for (const day of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) {
    assertEqual(
      await service.isInventoryItemAvailable(
        busyItem._id,
        parseDateOnly(day),
        parseDateOnly(day),
        { now }
      ),
      false,
      `${day} must conflict with reservation/buffer`
    );
  }

  assertEqual(
    await service.isInventoryItemAvailable(
      busyItem._id,
      parseDateOnly('2026-10-14'),
      parseDateOnly('2026-10-14'),
      { now }
    ),
    true,
    '14 Oct must be available after cleaning buffer'
  );

  assertEqual(
    await service.isInventoryItemAvailable(
      busyItem._id,
      parseDateOnly('2026-10-09'),
      parseDateOnly('2026-10-09'),
      { now }
    ),
    true,
    '9 Oct must be available before reservation'
  );

  const variantResult = await service.getVariantAvailability(
    variant._id,
    parseDateOnly('2026-10-11'),
    parseDateOnly('2026-10-11'),
    { now }
  );
  assertEqual(variantResult.available, true, 'one busy + one free item keeps variant available');
  assertEqual(variantResult.availableItemCount, 1, 'variant must report exactly one free physical item');

  await createBlock(freeItem._id, '2026-10-11', '2026-10-11');

  const bothBusyResult = await service.getVariantAvailability(
    variant._id,
    parseDateOnly('2026-10-11'),
    parseDateOnly('2026-10-11'),
    { now }
  );
  assertEqual(bothBusyResult.available, false, 'reservation + block must make both items unavailable');
  assertEqual(bothBusyResult.availableItemCount, 0, 'no items must remain available');
};

const checkStatusScenarios = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id, '110');

  const cases = [
    ['pending-future', 'pending', new Date('2026-10-01T12:00:01.000Z'), false],
    ['pending-boundary', 'pending', new Date('2026-10-01T12:00:00.000Z'), true],
    ['pending-expired', 'pending', new Date('2026-10-01T11:59:59.000Z'), true],
    ['confirmed', 'confirmed', null, false],
    ['prepared', 'prepared', null, false],
    ['rented', 'rented', null, false],
    ['returned', 'returned', null, false],
    ['cancelled', 'cancelled', null, true],
  ];

  for (const [label, status, expiresAt, expectedAvailable] of cases) {
    const item = await createItem(
      variant._id,
      `STS-${new Types.ObjectId().toString().slice(-8)}`
    );
    await createReservation({
      inventoryItemId: item._id,
      productId: product._id,
      variantId: variant._id,
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      status,
      expiresAt,
    });

    const available = await service.isInventoryItemAvailable(
      item._id,
      parseDateOnly('2026-11-10'),
      parseDateOnly('2026-11-10'),
      { now }
    );
    assertEqual(available, expectedAvailable, `${label} status availability`);
  }
};

const checkEligibilityAndProductScenarios = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  const activeProduct = await createProduct();
  const activeVariant = await createVariant(activeProduct._id, '104');
  const inactiveVariant = await createVariant(activeProduct._id, '110', { status: 'inactive' });
  const activeItem = await createItem(activeVariant._id, `ACT-${new Types.ObjectId().toString().slice(-8)}`);
  const maintenanceItem = await createItem(activeVariant._id, `MNT-${new Types.ObjectId().toString().slice(-8)}`, { status: 'maintenance' });
  const retiredItem = await createItem(activeVariant._id, `RET-${new Types.ObjectId().toString().slice(-8)}`, { status: 'retired' });

  assertEqual(
    await service.isInventoryItemAvailable(activeItem._id, parseDateOnly('2026-12-01'), parseDateOnly('2026-12-01'), { now }),
    true,
    'active inventory item must be candidate'
  );
  assertEqual(
    await service.isInventoryItemAvailable(maintenanceItem._id, parseDateOnly('2026-12-01'), parseDateOnly('2026-12-01'), { now }),
    false,
    'maintenance inventory item must be unavailable'
  );
  assertEqual(
    await service.isInventoryItemAvailable(retiredItem._id, parseDateOnly('2026-12-01'), parseDateOnly('2026-12-01'), { now }),
    false,
    'retired inventory item must be unavailable'
  );

  const inactiveVariantResult = await service.getVariantAvailability(
    inactiveVariant._id,
    parseDateOnly('2026-12-01'),
    parseDateOnly('2026-12-01'),
    { now }
  );
  assertEqual(inactiveVariantResult.available, false, 'inactive variant must be unavailable');

  const productResult = await service.getProductAvailability(
    activeProduct._id,
    parseDateOnly('2026-12-01'),
    parseDateOnly('2026-12-01'),
    { now }
  );
  assertEqual(productResult.available, true, 'product with an available active variant must be available');

  const inactiveProduct = await createProduct({ status: 'archived' });
  const inactiveProductResult = await service.getProductAvailability(
    inactiveProduct._id,
    parseDateOnly('2026-12-01'),
    parseDateOnly('2026-12-01'),
    { now }
  );
  assertEqual(inactiveProductResult.available, false, 'inactive product must be unavailable');

  const disabledProduct = await createProduct({ rentalEnabled: false, rentalPrices: undefined });
  const disabledProductResult = await service.getProductAvailability(
    disabledProduct._id,
    parseDateOnly('2026-12-01'),
    parseDateOnly('2026-12-01'),
    { now }
  );
  assertEqual(disabledProductResult.available, false, 'rental-disabled product must be unavailable');
};

const checkCrossModeAndBlocks = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id, '122');

  const externalReservedItem = await createItem(variant._id, `EXT-${new Types.ObjectId().toString().slice(-8)}`);
  await createReservation({
    inventoryItemId: externalReservedItem._id,
    productId: product._id,
    variantId: variant._id,
    startDate: '2027-01-10',
    endDate: '2027-01-12',
    rentalMode: 'external',
  });
  assertEqual(
    await service.isInventoryItemAvailable(
      externalReservedItem._id,
      parseDateOnly('2027-01-11'),
      parseDateOnly('2027-01-11'),
      { now }
    ),
    false,
    'external reservation must block the shared physical inventory pool'
  );

  const studioReservedItem = await createItem(variant._id, `STD-${new Types.ObjectId().toString().slice(-8)}`);
  await createReservation({
    inventoryItemId: studioReservedItem._id,
    productId: product._id,
    variantId: variant._id,
    startDate: '2027-02-10',
    endDate: '2027-02-10',
    rentalMode: 'studio',
  });
  assertEqual(
    await service.isInventoryItemAvailable(
      studioReservedItem._id,
      parseDateOnly('2027-02-10'),
      parseDateOnly('2027-02-11'),
      { now }
    ),
    false,
    'studio reservation must block external-style date requests on shared inventory'
  );

  const blockedItem = await createItem(variant._id, `BLK-${new Types.ObjectId().toString().slice(-8)}`);
  await createBlock(blockedItem._id, '2027-03-10', '2027-03-12');

  assertEqual(
    await service.isInventoryItemAvailable(blockedItem._id, parseDateOnly('2027-03-12'), parseDateOnly('2027-03-12'), { now }),
    false,
    'AvailabilityBlock inclusive end must conflict'
  );
  assertEqual(
    await service.isInventoryItemAvailable(blockedItem._id, parseDateOnly('2027-03-13'), parseDateOnly('2027-03-13'), { now }),
    true,
    'AvailabilityBlock must not add cleaning buffer'
  );
};

const cleanup = async () => {
  if (created.blocks.length) {
    await AvailabilityBlockV2Model.deleteMany({ _id: { $in: created.blocks } });
  }
  if (created.reservations.length) {
    await ReservationV2Model.deleteMany({ _id: { $in: created.reservations } });
  }
  if (created.inventoryItems.length) {
    await InventoryItemV2Model.deleteMany({ _id: { $in: created.inventoryItems } });
  }
  if (created.variants.length) {
    await VariantV2Model.deleteMany({ _id: { $in: created.variants } });
  }
  if (created.products.length) {
    await ProductV2Model.deleteMany({ _id: { $in: created.products } });
  }
};

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    await checkCoreScenarios();
    await checkStatusScenarios();
    await checkEligibilityAndProductScenarios();
    await checkCrossModeAndBlocks();

    console.log('Phase 1D availability integration checks passed');
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error);
  try {
    await cleanup();
    await mongoose.disconnect();
  } catch (cleanupError) {
    console.error('Integration cleanup failed:', cleanupError);
  }
  process.exitCode = 1;
});
