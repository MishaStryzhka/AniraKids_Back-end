const mongoose = require('mongoose');
const { Types } = mongoose;

const {
  InventoryItemV2Model,
  ProductV2Model,
  ReservationV2Model,
  VariantV2Model,
} = require('../build/v2/models');
const {
  ReservationServiceError,
} = require('../build/v2/services/reservation.types');
const {
  reservationService,
} = require('../build/v2/services/reservation.service');
const {
  calculateRentalDays,
  parseDateOnly,
} = require('../build/v2/utils/date-only');
const {
  hashGuestAccessToken,
} = require('../build/v2/utils/reservation');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error(
    'TEST_MONGODB_URI is required for Phase 1F reservation service integration checks'
  );
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

const created = {
  products: [],
  variants: [],
  inventoryItems: [],
  reservations: [],
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

const assertServiceError = async (operation, code, message) => {
  let caught;

  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof ReservationServiceError, `${message}: expected ReservationServiceError`);
  assertEqual(caught.code, code, `${message}: service error code`);
};

const createProduct = async (overrides = {}) => {
  const product = await ProductV2Model.create({
    name: 'Phase 1F Test Dress',
    slug: `phase-1f-${new Types.ObjectId().toString()}`,
    description: 'Disposable Phase 1F integration test product.',
    category: 'dress',
    gender: 'girls',
    color: 'white',
    rentalEnabled: true,
    saleEnabled: false,
    rentalPrices: {
      studio: 600,
      external: 800,
    },
    defaultDeposit: 1000,
    photos: [],
    status: 'active',
    seo: {
      noIndex: true,
    },
    ...overrides,
  });

  created.products.push(product._id);
  return product;
};

const createVariant = async (productId, overrides = {}) => {
  const variant = await VariantV2Model.create({
    productId,
    size: `S-${new Types.ObjectId().toString().slice(-6)}`,
    status: 'active',
    sortOrder: 0,
    ...overrides,
  });

  created.variants.push(variant._id);
  return variant;
};

const createItem = async (variantId, prefix = 'RSV', overrides = {}) => {
  const item = await InventoryItemV2Model.create({
    variantId,
    internalCode: `${prefix}-${new Types.ObjectId().toString().slice(-10)}`,
    status: 'active',
    condition: 'good',
    ...overrides,
  });

  created.inventoryItems.push(item._id);
  return item;
};

const trackResult = result => {
  created.reservations.push(result.reservation._id);
  return result;
};

const createExistingReservation = async ({
  product,
  variant,
  item,
  startDate,
  endDate,
  rentalMode = 'external',
  status = 'confirmed',
  expiresAt = null,
}) => {
  const reservation = await ReservationV2Model.create({
    reservationNumber: `AK-2026-${new Types.ObjectId().toString().slice(-6).toUpperCase()}`,
    customerSnapshot: {
      firstName: 'Existing',
      lastName: 'Booking',
      email: `existing-${new Types.ObjectId().toString()}@example.test`,
      phone: '+420700000001',
    },
    items: [{
      productId: product._id,
      variantId: variant._id,
      inventoryItemId: item._id,
      productNameSnapshot: product.name,
      sizeSnapshot: variant.size,
      rentalPriceSnapshot: rentalMode === 'studio' ? 600 : 800,
      depositSnapshot: 1000,
    }],
    rentalMode,
    startDate: parseDateOnly(startDate),
    endDate: parseDateOnly(endDate),
    status,
    expiresAt,
    subtotal: rentalMode === 'studio' ? 600 : 800,
    deposit: 1000,
    totalDue: (rentalMode === 'studio' ? 600 : 800) + 1000,
    paymentStatus: 'unpaid',
  });

  created.reservations.push(reservation._id);
  return reservation;
};

const baseCommand = ({
  product,
  variant,
  rentalMode = 'external',
  startDate = '2026-10-10',
  endDate = '2026-10-12',
  customerId,
  notes,
}) => ({
  productId: product._id,
  variantId: variant._id,
  rentalMode,
  startDate,
  endDate,
  customerId,
  customer: {
    firstName: '  Anna ',
    lastName: ' Nováková ',
    email: ' ANNA@EXAMPLE.CZ ',
    phone: ' +420 777 123 456 ',
  },
  notes,
});

const loadStoredReservation = async id => {
  const reservation = await ReservationV2Model.findById(id)
    .select('+guestAccessTokenHash')
    .exec();

  assert(reservation, 'stored Reservation must exist');
  return reservation;
};

