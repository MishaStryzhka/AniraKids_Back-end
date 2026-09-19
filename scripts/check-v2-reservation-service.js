const {
  PENDING_RESERVATION_TTL_MS,
  calculatePendingExpiresAt,
  generateGuestAccessToken,
  generateReservationNumber,
  hashGuestAccessToken,
  normalizeReservationCustomer,
  normalizeReservationNotes,
} = require('../build/v2/utils/reservation');

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

const checkReservationNumber = () => {
  const pragueNextYearInstant = new Date('2026-12-31T23:30:00.000Z');
  const reservationNumber = generateReservationNumber(pragueNextYearInstant);

  assert(
    /^AK-2027-[A-Z0-9]{6}$/.test(reservationNumber),
    'reservation number must use Prague business year and six A-Z0-9 chars'
  );
};

const checkGuestToken = () => {
  const first = generateGuestAccessToken();
  const second = generateGuestAccessToken();

  assert(first.rawToken.length >= 40, 'guest token must represent 32 random bytes');
  assert(
    /^[A-Za-z0-9_-]+$/.test(first.rawToken),
    'guest token must be URL-safe'
  );
  assertEqual(first.hash.length, 64, 'SHA-256 token hash length');
  assert(first.hash !== first.rawToken, 'stored hash must differ from raw token');
  assert(
    first.rawToken !== second.rawToken,
    'independent guest token generations should differ'
  );
  assertEqual(
    hashGuestAccessToken(first.rawToken),
    first.hash,
    'same raw token must hash consistently'
  );
};

const checkPendingExpiry = () => {
  const now = new Date('2026-10-10T12:34:56.789Z');
  const expiresAt = calculatePendingExpiresAt(now);

  assertEqual(
    PENDING_RESERVATION_TTL_MS,
    24 * 60 * 60 * 1000,
    'pending TTL must be 24 elapsed hours'
  );
  assertEqual(
    expiresAt.getTime() - now.getTime(),
    24 * 60 * 60 * 1000,
    'expiresAt must be exactly now + 24 hours'
  );
};

const checkCustomerNormalization = () => {
  const normalized = normalizeReservationCustomer({
    firstName: '  Anna ',
    lastName: ' Nováková  ',
    email: '  ANNA@EXAMPLE.CZ ',
    phone: '  +420 777 123 456  ',
  });

  assertEqual(normalized.firstName, 'Anna', 'firstName normalization');
  assertEqual(normalized.lastName, 'Nováková', 'lastName normalization');
  assertEqual(normalized.email, 'anna@example.cz', 'email normalization');
  assertEqual(normalized.phone, '+420 777 123 456', 'phone normalization');

  assertEqual(
    normalizeReservationNotes('  Prosím zavolat.  '),
    'Prosím zavolat.',
    'notes must trim'
  );
  assertEqual(
    normalizeReservationNotes('   '),
    undefined,
    'blank notes must normalize to undefined'
  );
};

const main = () => {
  checkReservationNumber();
  checkGuestToken();
  checkPendingExpiry();
  checkCustomerNormalization();

  console.log('Phase 1F reservation service helper checks passed');
};

main();
