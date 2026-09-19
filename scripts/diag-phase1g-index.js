const mongoose = require('mongoose');
const { ReservationV2Model } = require('../build/v2/models');

const uri = process.env.TEST_MONGODB_URI;

if (!uri) {
  throw new Error('TEST_MONGODB_URI is required for test index setup');
}

if (process.env.MONGODB_URI && uri === process.env.MONGODB_URI) {
  throw new Error('Refusing to run: TEST_MONGODB_URI matches MONGODB_URI');
}

const parsed = new URL(uri);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

if (
  !databaseName ||
  !/(test|testing|ci|dev)/i.test(databaseName) ||
  /(prod|production)/i.test(databaseName)
) {
  throw new Error('Refusing to modify indexes outside an explicit test database');
}

(async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    await ReservationV2Model.collection.createIndex(
      {
        reservationNumber: 1,
      },
      {
        unique: true,
        name: 'uniq_v2_reservation_number',
      }
    );

    const indexes = await ReservationV2Model.collection.indexes();
    const index = indexes.find(
      candidate =>
        candidate.name === 'uniq_v2_reservation_number' &&
        candidate.unique === true &&
        candidate.key?.reservationNumber === 1
    );

    if (!index) {
      throw new Error('Test reservationNumber unique index was not created');
    }

    console.log('Phase 1G TEST DB reservationNumber index ready');
  } finally {
    await mongoose.disconnect();
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
