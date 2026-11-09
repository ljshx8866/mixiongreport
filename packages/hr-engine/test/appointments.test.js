const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findPrimaryAppointmentOverlaps } = require('../dist');

test('adjacent primary store appointments do not overlap on transfer day', () => {
  assert.deepEqual(findPrimaryAppointmentOverlaps([
    { storeId: 'old', effectiveFrom: '2026-01-01', effectiveToExclusive: '2026-10-14' },
    { storeId: 'new', effectiveFrom: '2026-10-14' },
  ]), []);
});

test('overlapping and duplicate primary appointments are reported regardless of store', () => {
  assert.deepEqual(findPrimaryAppointmentOverlaps([
    { storeId: 'old', effectiveFrom: '2026-01-01', effectiveToExclusive: '2026-10-15' },
    { storeId: 'new', effectiveFrom: '2026-10-14' },
    { storeId: 'new', effectiveFrom: '2026-10-14', effectiveToExclusive: '2026-10-15' },
  ]), [
    { firstIndex: 0, secondIndex: 1 },
    { firstIndex: 0, secondIndex: 2 },
    { firstIndex: 1, secondIndex: 2 },
  ]);
});

test('invalid dates, empty stores, and empty appointments fail closed', () => {
  for (const appointment of [
    { storeId: '', effectiveFrom: '2026-01-01' },
    { storeId: 'one', effectiveFrom: '2026-02-30' },
    { storeId: 'one', effectiveFrom: '2026-01-01', effectiveToExclusive: '2026-01-01' },
    { storeId: 'one', effectiveFrom: '2026-01-02', effectiveToExclusive: '2026-01-01' },
  ]) assert.throws(() => findPrimaryAppointmentOverlaps([appointment]), RangeError);
  assert.deepEqual(findPrimaryAppointmentOverlaps([]), []);
});
