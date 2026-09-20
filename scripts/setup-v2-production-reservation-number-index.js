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

    await collection.createIndex(
      { reservationNumber: 1 },
      {
        unique: true,
        name: 'uniq_v2_reservation_number',
      }
    );

    const indexes = await collection.listIndexes().toArray();
    const index = indexes.find(
      candidate => candidate.name === 'uniq_v2_reservation_number'
    );

    const exactKey =
      index &&
      index.key &&
      Object.keys(index.key).length === 1 &&
      index.key.reservationNumber === 1;

    if (!index || !exactKey || index.unique !== true) {
      throw new Error(
        'Reservation number index verification failed after createIndex'
      );
    }

    console.log('Controlled production reservation number index setup passed');
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