const checkBasicGuestAndFlatPricing = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id, { size: '116' });
  const item = await createItem(variant._id, 'BASIC');

  const result = trackResult(
    await reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2026-10-10',
        endDate: '2026-10-12',
        notes: '  Prosím zavolat.  ',
      }),
      { now }
    )
  );

  const stored = await loadStoredReservation(result.reservation._id);

  assertEqual(stored.status, 'pending', 'guest status');
  assertEqual(stored.paymentStatus, 'unpaid', 'guest payment status');
  assertEqual(
    stored.expiresAt.getTime(),
    now.getTime() + 24 * 60 * 60 * 1000,
    'guest pending expiry'
  );
  assertEqual(stored.items[0].inventoryItemId.toString(), item._id.toString(), 'assigned physical item');
  assertEqual(stored.items[0].productNameSnapshot, product.name, 'product name snapshot');
  assertEqual(stored.items[0].sizeSnapshot, variant.size, 'size snapshot');
  assertEqual(stored.items[0].rentalPriceSnapshot, 800, 'rental price snapshot');
  assertEqual(stored.items[0].depositSnapshot, 1000, 'deposit snapshot');
  assertEqual(stored.subtotal, 800, 'flat subtotal');
  assertEqual(stored.deposit, 1000, 'deposit total');
  assertEqual(stored.totalDue, 1800, 'totalDue');
  assertEqual(
    calculateRentalDays(stored.startDate, stored.endDate),
    3,
    '10-12 Oct informational rental days'
  );
  assertEqual(stored.subtotal, 800, 'three rental days must not multiply flat price');
  assert(result.guestAccessToken, 'guest raw access token must be returned');
  assert(stored.guestAccessTokenHash, 'guest token hash must be stored');
  assert(
    stored.guestAccessTokenHash !== result.guestAccessToken,
    'raw guest token must not be stored as hash'
  );
  assertEqual(
    stored.guestAccessTokenHash,
    hashGuestAccessToken(result.guestAccessToken),
    'stored guest hash must match returned raw token'
  );
  assert(
    !JSON.stringify(stored.toObject()).includes(result.guestAccessToken),
    'raw guest token must not appear in stored Reservation'
  );
  assert(
    !Object.prototype.hasOwnProperty.call(result.reservation, 'guestAccessTokenHash'),
    'service result must not expose guestAccessTokenHash'
  );
  assertEqual(stored.customerSnapshot.firstName, 'Anna', 'firstName normalization in DB');
  assertEqual(stored.customerSnapshot.lastName, 'Nováková', 'lastName normalization in DB');
  assertEqual(stored.customerSnapshot.email, 'anna@example.cz', 'email normalization in DB');
  assertEqual(stored.customerSnapshot.phone, '+420 777 123 456', 'phone normalization in DB');
  assertEqual(stored.notes, 'Prosím zavolat.', 'notes normalization in DB');
  assertEqual(stored.fulfillmentMethod, 'pickup', 'external fulfillment must be pickup');
};

const checkPricingOverrides = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  const productOverride = await createProduct();
  const variantOverride = await createVariant(productOverride._id, {
    rentalPriceOverrides: { external: 950 },
  });
  await createItem(variantOverride._id, 'OVR');

  const overrideResult = trackResult(
    await reservationService.createReservation(
      baseCommand({
        product: productOverride,
        variant: variantOverride,
        startDate: '2026-11-10',
        endDate: '2026-11-10',
      }),
      { now }
    )
  );
  const overrideStored = await loadStoredReservation(overrideResult.reservation._id);
  assertEqual(overrideStored.items[0].rentalPriceSnapshot, 950, 'variant price override snapshot');
  assertEqual(overrideStored.subtotal, 950, 'variant price override subtotal');

  const productZero = await createProduct();
  const variantZero = await createVariant(productZero._id, {
    rentalPriceOverrides: { external: 0 },
  });
  await createItem(variantZero._id, 'ZERO');

  const zeroResult = trackResult(
    await reservationService.createReservation(
      baseCommand({
        product: productZero,
        variant: variantZero,
        startDate: '2026-11-20',
        endDate: '2026-11-20',
      }),
      { now }
    )
  );
  const zeroStored = await loadStoredReservation(zeroResult.reservation._id);
  assertEqual(zeroStored.items[0].rentalPriceSnapshot, 0, 'zero rental override snapshot');
  assertEqual(zeroStored.subtotal, 0, 'zero rental override subtotal');

  const productDeposit = await createProduct();
  const variantDeposit = await createVariant(productDeposit._id, {
    depositOverride: 500,
  });
  await createItem(variantDeposit._id, 'DEP');

  const depositResult = trackResult(
    await reservationService.createReservation(
      baseCommand({
        product: productDeposit,
        variant: variantDeposit,
        startDate: '2026-11-25',
        endDate: '2026-11-25',
      }),
      { now }
    )
  );
  const depositStored = await loadStoredReservation(depositResult.reservation._id);
  assertEqual(depositStored.items[0].depositSnapshot, 500, 'deposit override snapshot');
  assertEqual(depositStored.deposit, 500, 'deposit override total');
};

