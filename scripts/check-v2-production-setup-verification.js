const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is required');
}

const databaseName = decodeURIComponent(
  new URL(uri).pathname.replace(/^\//, '')
);

if (databaseName !== 'AniraKids') {
  throw new Error('Production database name verification failed');
}

if (/(test|testing|ci|dev)/i.test(databaseName)) {
  throw new Error('Refusing audit against non-production database');
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

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
      throw new Error('v2_reservations is missing after controlled setup');
    }

    for (const name of [
      'v2_products',
      'v2_variants',
      'v2_inventory_items',
    ]) {
      if (names.has(name)) {
        throw new Error(
          `Unexpected catalogue collection materialized: ${name}`
        );
      }
    }

    const reservations = db.collection('v2_reservations');
    const indexes = await reservations.listIndexes().toArray();

    const reservationNumber = indexes.find(
      index => index.name === 'uniq_v2_reservation_number'
    );

    const reservationNumberPass =
      reservationNumber &&
      reservationNumber.unique === true &&
      reservationNumber.key &&
      Object.keys(reservationNumber.key).length === 1 &&
      reservationNumber.key.reservationNumber === 1;

    if (!reservationNumberPass) {
      throw new Error('Reservation number index verification failed');
    }

    const idempotency = indexes.find(
      index => index.name === 'uniq_v2_reservation_idempotency_key'
    );

    const idempotencyPass =
      idempotency &&
      idempotency.unique === true &&
      idempotency.key &&
      Object.keys(idempotency.key).length === 1 &&
      idempotency.key.idempotencyKeyHash === 1 &&
      idempotency.partialFilterExpression &&
      idempotency.partialFilterExpression.idempotencyKeyHash &&
      idempotency.partialFilterExpression.idempotencyKeyHash.$exists === true;

    if (!idempotencyPass) {
      throw new Error('Idempotency index verification failed');
    }

    const reservationCount = await reservations.countDocuments({});

    if (reservationCount !== 0) {
      throw new Error(
        `Expected zero production v2 reservations, found ${reservationCount}`
      );
    }

    console.log('Phase 1G.2B production DB verification passed');
    console.log('databaseName:', databaseName);
    console.log('v2_reservations: EXISTS');
    console.log('reservationNumberIndex: PASS');
    console.log('idempotencyIndex: PASS');
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
    // Preserve original failure.
  }

  process.exitCode = 1;
});
