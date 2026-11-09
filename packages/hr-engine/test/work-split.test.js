const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitWorkIntervalByShanghaiDay, calculateDailyWorkTime } = require('../dist');

const minutes = (iso) => Date.parse(iso) / 60000;

test('cross-midnight work and its break are attributed to actual Shanghai calendar days', () => {
  const parts = splitWorkIntervalByShanghaiDay({
    startEpochMinutes: minutes('2026-10-14T23:00:00+08:00'),
    endEpochMinutes: minutes('2026-10-15T02:00:00+08:00'),
    breaks: [{ startEpochMinutes: minutes('2026-10-15T00:30:00+08:00'),
      endEpochMinutes: minutes('2026-10-15T01:00:00+08:00') }],
  });
  assert.deepEqual(parts, [
    { businessDate: '2026-10-14', elapsedMinutes: 60, breakMinutes: 0, rawMinutes: 60 },
    { businessDate: '2026-10-15', elapsedMinutes: 120, breakMinutes: 30, rawMinutes: 90 },
  ]);
  assert.equal(calculateDailyWorkTime([parts[0]]).statisticalMinutes, 60);
  assert.equal(calculateDailyWorkTime([parts[1]]).statisticalMinutes, 90);
});

test('a break spanning midnight is also split before daily 30-minute rounding', () => {
  const parts = splitWorkIntervalByShanghaiDay({
    startEpochMinutes: minutes('2026-10-14T23:00:00+08:00'),
    endEpochMinutes: minutes('2026-10-15T02:00:00+08:00'),
    breaks: [{ startEpochMinutes: minutes('2026-10-14T23:50:00+08:00'),
      endEpochMinutes: minutes('2026-10-15T00:10:00+08:00') }],
  });
  assert.deepEqual(parts.map((item) => item.rawMinutes), [50, 110]);
  assert.deepEqual(parts.map((item) => calculateDailyWorkTime([item]).statisticalMinutes), [30, 90]);
});

test('overlapping or out-of-shift breaks fail closed', () => {
  const base = { startEpochMinutes: minutes('2026-10-14T09:00:00+08:00'),
    endEpochMinutes: minutes('2026-10-14T12:00:00+08:00') };
  assert.throws(() => splitWorkIntervalByShanghaiDay({ ...base, breaks: [
    { startEpochMinutes: base.startEpochMinutes + 30, endEpochMinutes: base.startEpochMinutes + 60 },
    { startEpochMinutes: base.startEpochMinutes + 50, endEpochMinutes: base.startEpochMinutes + 70 },
  ] }), /non-overlapping/);
});
