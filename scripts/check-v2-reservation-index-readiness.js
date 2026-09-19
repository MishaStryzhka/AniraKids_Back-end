const mongoose = require('mongoose');
const {
  ReservationV2Model,
} = require('../build/v2/models');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error('TEST_MONGODB_URI is required');
}

if (process.env.MONGODB_URI && testUri === process.env.MONGODB_URI) {
  throw new Error('Refusing to run: TEST_MONGODB_URI matches MONGODB_URI');
}

const parsed = new URL(testUri);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

if (
  !databaseName ||
  !/(test|testing|ci|dev)/i.test(databaseName) ||
  /(prod|production)/i.test(databaseName)
) {
  throw new Error('Unsafe TEST_MONGODB_URI database name');
}

mongoose.set('autoIndex', false);

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const indexes = await ReservationV2Model.collection.indexes();
    const index = indexes.find(
      candidate => candidate.name === 'uniq_v2_reservation_number'
    );

    if (!index) {
      throw new Error('TEST_DB_RESERVATION_NUMBER_INDEX_MISSING');
    }

    if (index.unique !== true || index.key?.reservationNumber !== 1) {
      throw new Error('TEST_DB_RESERVATION_NUMBER_INDEX_INVALID');
    }

    console.log('Phase 1G test DB unique reservation number index check passed');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
