const mongoose = require('mongoose');
const { ReservationV2Model } = require('../build/v2/models');

const uri = process.env.TEST_MONGODB_URI;
if (!uri) process.exit(2);
if (process.env.MONGODB_URI && uri === process.env.MONGODB_URI) process.exit(3);
const parsed = new URL(uri);
const db = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!db || !/(test|testing|ci|dev)/i.test(db) || /(prod|production)/i.test(db)) process.exit(4);

(async () => {
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  try {
    const indexes = await ReservationV2Model.collection.indexes();
    const index = indexes.find(item => item.name === 'uniq_v2_reservation_number');
    if (!index || index.unique !== true || index.key?.reservationNumber !== 1) {
      process.exitCode = 5;
    }
  } finally {
    await mongoose.disconnect();
  }
})().catch(() => {
  process.exitCode = 6;
});
