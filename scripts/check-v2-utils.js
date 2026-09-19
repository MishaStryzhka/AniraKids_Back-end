const {
  addCalendarDays,
  calculateRentalDays,
  calculateReservationTotals,
  compareDateOnly,
  formatDateOnly,
  getBusinessDateOnly,
  isCanonicalDateOnlyDate,
  parseDateOnly,
  PricingError,
  resolveDeposit,
  resolveRentalPrice,
  resolveRentalPricing,
} = require('../build/v2/utils');

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

const assertThrows = (fn, expectedMessage, message) => {
  let thrown;

  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert(thrown, `${message}: expected function to throw`);

  if (expectedMessage) {
    assert(
      thrown.message.includes(expectedMessage),
      `${message}: expected error containing "${expectedMessage}", received "${thrown.message}"`
    );
  }

  return thrown;
};

const checkParseAndFormat = () => {
  assertEqual(
    parseDateOnly('2026-10-10').toISOString(),
    '2026-10-10T00:00:00.000Z',
    'parseDateOnly must normalize to UTC midnight'
  );
  assertEqual(
    parseDateOnly('2024-02-29').toISOString(),
    '2024-02-29T00:00:00.000Z',
    'parseDateOnly must accept leap day'
  );

  [
    '2025-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-1-1',
    '10.10.2026',
    '2026/10/10',
    '2026-10-10T00:00:00Z',
    'abc',
  ].forEach(value =>
    assertThrows(
      () => parseDateOnly(value),
      undefined,
      `parseDateOnly must reject ${value}`
    )
  );

  const canonical = new Date('2026-10-10T00:00:00.000Z');
  assert(
    isCanonicalDateOnlyDate(canonical),
    'UTC midnight date must be canonical'
  );
  assert(
    !isCanonicalDateOnlyDate(new Date('2026-10-10T00:00:00.001Z')),
    'non-midnight date must not be canonical'
  );
  assertEqual(
    formatDateOnly(canonical),
    '2026-10-10',
    'formatDateOnly must use UTC components'
  );
};

const checkDateArithmetic = () => {
  const oct10 = parseDateOnly('2026-10-10');
  const oct11 = parseDateOnly('2026-10-11');

  assertEqual(compareDateOnly(oct10, oct11), -1, 'compareDateOnly earlier');
  assertEqual(compareDateOnly(oct10, oct10), 0, 'compareDateOnly equal');
  assertEqual(compareDateOnly(oct11, oct10), 1, 'compareDateOnly later');

  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2026-10-31'), 1)),
    '2026-11-01',
    'addCalendarDays must cross month boundary'
  );
  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2026-12-31'), 1)),
    '2027-01-01',
    'addCalendarDays must cross year boundary'
  );
  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2024-02-28'), 1)),
    '2024-02-29',
    'addCalendarDays must handle leap year'
  );
  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2024-02-29'), 1)),
    '2024-03-01',
    'addCalendarDays must cross leap day'
  );
  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2026-01-01'), -1)),
    '2025-12-31',
    'addCalendarDays must support negative amount'
  );
  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2026-01-01'), 0)),
    '2026-01-01',
    'addCalendarDays zero must preserve date'
  );
  assertThrows(
    () => addCalendarDays(oct10, 1.5),
    'integer',
    'addCalendarDays must reject decimal amount'
  );

  assertEqual(
    calculateRentalDays(oct10, oct10),
    1,
    'same-day rental must be 1 day'
  );
  assertEqual(
    calculateRentalDays(oct10, oct11),
    2,
    'next-day rental must be 2 days inclusive'
  );
  assertEqual(
    calculateRentalDays(oct10, parseDateOnly('2026-10-12')),
    3,
    '10-12 Oct must be 3 rental days'
  );
  assertEqual(
    calculateRentalDays(
      parseDateOnly('2026-10-31'),
      parseDateOnly('2026-11-01')
    ),
    2,
    'rental days must cross month boundary'
  );
  assertEqual(
    calculateRentalDays(
      parseDateOnly('2026-12-31'),
      parseDateOnly('2027-01-01')
    ),
    2,
    'rental days must cross year boundary'
  );
  assertEqual(
    calculateRentalDays(
      parseDateOnly('2024-02-28'),
      parseDateOnly('2024-03-01')
    ),
    3,
    'rental days must include leap day'
  );
  assertThrows(
    () => calculateRentalDays(oct11, oct10),
    'endDate must be on or after startDate',
    'reversed rental range must fail'
  );
};

const checkPragueTimezoneAndDst = () => {
  assertEqual(
    getBusinessDateOnly(new Date('2026-03-28T23:30:00.000Z')),
    '2026-03-29',
    'Prague spring date must reflect local midnight'
  );
  assertEqual(
    getBusinessDateOnly(new Date('2026-03-29T22:30:00.000Z')),
    '2026-03-30',
    'Prague CEST offset must be timezone-aware'
  );
  assertEqual(
    getBusinessDateOnly(new Date('2026-10-24T22:30:00.000Z')),
    '2026-10-25',
    'Prague autumn date must reflect local midnight'
  );
  assertEqual(
    getBusinessDateOnly(new Date('2026-10-25T23:30:00.000Z')),
    '2026-10-26',
    'Prague CET offset must be timezone-aware after DST transition'
  );

  assertEqual(
    formatDateOnly(addCalendarDays(parseDateOnly('2026-03-29'), 1)),
    '2026-03-30',
    'spring DST must not affect calendar addition'
  );
  assertEqual(
    calculateRentalDays(
      parseDateOnly('2026-03-28'),
      parseDateOnly('2026-03-30')
    ),
    3,
    'spring DST must not create 23-hour rental-day bugs'
  );
  assertEqual(
    calculateRentalDays(
      parseDateOnly('2026-10-24'),
      parseDateOnly('2026-10-26')
    ),
    3,
    'autumn DST must not create 25-hour rental-day bugs'
  );
};