const checkProductAndVariantValidation = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  const archived = await createProduct({ status: 'archived' });
  const archivedVariant = await createVariant(archived._id);
  await createItem(archivedVariant._id, 'ARCH');

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({ product: archived, variant: archivedVariant }),
      { now }
    ),
    'PRODUCT_NOT_RENTABLE',
    'archived product'
  );

  const disabled = await createProduct({
    rentalEnabled: false,
    rentalPrices: undefined,
  });
  const disabledVariant = await createVariant(disabled._id);
  await createItem(disabledVariant._id, 'DIS');

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({ product: disabled, variant: disabledVariant }),
      { now }
    ),
    'PRODUCT_NOT_RENTABLE',
    'rental-disabled product'
  );

  const product = await createProduct();
  const inactiveVariant = await createVariant(product._id, { status: 'inactive' });
  await createItem(inactiveVariant._id, 'INACT');

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({ product, variant: inactiveVariant }),
      { now }
    ),
    'VARIANT_NOT_ACTIVE',
    'inactive variant'
  );

  const otherProduct = await createProduct();
  const otherVariant = await createVariant(otherProduct._id);
  await createItem(otherVariant._id, 'MISMATCH');

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({ product, variant: otherVariant }),
      { now }
    ),
    'VARIANT_PRODUCT_MISMATCH',
    'variant product mismatch'
  );
};

const checkNoInventoryAndExistingBooking = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  const emptyProduct = await createProduct();
  const emptyVariant = await createVariant(emptyProduct._id);

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({
        product: emptyProduct,
        variant: emptyVariant,
        startDate: '2026-12-01',
        endDate: '2026-12-01',
      }),
      { now }
    ),
    'NO_AVAILABLE_INVENTORY',
    'no active physical inventory'
  );

  const busyProduct = await createProduct();
  const busyVariant = await createVariant(busyProduct._id);
  const busyItem = await createItem(busyVariant._id, 'BUSY');

  await createExistingReservation({
    product: busyProduct,
    variant: busyVariant,
    item: busyItem,
    startDate: '2026-12-10',
    endDate: '2026-12-12',
  });

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({
        product: busyProduct,
        variant: busyVariant,
        startDate: '2026-12-11',
        endDate: '2026-12-11',
      }),
      { now }
    ),
    'NO_AVAILABLE_INVENTORY',
    'only item already booked'
  );
};

const checkTwoPhysicalItemsConcurrentClients = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id);
  const itemA = await createItem(variant._id, 'TWOA');
  const itemB = await createItem(variant._id, 'TWOB');

  const results = await Promise.all([
    reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2027-01-10',
        endDate: '2027-01-12',
      }),
      { now }
    ),
    reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2027-01-10',
        endDate: '2027-01-12',
      }),
      { now }
    ),
  ]);

  results.forEach(trackResult);

  const ids = results.map(result =>
    result.reservation.items[0].inventoryItemId.toString()
  );

  assertEqual(new Set(ids).size, 2, 'two clients must receive different physical items');
  assert(
    ids.includes(itemA._id.toString()) && ids.includes(itemB._id.toString()),
    'both available physical items must be allocated'
  );

  const storedCount = await ReservationV2Model.countDocuments({
    _id: { $in: results.map(result => result.reservation._id) },
  });
  assertEqual(storedCount, 2, 'two-item concurrent allocator final DB count');
};

const checkOnePhysicalItemConcurrentClients = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id);
  const item = await createItem(variant._id, 'ONE');

  const results = await Promise.allSettled([
    reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2027-02-10',
        endDate: '2027-02-12',
      }),
      { now }
    ),
    reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2027-02-10',
        endDate: '2027-02-12',
      }),
      { now }
    ),
  ]);

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');

  fulfilled.forEach(result => trackResult(result.value));

  assertEqual(fulfilled.length, 1, 'one-item concurrent success count');
  assertEqual(rejected.length, 1, 'one-item concurrent failure count');
  assert(rejected[0].reason instanceof ReservationServiceError, 'one-item loser must receive ReservationServiceError');
  assertEqual(rejected[0].reason.code, 'NO_AVAILABLE_INVENTORY', 'one-item loser error code');

  const count = await ReservationV2Model.countDocuments({
    'items.inventoryItemId': item._id,
    startDate: parseDateOnly('2027-02-10'),
  });
  assertEqual(count, 1, 'one-item concurrent final DB reservation count');
};

