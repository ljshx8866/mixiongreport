import test from 'node:test'
import assert from 'node:assert/strict'
import { getShanghaiBusinessDate, getShanghaiBusinessMonth } from '../src/business-date.ts'

test('business date uses Shanghai local day before UTC day rollover', () => {
  assert.equal(getShanghaiBusinessDate(new Date('2026-10-16T16:30:00.000Z')), '2026-10-17')
})

test('business month uses Shanghai month at UTC month boundary', () => {
  assert.equal(getShanghaiBusinessMonth(new Date('2026-09-30T16:30:00.000Z')), '2026-10')
})

test('business date stays on the current Shanghai day before midnight', () => {
  assert.equal(getShanghaiBusinessDate(new Date('2026-10-16T15:59:00.000Z')), '2026-10-16')
})
