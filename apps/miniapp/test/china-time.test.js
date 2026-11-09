const test = require('node:test')
const assert = require('node:assert/strict')
const { formatChinaClock, chinaClockMinutes } = require('../src/utils/china-time.ts')

test('formats API UTC timestamps as China wall-clock time without locale strings', () => {
  assert.equal(formatChinaClock('2026-10-23T00:30:00.000Z'), '08:30')
  assert.equal(formatChinaClock('2026-10-23T10:00:00.000Z'), '18:00')
})

test('handles explicit offsets and wall-clock values consistently', () => {
  assert.equal(formatChinaClock('2026-10-23T08:30:00+08:00'), '08:30')
  assert.equal(formatChinaClock('2026-10-23 08:30:00'), '08:30')
  assert.equal(formatChinaClock('8:05'), '08:05')
})

test('returns a numeric minute value for schedule conflict checks', () => {
  assert.equal(chinaClockMinutes('2026-10-23T00:30:00.000Z'), 510)
  assert.equal(chinaClockMinutes(null), null)
})
