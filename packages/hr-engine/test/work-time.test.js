const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateDailyWorkTime, DAILY_30_MIN_FLOOR_RULE } = require('../dist');

test('daily business statistic floors each confirmed shift before summing', () => {
  const cases = [
    { segments: [29], raw: 29, statistical: 0, discarded: 29, hours: 0 },
    { segments: [30], raw: 30, statistical: 30, discarded: 0, hours: 0.5 },
    { segments: [59], raw: 59, statistical: 30, discarded: 29, hours: 0.5 },
    { segments: [60], raw: 60, statistical: 60, discarded: 0, hours: 1 },
    { segments: [61], raw: 61, statistical: 60, discarded: 1, hours: 1 },
    { segments: [20, 20], raw: 40, statistical: 0, discarded: 40, hours: 0 },
    { segments: [], raw: 0, statistical: 0, discarded: 0, hours: 0 },
  ];
  for (const item of cases) {
    const result = calculateDailyWorkTime(item.segments.map((rawMinutes) => ({ rawMinutes })));
    assert.deepEqual(result, {
      ruleCode: DAILY_30_MIN_FLOOR_RULE,
      rawMinutes: item.raw,
      statisticalMinutes: item.statistical,
      discardedMinutes: item.discarded,
      statisticalHours: item.hours,
    });
  }
});

test('rejects invalid raw durations instead of silently changing evidence', () => {
  for (const rawMinutes of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateDailyWorkTime([{ rawMinutes }]), RangeError);
  }
  assert.throws(() => calculateDailyWorkTime([{ rawMinutes: Number.MAX_SAFE_INTEGER }, { rawMinutes: 1 }]), RangeError);
});
