const { test } = require('node:test');
const assert = require('node:assert/strict');
const { UserNotificationsController } = require('../dist/user-notifications.controller');

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function setup() {
  const users = [
    { id: 1n, status: true, notificationPreferences: null },
    { id: 2n, status: true, notificationPreferences: null },
  ];
  const rows = [
    { id: 1n, userId: 1n, category: 'SCHEDULE', title: '新排班已发布', summary: '2026-10-18 09:00–18:00', page: 'pages/hr/my-schedule', eventKey: 'schedule-1', createdAt: new Date('2026-10-18T01:00:00Z'), readAt: null },
    { id: 2n, userId: 1n, category: 'APPROVAL', title: '员工入职待审批', summary: '有新的待审批事项', page: 'pages/hr/approvals?storeId=3', eventKey: 'approval-1', createdAt: new Date('2026-10-18T00:00:00Z'), readAt: new Date('2026-10-18T00:30:00Z') },
    { id: 3n, userId: 2n, category: 'RESULT', title: '审批已通过', summary: '完成', page: 'pages/hr/approvals', eventKey: 'approval-2', createdAt: new Date('2026-10-17T00:00:00Z'), readAt: null },
    { id: 4n, userId: 1n, category: 'CORRECTION', title: '员工资料待修改', summary: '请重新提交', page: 'pages/hr/onboarding', eventKey: 'correction-1', createdAt: new Date('2026-10-17T12:00:00Z'), readAt: null },
  ];
  const db = { user: {
    findFirst: async ({ where }) => users.find((user) => matches(user, where)) ?? null,
    update: async ({ where, data }) => {
      const user = users.find((item) => item.id === where.id);
      Object.assign(user, data);
      return user;
    },
  }, userNotification: {
    count: async ({ where }) => rows.filter((row) => matches(row, where)).length,
    findMany: async ({ where, orderBy, skip, take }) => rows.filter((row) => matches(row, where))
      .sort((a, b) => b.createdAt - a.createdAt).slice(skip, skip + take),
    findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
    updateMany: async ({ where, data }) => {
      const matching = rows.filter((row) => matches(row, where));
      matching.forEach((row) => Object.assign(row, data));
      return { count: matching.length };
    },
  }, hrEmployee: {
    findUnique: async ({ where }) => where.userId === 1n ? { id: 101n, status: 'ACTIVE' } : null,
  }, hrSchedule: {
    findFirst: async ({ where }) => where.employeeId === 101n ? { id: 301n } : null,
  } };
  const access = { currentAccess: async (user) => ({ stores: [{ permissionCodes: user?.id === 1
    ? ['HR_DAILY_INPUT_WRITE', 'HR_ONBOARDING_APPROVE'] : [] }] }) };
  return { controller: new UserNotificationsController(db, access), rows, users };
}

test('template notification settings are account-scoped and default to enabled', async () => {
  const { controller, users } = setup();
  const alice = { user: { id: 1, role: 'STORE_MANAGER', storeIds: [] } };
  const initial = await controller.settings(alice);
  assert.equal(initial.authorizationMode, 'ONE_TIME');
  assert.deepEqual(initial.items.map((item) => [item.key, item.enabled]), [
    ['approval', true], ['schedule', true], ['dailyReport', true],
  ]);
  await controller.updateSettings(alice, { key: 'schedule', enabled: false });
  const updated = await controller.settings(alice);
  assert.equal(updated.items.find((item) => item.key === 'schedule').enabled, false);
  assert.equal(updated.items.find((item) => item.key === 'approval').enabled, true);
  assert.equal(users[1].notificationPreferences, null);
  await assert.rejects(controller.updateSettings(alice, { key: 'unknown', enabled: false }), /不支持的通知类型/);
});

test('accounts without reporting, approval, or scheduled work permissions get no template controls', async () => {
  const { controller } = setup();
  const employee = { user: { id: 2, role: 'STORE_MANAGER', storeIds: [] } };
  const settings = await controller.settings(employee);
  assert.deepEqual(settings.items, []);
  await assert.rejects(controller.updateSettings(employee, { key: 'dailyReport', enabled: true }), /当前账号无需接收此类通知/);
});

test('inbox lists notifications only for the signed-in account and filters unread records', async () => {
  const { controller } = setup();
  const alice = { user: { id: 1, role: 'STORE_MANAGER', storeIds: [] } };
  assert.deepEqual(await controller.unreadCount(alice), { count: 2 });
  const all = await controller.list(alice, 'ALL');
  assert.equal(all.total, 3);
  assert.equal(all.unreadCount, 2);
  assert.equal(all.items[0].page, '/pages/hr/my-schedule');
  const unread = await controller.list(alice, 'UNREAD');
  assert.equal(unread.total, 2);
  assert.equal(unread.items[0].id, 1);
  await assert.rejects(controller.list(alice, 'INVALID'), /通知筛选条件无效/);
});

test('read operations are account scoped and mark-all only updates the caller', async () => {
  const { controller, rows } = setup();
  const alice = { user: { id: 1, role: 'STORE_MANAGER', storeIds: [] } };
  const bob = { user: { id: 2, role: 'STORE_MANAGER', storeIds: [] } };
  await assert.rejects(controller.markRead(alice, '3'), /通知不存在/);
  const read = await controller.markRead(alice, '1');
  assert.equal(read.id, 1);
  assert.ok(read.readAt instanceof Date);
  assert.deepEqual(await controller.markAllRead(alice), { updated: 1 });
  assert.ok(rows.filter((row) => row.userId === 1n).every((row) => row.readAt));
  assert.equal(rows.find((row) => row.userId === 2n).readAt, null);
  await assert.rejects(controller.unreadCount({}), /请先登录/);
  await assert.deepEqual(await controller.unreadCount(bob), { count: 1 });
});
