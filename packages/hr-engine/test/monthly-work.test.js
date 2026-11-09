const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildStoreMonthlyWorkSnapshot } = require('../dist');

test('monthly snapshot floors each shift before summing the day', () => {
  const result = buildStoreMonthlyWorkSnapshot(2, '2026-10', [
    { employeeId: 3, storeId: 2, businessDate: '2026-10-01', rawMinutes: 20, recordId: 1, recordVersion: 1 },
    { employeeId: 3, storeId: 2, businessDate: '2026-10-01', rawMinutes: 20, recordId: 2, recordVersion: 1 },
    { employeeId: 3, storeId: 2, businessDate: '2026-10-02', rawMinutes: 29, recordId: 3, recordVersion: 1 },
  ]);
  assert.equal(result.totalRawMinutes, 69);
  assert.equal(result.totalStatisticalMinutes, 0);
  assert.deepEqual(result.rows.map((row) => row.statisticalMinutes), [0, 0]);
  assert.equal(result.ruleCode, 'SHIFT_30_MIN_FLOOR_V2');
});

test('cross-store same day blocks a store-level statistical allocation', () => {
  const result = buildStoreMonthlyWorkSnapshot(2, '2026-10', [
    { employeeId: 3, storeId: 2, businessDate: '2026-10-01', rawMinutes: 20, recordId: 1, recordVersion: 1 },
    { employeeId: 3, storeId: 4, businessDate: '2026-10-01', rawMinutes: 20, recordId: 2, recordVersion: 1 },
  ]);
  assert.equal(result.rows[0].storeRawMinutes, 20);
  assert.equal(result.rows[0].organizationRawMinutes, 40);
  assert.equal(result.rows[0].statisticalMinutes, null);
  assert.equal(result.totalStatisticalMinutes, null);
  assert.deepEqual(result.unresolvedCrossStoreDays, [{ employeeId: 3, businessDate: '2026-10-01' }]);
});
