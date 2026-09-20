const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is required');
}

const databaseName = decodeURIComponent(
  new URL(uri).pathname.replace(/^\//, '')
);

if (databaseName !== 'AniraKids') {
  throw new Error(
    `Refusing controlled production write: expected database AniraKids, received ${databaseName || '<missing>'}`
  );
}

if (/(test|testing|ci|dev)/i.test(databaseName)) {
  throw new Error('Refusing controlled production write against non-production database');
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
    const collection = mongoose.connection.db.collection('v2_reservations');

    const firstIndex = (await collection.listIndexes().toArray()).find(
      candidate => candidate.name === 'uniq_v2_reservation_number'
    );

    const firstExact =
      firstIndex &&
      firstIndex.key &&
      Object.keys(firstIndex.key).length === 1 &&
      firstIndex.key.reservationNumber === 1 &&
      firstIndex.unique === true;

    if (!firstExact) {
      throw new Error(
        'Prerequisite failed: uniq_v2_reservation_number is not valid'
      );
    }

    await collection.createIndex(
      { idempotencyKeyHash: 1 },
      {
        unique: true,
        name: 'uniq_v2_reservation_idempotency_key',
        partialFilterExpression: {
          idempotencyKeyHash: {
            $exists: true,
          },
        },
      }
    );

    const indexes = await collection.listIndexes().toArray();
    const index = indexes.find(
      candidate =>
        candidate.name === 'uniq_v2_reservation_idempotency_key'
    );

    const exactKey =
      index &&
      index.key &&
      Object.keys(index.key).length === 1 &&
      index.key.idempotencyKeyHash === 1;

    const exactPartial =
      index &&
      index.partialFilterExpression &&
      index.partialFilterExpression.idempotencyKeyHash &&
      index.partialFilterExpression.idempotencyKeyHash.$exists === true;

    if (
      !index ||
      !exactKey ||
      index.unique !== true ||
      !exactPartial
    ) {
      throw new Error(
        'Idempotency index verification failed after createIndex'
      );
    }

    console.log('Controlled production idempotency index setup passed');
    console.log('databaseName:', databaseName);
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
