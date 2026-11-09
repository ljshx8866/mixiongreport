const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReminderService } = require('../dist/reminder.service');

test('fill reminder dispatch creates an account inbox notice that opens the input page', async () => {
  const notices = [];
  const writes = [];
  const db = {
    fillReminderTask: { findUniqueOrThrow: async () => ({ id: 7n, storeId: 3n }) },
    user: { findFirstOrThrow: async () => ({ id: 9n, status: true, openid: null }) },
    store: { findUniqueOrThrow: async () => ({ id: 3n, storeName: '茂业店' }) },
    fillReminderTaskUpdate: null,
    fillReminderLog: { create: async ({ data }) => { writes.push({ kind: 'log', data }); } },
    userNotification: { createMany: async ({ data }) => { notices.push(...data); } },
    $transaction: async (operations) => Promise.all(operations),
  };
  db.fillReminderTask.update = async ({ data }) => { writes.push({ kind: 'task', data }); };
  const service = new ReminderService(db);

  const result = await service.dispatch(7n, 9n, 'DELEGATE', 8n);
  assert.equal(result.status, 'FAILED');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].userId, 9n);
  assert.equal(notices[0].category, 'REMINDER');
  assert.equal(notices[0].page, 'pages/input/index');
  assert.match(notices[0].summary, /茂业店.*已转派给你/);
  assert.ok(writes.some((write) => write.kind === 'log' && write.data.action === 'DELEGATE'));
});

test('disabled fill template notification still creates the in-app reminder but skips WeChat delivery', async () => {
  const notices = [];
  const writes = [];
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('WeChat must not be called when disabled'); };
  const db = {
    fillReminderTask: { findUniqueOrThrow: async () => ({ id: 7n, storeId: 3n }),
      update: async ({ data }) => { writes.push({ kind: 'task', data }); } },
    user: { findFirstOrThrow: async () => ({ id: 9n, status: true, openid: 'bound-openid',
      notificationPreferences: { dailyReport: false } }) },
    store: { findUniqueOrThrow: async () => ({ id: 3n, storeName: '茂业店' }) },
    fillReminderLog: { create: async ({ data }) => { writes.push({ kind: 'log', data }); } },
    userNotification: { createMany: async ({ data }) => { notices.push(...data); } },
    $transaction: async (operations) => Promise.all(operations),
  };
  try {
    const result = await new ReminderService(db).dispatch(7n, 9n, 'DELEGATE', 8n);
    assert.equal(result.status, 'DISABLED');
    assert.equal(result.errorMessage, null);
    assert.equal(notices.length, 1);
    assert.ok(writes.some((write) => write.kind === 'log' && write.data.status === 'DISABLED'));
  } finally { global.fetch = originalFetch; }
});
