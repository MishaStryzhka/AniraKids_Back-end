const mongoose = require('mongoose');

const {
  ReservationV2Model,
} = require('../build/v2/models');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    'MONGODB_URI is required for the manual read-only production index readiness check'
  );
}

mongoose.set('autoIndex', false);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const indexes = await ReservationV2Model.collection.indexes();

    const reservationNumber = indexes.find(
      index => index.name === 'uniq_v2_reservation_number'
    );
    const idempotency = indexes.find(
      index => index.name === 'uniq_v2_reservation_idempotency_key'
    );

    assert(
      reservationNumber?.unique === true &&
        reservationNumber.key?.reservationNumber === 1,
      'Missing or invalid uniq_v2_reservation_number'
    );

    assert(
      idempotency?.unique === true &&
        idempotency.key?.idempotencyKeyHash === 1 &&
        idempotency.partialFilterExpression?.idempotencyKeyHash?.$exists === true,
      'Missing or invalid uniq_v2_reservation_idempotency_key'
    );

    console.log('V2 production reservation index readiness check passed');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Read-only checker is already failing; keep original error as source of truth.
  }

  process.exitCode = 1;
});