const baseProduct = {
  rentalEnabled: true,
  rentalPrices: {
    studio: 600,
    external: 800,
  },
  defaultDeposit: 1000,
};

const checkPricing = () => {
  assertEqual(
    resolveRentalPrice(baseProduct, {}, 'studio'),
    600,
    'studio price must fall back to Product'
  );
  assertEqual(
    resolveRentalPrice(baseProduct, {}, 'external'),
    800,
    'external price must fall back to Product'
  );
  assertEqual(
    resolveRentalPrice(
      baseProduct,
      { rentalPriceOverrides: { studio: 750 } },
      'studio'
    ),
    750,
    'studio Variant override must win'
  );
  assertEqual(
    resolveRentalPrice(
      baseProduct,
      { rentalPriceOverrides: { external: 950 } },
      'external'
    ),
    950,
    'external Variant override must win'
  );
  assertEqual(
    resolveRentalPrice(
      baseProduct,
      { rentalPriceOverrides: { external: 0 } },
      'external'
    ),
    0,
    'zero Variant rental override must remain valid'
  );

  const missingModeError = assertThrows(
    () =>
      resolveRentalPrice(
        {
          rentalEnabled: true,
          rentalPrices: { external: 800 },
          defaultDeposit: 1000,
        },
        {},
        'studio'
      ),
    'Rental price is not configured for mode "studio"',
    'missing mode price must fail'
  );
  assert(
    missingModeError instanceof PricingError,
    'missing rental price must throw PricingError'
  );

  assertThrows(
    () =>
      resolveRentalPrice(
        {
          ...baseProduct,
          rentalEnabled: false,
        },
        {},
        'external'
      ),
    'not enabled for rental',
    'rentalEnabled=false must fail'
  );

  assertEqual(
    resolveDeposit(baseProduct, {}),
    1000,
    'deposit must fall back to Product'
  );
  assertEqual(
    resolveDeposit(baseProduct, { depositOverride: 500 }),
    500,
    'Variant deposit override must win'
  );
  assertEqual(
    resolveDeposit(baseProduct, { depositOverride: 0 }),
    0,
    'zero deposit override must remain valid'
  );

  const resolved = resolveRentalPricing(
    baseProduct,
    { rentalPriceOverrides: { external: 900 }, depositOverride: 500 },
    'external'
  );
  assertEqual(resolved.rentalPrice, 900, 'resolved rental pricing price');
  assertEqual(resolved.deposit, 500, 'resolved rental pricing deposit');
};

const checkTotals = () => {
  const one = calculateReservationTotals([
    { rentalPrice: 800, deposit: 1000 },
  ]);
  assertEqual(one.subtotal, 800, 'one-item subtotal');
  assertEqual(one.deposit, 1000, 'one-item deposit');
  assertEqual(one.totalDue, 1800, 'one-item totalDue');

  const multiple = calculateReservationTotals([
    { rentalPrice: 800, deposit: 1000 },
    { rentalPrice: 700, deposit: 500 },
  ]);
  assertEqual(multiple.subtotal, 1500, 'multiple item subtotal');
  assertEqual(multiple.deposit, 1500, 'multiple item deposit');
  assertEqual(multiple.totalDue, 3000, 'multiple item totalDue');

  assertEqual(
    calculateReservationTotals([{ rentalPrice: 800, deposit: 0 }]).totalDue,
    800,
    'zero deposit must be valid'
  );
  assertEqual(
    calculateReservationTotals([{ rentalPrice: 0, deposit: 0 }]).totalDue,
    0,
    'free rental must be valid'
  );

  [
    { rentalPrice: -1, deposit: 0 },
    { rentalPrice: 1.5, deposit: 0 },
    { rentalPrice: Number.NaN, deposit: 0 },
    { rentalPrice: Number.POSITIVE_INFINITY, deposit: 0 },
  ].forEach(item =>
    assertThrows(
      () => calculateReservationTotals([item]),
      'non-negative integer',
      'invalid money value must fail'
    )
  );

  const rentalDays = calculateRentalDays(
    parseDateOnly('2026-10-10'),
    parseDateOnly('2026-10-12')
  );
  const flat = calculateReservationTotals([
    { rentalPrice: 800, deposit: 1000 },
  ]);
  assertEqual(rentalDays, 3, 'informational rentalDays must be 3');
  assertEqual(
    flat.subtotal,
    800,
    'flat rental price must not be multiplied by rentalDays'
  );
};

const main = () => {
  checkParseAndFormat();
  checkDateArithmetic();
  checkPragueTimezoneAndDst();
  checkPricing();
  checkTotals();

  console.log('Phase 1C utility checks passed');
};

main();
