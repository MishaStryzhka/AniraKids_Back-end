const assert = require('node:assert/strict');
const {
  parseCatalogueQuery,
  parseAvailabilityQuery,
} = require('../build/v2/routes/catalogue.routes');

assert.deepEqual(parseCatalogueQuery({}), { sort: 'name', page: 1, limit: 12 });
assert.deepEqual(
  parseCatalogueQuery({
    q: '  Šaty  ',
    category: 'dress',
    sort: 'newest',
    page: '2',
    limit: '24',
  }),
  {
    q: 'Šaty',
    category: 'dress',
    sort: 'newest',
    page: 2,
    limit: 24,
  }
);
for (const query of [
  { page: '0' },
  { page: '-1' },
  { page: '1.2' },
  { page: '01' },
  { page: '10001' },
  { page: ['1', '2'] },
  { limit: '25' },
  { limit: 12 },
  { sort: 'random' },
  { category: 'unknown' },
  { q: { $ne: '' } },
  { q: 'x'.repeat(101) },
  { secret: 'x' },
])
  assert.throws(
    () => parseCatalogueQuery(query),
    error => error.code === 'VALIDATION_ERROR'
  );
const quote = {
  variantId: 'a'.repeat(24),
  rentalMode: 'studio',
  startDate: '2030-01-01',
  endDate: '2030-01-02',
};
assert.deepEqual(parseAvailabilityQuery(quote), quote);
for (const invalid of [
  { ...quote, variantId: 'bad' },
  { ...quote, rentalMode: 'sale' },
  { ...quote, startDate: ['2030-01-01'] },
  { ...quote, inventoryItemId: 'a'.repeat(24) },
  {},
])
  assert.throws(
    () => parseAvailabilityQuery(invalid),
    error => error.code === 'VALIDATION_ERROR'
  );
console.log('Public catalogue query validation checks passed');
