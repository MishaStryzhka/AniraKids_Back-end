const {
  availabilityBlockConflictsWithRequestedRange,
  CLEANING_BUFFER_DAYS,
  getReservationEndConflictThreshold,
  isBlockingReservationState,
  rangesOverlapInclusive,
  reservationConflictsWithRequestedRange,
} = require('../build/v2/utils/availability');
const {
  addCalendarDays,
  formatDateOnly,
  parseDateOnly,
} = require('../build/v2/utils/date-only');

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

const assertConflict = (
  reservationStart,
  reservationEnd,
  requestedStart,
  requestedEnd,
  expected,
  message
) => {
  assertEqual(
    reservationConflictsWithRequestedRange(
      parseDateOnly(reservationStart),
      parseDateOnly(reservationEnd),
      parseDateOnly(requestedStart),
      parseDateOnly(requestedEnd)
    ),
    expected,
    message
  );
};

const checkReservationBoundaries = () => {
  assertEqual(CLEANING_BUFFER_DAYS, 1, 'cleaning buffer must be exactly one day');

  assertConflict('2026-10-10', '2026-10-12', '2026-10-10', '2026-10-10', true, '10 Oct conflicts');
  assertConflict('2026-10-10', '2026-10-12', '2026-10-11', '2026-10-11', true, '11 Oct conflicts');
  assertConflict('2026-10-10', '2026-10-12', '2026-10-12', '2026-10-12', true, '12 Oct conflicts');
  assertConflict('2026-10-10', '2026-10-12', '2026-10-13', '2026-10-13', true, '13 Oct cleaning buffer conflicts');
  assertConflict('2026-10-10', '2026-10-12', '2026-10-14', '2026-10-14', false, '14 Oct is available');
  assertConflict('2026-10-10', '2026-10-12', '2026-10-09', '2026-10-09', false, '9 Oct is available');

  assertConflict('2026-10-10', '2026-10-10', '2026-10-10', '2026-10-10', true, 'single-day reservation conflicts on its day');
  assertConflict('2026-10-10', '2026-10-10', '2026-10-11', '2026-10-11', true, 'single-day cleaning buffer conflicts next day');
  assertConflict('2026-10-10', '2026-10-10', '2026-10-12', '2026-10-12', false, 'single-day reservation is free after buffer');

  assertEqual(
    formatDateOnly(getReservationEndConflictThreshold(parseDateOnly('2026-10-13'))),
    '2026-10-12',
    'Mongo reservation end threshold must shift requested start back by one day'
  );
};

const checkStatusRules = () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  assert(isBlockingReservationState('pending', new Date('2026-10-01T12:00:01.000Z'), now), 'future pending must block');
  assert(!isBlockingReservationState('pending', new Date('2026-10-01T12:00:00.000Z'), now), 'pending expiresAt == now must not block');
  assert(!isBlockingReservationState('pending', new Date('2026-10-01T11:59:59.000Z'), now), 'expired pending must not block');
  assert(isBlockingReservationState('confirmed', null, now), 'confirmed must block');
  assert(isBlockingReservationState('prepared', null, now), 'prepared must block');
  assert(isBlockingReservationState('rented', null, now), 'rented must block');
  assert(isBlockingReservationState('returned', null, now), 'returned must block');
  assert(!isBlockingReservationState('cancelled', null, now), 'cancelled must not block');
};

const checkAvailabilityBlockRules = () => {
  const blockStart = parseDateOnly('2026-10-10');
  const blockEnd = parseDateOnly('2026-10-12');

  assert(
    availabilityBlockConflictsWithRequestedRange(
      blockStart,
      blockEnd,
      parseDateOnly('2026-10-10'),
      parseDateOnly('2026-10-10')
    ),
    'same-day block boundary must conflict'
  );

  assert(
    availabilityBlockConflictsWithRequestedRange(
      blockStart,
      blockEnd,
      parseDateOnly('2026-10-12'),
      parseDateOnly('2026-10-13')
    ),
    'inclusive touching block boundary must conflict'
  );

  assert(
    !availabilityBlockConflictsWithRequestedRange(
      blockStart,
      blockEnd,
      parseDateOnly('2026-10-13'),
      parseDateOnly('2026-10-13')
    ),
    'day after AvailabilityBlock must be free without extra buffer'
  );

  assert(
    rangesOverlapInclusive(
      parseDateOnly('2026-10-01'),
      parseDateOnly('2026-10-03'),
      parseDateOnly('2026-10-03'),
      parseDateOnly('2026-10-05')
    ),
    'inclusive ranges sharing boundary must overlap'
  );
};

const checkBufferCalendarBoundaries = () => {
  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2026-10-31'), 1)),
    '2026-11-01',
    'cleaning buffer must cross month end'
  );
  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2026-12-31'), 1)),
    '2027-01-01',
    'cleaning buffer must cross year end'
  );
  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2024-02-29'), 1)),
    '2024-03-01',
    'cleaning buffer must cross leap day'
  );
};

const main = () => {
  checkReservationBoundaries();
  checkStatusRules();
  checkAvailabilityBlockRules();
  checkBufferCalendarBoundaries();

  console.log('Phase 1D availability helper checks passed');
};

main();
