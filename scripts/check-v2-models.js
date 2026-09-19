const { Types } = require('mongoose');

const {
  AvailabilityBlockV2Model,
  AvailabilityBlockV2Schema,
  InventoryItemV2Model,
  InventoryItemV2Schema,
  ProductV2Model,
  ProductV2Schema,
  ReservationV2Model,
  ReservationV2Schema,
  VariantV2Model,
  VariantV2Schema,
} = require('../build/v2/models');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const hasIndex = (indexes, fields, options = {}) =>
  indexes.some(([indexFields, indexOptions]) => {
    const sameFields = JSON.stringify(indexFields) === JSON.stringify(fields);
    const matchingOptions = Object.entries(options).every(
      ([key, value]) =>
        JSON.stringify(indexOptions[key]) === JSON.stringify(value)
    );

    return sameFields && matchingOptions;
  });

const validProductData = {
  name: 'Šaty Sofia',
  slug: 'saty-sofia',
  description: 'Slavnostní dětské šaty.',
  category: 'dress',
  gender: 'girls',
  color: 'pink',
  occasion: ['wedding'],
  ageTags: ['5-7'],
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
    noIndex: false,
  },
};

const validateProductRules = async () => {
  const missingStudio = new ProductV2Model({
    ...validProductData,
    rentalPrices: { external: 800 },
  });

  let missingStudioError;
  try {
    await missingStudio.validate();
  } catch (error) {
    missingStudioError = error;
  }
  assert(
    missingStudioError?.message.includes('studio rental price is required'),
    'Active rentable ProductV2 must require studio rental price'
  );

  const missingExternal = new ProductV2Model({
    ...validProductData,
    rentalPrices: { studio: 600 },
  });

  let missingExternalError;
  try {
    await missingExternal.validate();
  } catch (error) {
    missingExternalError = error;
  }
  assert(
    missingExternalError?.message.includes('external rental price is required'),
    'Active rentable ProductV2 must require external rental price'
  );

  await new ProductV2Model(validProductData).validate();
  await new ProductV2Model({
    name: 'Draft model',
    slug: 'draft-model',
    status: 'draft',
  }).validate();

  assert(
    hasIndex(ProductV2Schema.indexes(), { slug: 1 }, { unique: true }),
    'ProductV2 must define a unique slug index'
  );
};

const validateVariantRules = async () => {
  const variant = new VariantV2Model({
    productId: new Types.ObjectId(),
    size: '116',
    rentalPriceOverrides: { studio: 0 },
  });

  await variant.validate();
  assert(
    variant.rentalPriceOverrides?.studio === 0,
    'Variant rental override 0 must remain a valid explicit override'
  );

  assert(
    hasIndex(
      VariantV2Schema.indexes(),
      { productId: 1, size: 1 },
      { unique: true }
    ),
    'VariantV2 must define a unique productId + size index'
  );

  const skuIndex = VariantV2Schema.indexes().find(
    ([fields]) => JSON.stringify(fields) === JSON.stringify({ sku: 1 })
  );
  assert(skuIndex?.[1].unique === true, 'VariantV2 SKU index must be unique');
  assert(
    skuIndex?.[1].partialFilterExpression !== undefined,
    'VariantV2 SKU index must be partial for missing SKU values'
  );
};

const validateInventoryRules = async () => {
  const missingCode = new InventoryItemV2Model({
    variantId: new Types.ObjectId(),
  });
  assert(
    missingCode.validateSync()?.errors.internalCode !== undefined,
    'InventoryItemV2 internalCode must be required'
  );

  const invalidStatus = new InventoryItemV2Model({
    variantId: new Types.ObjectId(),
    internalCode: 'SOF-116-01',
    status: 'available',
  });
  assert(
    invalidStatus.validateSync()?.errors.status !== undefined,
    'InventoryItemV2 must reject unknown status values'
  );

  const item = new InventoryItemV2Model({
    variantId: new Types.ObjectId(),
    internalCode: 'sof-116-01',
  });
  await item.validate();
  assert(item.internalCode === 'SOF-116-01', 'internalCode must normalize uppercase');
  assert(item.bookingRevision === 0, 'bookingRevision must default to 0');
  assert(
    InventoryItemV2Schema.path('bookingRevision').options.select === false,
    'bookingRevision must be select:false'
  );
  assert(
    InventoryItemV2Schema.path('available') === undefined,
    'InventoryItemV2 must not contain an available field'
  );
};

