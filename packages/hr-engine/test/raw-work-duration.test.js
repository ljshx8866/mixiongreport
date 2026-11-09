const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateRawWorkDuration, calculateDailyWorkTime } = require('../dist');

const epochMinute = (iso) => Date.parse(iso) / 60000;

test('raw work duration preserves cross-midnight elapsed time and deducted break', () => {
  const raw = calculateRawWorkDuration({
    startEpochMinutes: epochMinute('2026-10-13T22:00:00+08:00'),
    endEpochMinutes: epochMinute('2026-10-14T02:15:00+08:00'),
    breakMinutes: 25,
  });
  assert.deepEqual(raw, { elapsedMinutes: 255, breakMinutes: 25, rawMinutes: 230 });
  assert.equal(calculateDailyWorkTime([{ rawMinutes: raw.rawMinutes }]).statisticalMinutes, 210);
});

test('raw work duration rejects reversed time, excessive break, and fractional minute inputs', () => {
  const base = { startEpochMinutes: 100, endEpochMinutes: 160, breakMinutes: 0 };
  assert.throws(() => calculateRawWorkDuration({ ...base, endEpochMinutes: 100 }), RangeError);
  assert.throws(() => calculateRawWorkDuration({ ...base, endEpochMinutes: 99 }), RangeError);
  assert.throws(() => calculateRawWorkDuration({ ...base, breakMinutes: 61 }), RangeError);
  assert.throws(() => calculateRawWorkDuration({ ...base, breakMinutes: -1 }), RangeError);
  assert.throws(() => calculateRawWorkDuration({ ...base, breakMinutes: 0.5 }), RangeError);
  assert.deepEqual(calculateRawWorkDuration({ ...base, breakMinutes: 60 }), {
    elapsedMinutes: 60, breakMinutes: 60, rawMinutes: 0,
  });
});
