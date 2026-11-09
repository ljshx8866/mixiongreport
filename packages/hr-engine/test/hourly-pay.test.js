const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateDailyHourlyPay, sumDailyHourlyPay } = require('../dist');

test('daily hourly pay rounds to cents before monthly addition', () => {
  const first = calculateDailyHourlyPay(30, '10.01');
  const second = calculateDailyHourlyPay(30, '10.01');
  assert.equal(first.amount, '5.01');
  assert.equal(sumDailyHourlyPay([first.amount, second.amount]), '10.02');
});

test('hourly pay rejects unrounded or fractional minute inputs', () => {
  assert.throws(() => calculateDailyHourlyPay(29, '10.00'), /multiple of 30/);
  assert.throws(() => calculateDailyHourlyPay(30, '10.001'), /two decimal/);
});
