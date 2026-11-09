const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateConfirmedWorkPay } = require('../dist/hr/hr-hourly-pay');

test('confirmed work wages use the effective daily rate and sum amounts rounded per day', () => {
  const days = [
    { date: '2026-10-14', statisticalMinutes: 90, confirmedShifts: 2 },
    { date: '2026-10-15', statisticalMinutes: 30, confirmedShifts: 1 },
  ];
  const rates = [{ effectiveFrom: new Date('2026-10-01T00:00:00Z'),
    effectiveToExclusive: new Date('2026-10-15T00:00:00Z'), hourlyRate: { toFixed: () => '10.25' } },
  { effectiveFrom: new Date('2026-10-15T00:00:00Z'), effectiveToExclusive: null,
    hourlyRate: { toFixed: () => '10.25' } }];
  const result = calculateConfirmedWorkPay(days, rates);
  assert.deepEqual(result.days.map(({ basePayAmount, payStatus }) => ({ basePayAmount, payStatus })), [
    { basePayAmount: '15.38', payStatus: 'CALCULATED' },
    { basePayAmount: '5.13', payStatus: 'CALCULATED' },
  ]);
  assert.equal(result.totalBasePayAmount, '20.51');
  assert.equal(result.payStatus, 'CALCULATED');
});

test('unconfirmed work is not included in wages and a missing effective rate is identified', () => {
  const waiting = calculateConfirmedWorkPay([{ date: '2026-10-14', statisticalMinutes: 0, confirmedShifts: 0 }], []);
  assert.equal(waiting.days[0].payStatus, 'WAITING_FOR_CONFIRMATION');
  assert.equal(waiting.totalBasePayAmount, null);
  const missing = calculateConfirmedWorkPay([{ date: '2026-10-14', statisticalMinutes: 60, confirmedShifts: 1 }], []);
  assert.equal(missing.days[0].payStatus, 'MISSING_RATE');
  assert.equal(missing.totalBasePayAmount, null);
});