const createReservation = (overrides = {}) =>
  new ReservationV2Model({
    reservationNumber: 'AK-2026-ABC123',
    customerSnapshot: {
      firstName: 'Anna',
      lastName: 'Nováková',
      email: 'ANNA@EXAMPLE.CZ',
      phone: '+420 777 123 456',
    },
    items: [
      {
        productId: new Types.ObjectId(),
        variantId: new Types.ObjectId(),
        inventoryItemId: new Types.ObjectId(),
        productNameSnapshot: 'Šaty Sofia',
        sizeSnapshot: '116',
        rentalPriceSnapshot: 800,
        depositSnapshot: 1000,
      },
    ],
    rentalMode: 'external',
    startDate: new Date('2026-10-10T00:00:00.000Z'),
    endDate: new Date('2026-10-10T00:00:00.000Z'),
    status: 'pending',
    expiresAt: new Date('2026-09-20T21:00:00.000Z'),
    subtotal: 800,
    deposit: 1000,
    totalDue: 1800,
    fulfillmentMethod: 'pickup',
    paymentStatus: 'unpaid',
    ...overrides,
  });

const validateReservationRules = async () => {
  const singleDay = createReservation();
  await singleDay.validate();
  assert(
    singleDay.customerSnapshot.email === 'anna@example.cz',
    'Reservation customer email must normalize lowercase'
  );
  assert(
    singleDay.customerId === undefined,
    'Reservation customerId must be optional for guest reservations'
  );

  const reversed = createReservation({
    startDate: new Date('2026-10-12T00:00:00.000Z'),
    endDate: new Date('2026-10-10T00:00:00.000Z'),
  });
  assert(
    reversed.validateSync()?.errors.endDate !== undefined,
    'Reservation must reject endDate before startDate'
  );

  const pendingWithoutExpiry = createReservation({ expiresAt: undefined });
  assert(
    pendingWithoutExpiry.validateSync()?.errors.expiresAt !== undefined,
    'Pending Reservation must require expiresAt'
  );

  const invalidMode = createReservation({ rentalMode: 'delivery' });
  assert(
    invalidMode.validateSync()?.errors.rentalMode !== undefined,
    'Reservation must reject invalid rentalMode'
  );

  assert(
    ReservationV2Schema.path('guestAccessTokenHash').options.select === false,
    'guestAccessTokenHash must be select:false'
  );
  assert(
    ReservationV2Schema.path('totalDue') !== undefined,
    'Reservation must persist totalDue'
  );

  const itemsSchema = ReservationV2Schema.path('items').schema;
  assert(
    itemsSchema.path('rentalPriceSnapshot') !== undefined,
    'ReservationItem must persist rentalPriceSnapshot'
  );
  assert(
    itemsSchema.path('dailyRentalPriceSnapshot') === undefined,
    'ReservationItem must not contain daily rental price fields'
  );

  assert(
    hasIndex(
      ReservationV2Schema.indexes(),
      {
        'items.inventoryItemId': 1,
        status: 1,
        startDate: 1,
        endDate: 1,
      }
    ),
    'ReservationV2 must define the inventory conflict lookup index'
  );
};

const validateAvailabilityBlockRules = async () => {
  const valid = new AvailabilityBlockV2Model({
    inventoryItemId: new Types.ObjectId(),
    startDate: new Date('2026-10-10T00:00:00.000Z'),
    endDate: new Date('2026-10-10T00:00:00.000Z'),
    reason: 'cleaning',
    createdBy: new Types.ObjectId(),
  });
  await valid.validate();

  const reversed = new AvailabilityBlockV2Model({
    inventoryItemId: new Types.ObjectId(),
    startDate: new Date('2026-10-12T00:00:00.000Z'),
    endDate: new Date('2026-10-10T00:00:00.000Z'),
    reason: 'repair',
    createdBy: new Types.ObjectId(),
  });
  assert(
    reversed.validateSync()?.errors.endDate !== undefined,
    'AvailabilityBlockV2 must reject endDate before startDate'
  );

  assert(
    hasIndex(AvailabilityBlockV2Schema.indexes(), {
      inventoryItemId: 1,
      startDate: 1,
      endDate: 1,
    }),
    'AvailabilityBlockV2 must define the inventory date-range lookup index'
  );
};

const main = async () => {
  await validateProductRules();
  await validateVariantRules();
  await validateInventoryRules();
  await validateReservationRules();
  await validateAvailabilityBlockRules();

  console.log('Phase 1B model validation checks passed');
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
