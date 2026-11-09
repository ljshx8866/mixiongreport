const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DailyInputController } = require('../dist/daily-input.controller');
const { SyncService } = require('../dist/sync.service');

const input = {
  id: 12n, storeId: 4n, businessDate: new Date('2026-10-08T00:00:00.000Z'), status: 'DRAFT',
  totalPower: 1, kitchenPower: 1, diningPower: 1, waterUsage: 1, laborHours: 1,
};
const request = { user: { id: 33, role: 'STORE_MANAGER', storeIds: [4] } };

test('submit commits the manual input before refreshing POS', async () => {
  const order = [];
  const tx = {
    storeDailyInput: { updateMany: async () => { order.push('submit'); return { count: 1 }; } },
    dailyReportState: { upsert: async () => { order.push('state'); } },
    fillReminderTask: { updateMany: async () => { order.push('reminders'); } },
  };
  const db = {
    storeDailyInput: { findUniqueOrThrow: async () => input },
    hrSchedule: { findMany: async () => [] },
    hrEmployee: { findUnique: async () => null },
    $transaction: async (fn) => fn(tx),
  };
  const sync = { sync: async (storeId, date) => {
    order.push('sync');
    assert.equal(storeId, 4);
    assert.equal(date, '2026-10-08');
    return { status: 'SUCCESS', syncedAt: '2026-10-08T08:00:00.000Z' };
  } };
  const result = await new DailyInputController(db, sync, {}).submit(request, 12);
  assert.deepEqual(order, ['submit', 'state', 'reminders', 'sync']);
  assert.equal(result.status, 'SUBMITTED');
  assert.equal(result.posSync.status, 'SUCCESS');
});

test('POS sync failure keeps the manual input submitted and queues retry', async () => {
  let committed = false;
  const db = {
    storeDailyInput: { findUniqueOrThrow: async () => input },
    hrSchedule: { findMany: async () => [] },
    hrEmployee: { findUnique: async () => null },
    $transaction: async () => { committed = true; },
  };
  const sync = { sync: async () => { throw new Error('POS unavailable'); } };
  const result = await new DailyInputController(db, sync, {}).submit(request, 12);
  assert.equal(committed, true);
  assert.equal(result.status, 'SUBMITTED');
  assert.equal(result.posSync.status, 'PENDING');
});

test('submitting an already-submitted input is idempotent and does not sync again', async () => {
  let syncCalls = 0;
  const db = {
    storeDailyInput: { findUniqueOrThrow: async () => ({ ...input, status: 'SUBMITTED' }) },
    hrSchedule: { findMany: async () => [] },
    hrEmployee: { findUnique: async () => null },
  };
  const sync = { sync: async () => { syncCalls += 1; } };
  const result = await new DailyInputController(db, sync, {}).submit(request, 12);
  assert.equal(result.status, 'SUBMITTED');
  assert.equal(result.posSync.status, 'QUEUED');
  assert.equal(syncCalls, 0);
});

test('linked employees need the separate reporting permission and active store assignment', async () => {
  const calls = [];
  const db = {
    hrEmployee: { findUnique: async () => ({ id: 88n, status: 'ACTIVE' }) },
    hrPrimaryAppointment: { findFirst: async ({ where }) => {
      calls.push(['appointment', where.employeeId, where.storeId]); return { id: 3n };
    } },
  };
  const access = { assertStorePermission: async (user, code, storeId) => {
    calls.push(['permission', user.id, code, storeId]);
  } };
  const controller = new DailyInputController(db, {}, access);
  await controller.assertInputAccess(request, 4, input.businessDate);
  assert.deepEqual(calls, [
    ['permission', 33, 'HR_DAILY_INPUT_WRITE', 4n], ['appointment', 88n, 4n],
  ]);
  const denied = new DailyInputController(db, {}, { assertStorePermission: async () => {
    throw new Error('HR access denied');
  } });
  await assert.rejects(() => denied.assertInputAccess(request, 4, input.businessDate), /HR access denied/);
});

test('same-store same-day POS syncs run in sequence', async () => {
  const service = new SyncService({});
  const started = [];
  const release = [];
  service.syncNow = async () => {
    started.push(started.length + 1);
    await new Promise((resolve) => release.push(resolve));
    return { status: 'SUCCESS' };
  };
  const first = service.sync(4, '2026-10-08');
  const second = service.sync(4, '2026-10-08');
  await new Promise(setImmediate);
  assert.deepEqual(started, [1]);
  release.shift()();
  await first;
  await new Promise(setImmediate);
  assert.deepEqual(started, [1, 2]);
  release.shift()();
  await second;
});
