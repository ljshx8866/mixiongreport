const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DailyInputController } = require('../dist/daily-input.controller');

const date = new Date('2026-10-24T00:00:00.000Z');

test('daily input labor total uses current confirmed versions, flags pending shifts, and excludes schedule-only positions', async () => {
  const schedules = [
    { employee: { jobPosition: { scheduleOnly: false } }, workRecord: { currentVersion: 2, versions: [
      { version: 1, daySegments: [{ rawMinutes: 600 }] },
      { version: 2, daySegments: [{ rawMinutes: 47 }] },
    ] } },
    { employee: { jobPosition: null }, workRecord: null },
    { employee: { jobPosition: { scheduleOnly: true } }, workRecord: null },
  ];
  const query = {};
  const controller = new DailyInputController({ hrSchedule: { findMany: async (value) => {
    Object.assign(query, value); return schedules;
  } } }, {}, {});
  controller.assertInputAccess = async () => {};

  const result = await controller.getLaborHours({ user: { id: 10 } }, 4, '2026-10-24');

  assert.equal(query.where.storeId, 4n);
  assert.equal(query.where.businessDate.toISOString(), date.toISOString());
  assert.deepEqual(result, { storeId: 4, date: '2026-10-24', scheduledShiftCount: 2,
    confirmedShiftCount: 1, pendingShiftCount: 1, statisticalMinutes: 30, laborHours: 0.5 });
});

test('saving a daily input overwrites any supplied labor hours with confirmed work totals', async () => {
  let saved;
  const controller = new DailyInputController({
    hrSchedule: { findMany: async () => [{ employee: { jobPosition: null }, workRecord: { currentVersion: 1,
      versions: [{ version: 1, daySegments: [{ rawMinutes: 76 }] }] } }] },
    storeDailyInput: { findUnique: async () => null, upsert: async (args) => {
      saved = args; return { id: 55n, status: 'DRAFT' };
    } },
    auditLog: { create: async () => {} },
  }, {}, {});
  controller.assertInputAccess = async () => {};

  await controller.save({ user: { id: 10 } }, { storeId: 4, date: '2026-10-24', laborHours: 99 });

  assert.equal(saved.create.laborHours, 1);
  assert.equal(saved.update.laborHours, 1);
});

test('daily input submit allows pending shifts while required-confirmation setting is off', async () => {
  const previous = process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT;
  process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT = 'false';
  let submitted = false;
  const tx = {
    storeDailyInput: { updateMany: async () => { submitted = true; return { count: 1 }; } },
    dailyReportState: { upsert: async () => {} },
    fillReminderTask: { updateMany: async () => {} },
  };
  const controller = new DailyInputController({
    storeDailyInput: { findUniqueOrThrow: async () => ({ id: 55n, storeId: 4n,
      businessDate: date, status: 'DRAFT', totalPower: 1, kitchenPower: 1, diningPower: 1, waterUsage: 1 }) },
    hrSchedule: { findMany: async () => [{ employee: { jobPosition: null }, workRecord: null }] },
    $transaction: async (fn) => fn(tx),
  }, { sync: async () => ({ status: 'SUCCESS' }) }, {});
  controller.assertInputAccess = async () => {};

  try {
    const result = await controller.submit({ user: { id: 10 } }, 55);
    assert.equal(result.status, 'SUBMITTED');
    assert.equal(submitted, true);
  } finally {
    if (previous === undefined) delete process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT;
    else process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT = previous;
  }
});

test('daily input submit refuses pending shifts only when required-confirmation setting is enabled', async () => {
  const previous = process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT;
  process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT = 'true';
  let transactionCalled = false;
  const controller = new DailyInputController({
    storeDailyInput: { findUniqueOrThrow: async () => ({ id: 55n, storeId: 4n,
      businessDate: date, status: 'DRAFT', totalPower: 1, kitchenPower: 1, diningPower: 1, waterUsage: 1 }) },
    hrSchedule: { findMany: async () => [{ employee: { jobPosition: null }, workRecord: null }] },
    $transaction: async () => { transactionCalled = true; },
  }, { sync: async () => ({ status: 'SUCCESS' }) }, {});
  controller.assertInputAccess = async () => {};

  try {
    await assert.rejects(() => controller.submit({ user: { id: 10 } }, 55), /1 个班次未确认/);
    assert.equal(transactionCalled, false);
  } finally {
    if (previous === undefined) delete process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT;
    else process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT = previous;
  }
});
