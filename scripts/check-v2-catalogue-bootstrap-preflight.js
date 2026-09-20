const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is required for Phase 1H.2 production preflight');
}

const databaseName = decodeURIComponent(
  new URL(uri).pathname.replace(/^\//, '')
);

if (databaseName !== 'AniraKids') {
  throw new Error(
    `Refusing Phase 1H.2 production work: expected AniraKids, received ${databaseName || '<missing>'}`
  );
}

if (/(test|testing|dev|ci)/i.test(databaseName)) {
  throw new Error('Refusing Phase 1H.2 production work against non-production database');
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const exactSingleKey = (index, field) =>
  index &&
  index.key &&
  Object.keys(index.key).length === 1 &&
  index.key[field] === 1;

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const db = mongoose.connection.db;
    const collections = await db
      .listCollections({}, { nameOnly: true })
      .toArray();
    const names = new Set(collections.map(item => item.name));

    if (!names.has('v2_reservations')) {
      throw new Error('Prerequisite failed: v2_reservations is missing');
    }

    for (const name of [
      'v2_products',
      'v2_variants',
      'v2_inventory_items',
    ]) {
      if (names.has(name)) {
        throw new Error(
          `Phase 1H.2 preflight expected ${name} to be missing before first bootstrap`
        );
      }
    }

    const reservations = db.collection('v2_reservations');
    const reservationCount = await reservations.countDocuments({});

    if (reservationCount !== 0) {
      throw new Error(
        `Expected zero existing v2 reservations, found ${reservationCount}`
      );
    }

    const indexes = await reservations.listIndexes().toArray();

    const reservationNumber = indexes.find(
      index => index.name === 'uniq_v2_reservation_number'
    );

    if (
      !exactSingleKey(reservationNumber, 'reservationNumber') ||
      reservationNumber.unique !== true
    ) {
      throw new Error('Prerequisite failed: reservation number index invalid');
    }

    const idempotency = indexes.find(
      index => index.name === 'uniq_v2_reservation_idempotency_key'
    );

    if (
      !exactSingleKey(idempotency, 'idempotencyKeyHash') ||
      idempotency.unique !== true ||
      idempotency.partialFilterExpression?.idempotencyKeyHash?.$exists !== true
    ) {
      throw new Error('Prerequisite failed: idempotency index invalid');
    }

    console.log('Phase 1H.2 production preflight passed');
    console.log('databaseName:', databaseName);
    console.log('v2_products: MISSING');
    console.log('v2_variants: MISSING');
    console.log('v2_inventory_items: MISSING');
    console.log('existingV2Reservations: 0');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Preserve the original preflight failure.
  }

  process.exitCode = 1;
});