const checkCleaningBuffer = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id);
  const item = await createItem(variant._id, 'BUFFER');

  await createExistingReservation({
    product,
    variant,
    item,
    startDate: '2027-03-10',
    endDate: '2027-03-12',
  });

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2027-03-13',
        endDate: '2027-03-13',
      }),
      { now }
    ),
    'NO_AVAILABLE_INVENTORY',
    'cleaning buffer day 13'
  );

  const day14 = trackResult(
    await reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2027-03-14',
        endDate: '2027-03-14',
      }),
      { now }
    )
  );

  assertEqual(
    day14.reservation.items[0].inventoryItemId.toString(),
    item._id.toString(),
    'day 14 should allocate the physical item'
  );
};

const checkStudioExternalSharedPool = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  const studioProduct = await createProduct();
  const studioVariant = await createVariant(studioProduct._id);
  const studioItem = await createItem(studioVariant._id, 'STUDIO');

  await createExistingReservation({
    product: studioProduct,
    variant: studioVariant,
    item: studioItem,
    startDate: '2027-04-10',
    endDate: '2027-04-10',
    rentalMode: 'studio',
  });

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({
        product: studioProduct,
        variant: studioVariant,
        rentalMode: 'external',
        startDate: '2027-04-10',
        endDate: '2027-04-10',
      }),
      { now }
    ),
    'NO_AVAILABLE_INVENTORY',
    'studio booking must block external'
  );

  const externalProduct = await createProduct();
  const externalVariant = await createVariant(externalProduct._id);
  const externalItem = await createItem(externalVariant._id, 'EXTERNAL');

  await createExistingReservation({
    product: externalProduct,
    variant: externalVariant,
    item: externalItem,
    startDate: '2027-04-20',
    endDate: '2027-04-20',
    rentalMode: 'external',
  });

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({
        product: externalProduct,
        variant: externalVariant,
        rentalMode: 'studio',
        startDate: '2027-04-20',
        endDate: '2027-04-20',
      }),
      { now }
    ),
    'NO_AVAILABLE_INVENTORY',
    'external booking must block studio'
  );
};

const checkPastAndToday = async () => {
  const now = new Date('2026-10-10T10:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'TODAY');

  await assertServiceError(
    () => reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2026-10-09',
        endDate: '2026-10-09',
      }),
      { now }
    ),
    'PAST_START_DATE',
    'past Prague business date'
  );

  const today = trackResult(
    await reservationService.createReservation(
      baseCommand({
        product,
        variant,
        startDate: '2026-10-10',
        endDate: '2026-10-10',
      }),
      { now }
    )
  );

  assertEqual(
    today.reservation.startDate.toISOString(),
    '2026-10-10T00:00:00.000Z',
    'today must be allowed and canonical'
  );
};

const checkAuthenticatedCustomer = async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'AUTH');
  const customerId = new Types.ObjectId();

  const result = trackResult(
    await reservationService.createReservation(
      baseCommand({
        product,
        variant,
        customerId,
        startDate: '2027-05-10',
        endDate: '2027-05-10',
      }),
      { now }
    )
  );

  const stored = await loadStoredReservation(result.reservation._id);

  assertEqual(stored.customerId.toString(), customerId.toString(), 'authenticated customerId');
  assertEqual(stored.guestAccessTokenHash, undefined, 'authenticated reservation guest hash');
  assertEqual(result.guestAccessToken, undefined, 'authenticated result raw guest token');
};

const cleanup = async () => {
  if (created.reservations.length) {
    await ReservationV2Model.deleteMany({
      _id: { $in: created.reservations },
    });
  }

  if (created.inventoryItems.length) {
    await InventoryItemV2Model.deleteMany({
      _id: { $in: created.inventoryItems },
    });
  }

  if (created.variants.length) {
    await VariantV2Model.deleteMany({
      _id: { $in: created.variants },
    });
  }

  if (created.products.length) {
    await ProductV2Model.deleteMany({
      _id: { $in: created.products },
    });
  }
};

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    await checkBasicGuestAndFlatPricing();
    await checkPricingOverrides();
    await checkProductAndVariantValidation();
    await checkNoInventoryAndExistingBooking();
    await checkTwoPhysicalItemsConcurrentClients();
    await checkOnePhysicalItemConcurrentClients();
    await checkCleaningBuffer();
    await checkStudioExternalSharedPool();
    await checkPastAndToday();
    await checkAuthenticatedCustomer();

    console.log('Phase 1F reservation service integration checks passed');
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
    console.error('Phase 1F cleanup failed:', cleanupError);
  }

  process.exitCode = 1;
});
