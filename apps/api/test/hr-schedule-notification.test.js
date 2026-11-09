const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrScheduleNotificationService, scheduleTemplateConfig, scheduleTemplateData } =
  require('../dist/hr/hr-schedule-notification.service');

const envNames = ['HR_SCHEDULE_NOTIFY_ENABLED', 'HR_SCHEDULE_TEMPLATE_ID',
  'HR_SCHEDULE_TEMPLATE_FIELDS_JSON', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET',
  'HR_FEATURES_ENABLED', 'REPORT_SOURCE'];
function withEnv(values, run) {
  const prior = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  const restore = () => { for (const key of envNames) {
    if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
  } };
  try { const result = run(); return Promise.resolve(result).finally(restore); }
  catch (error) { restore(); throw error; }
}

test('schedule template stays disabled until all dedicated fields are configured', async () => {
  await withEnv({ HR_SCHEDULE_NOTIFY_ENABLED: 'true', HR_SCHEDULE_TEMPLATE_ID: 'template',
    HR_SCHEDULE_TEMPLATE_FIELDS_JSON: '{"thing1":"{unknown}"}',
    WECHAT_APP_ID: 'app', WECHAT_APP_SECRET: 'secret' }, () => {
    assert.equal(scheduleTemplateConfig(), null);
  });
  await withEnv({ HR_SCHEDULE_NOTIFY_ENABLED: 'true', HR_SCHEDULE_TEMPLATE_ID: 'template',
    HR_SCHEDULE_TEMPLATE_FIELDS_JSON: '{"thing1":"排班通知","time2":"{date}","thing3":"{shift}","time4":"{start}-{end}","thing5":"{store}"}',
    WECHAT_APP_ID: 'app', WECHAT_APP_SECRET: 'secret' }, () => {
    const config = scheduleTemplateConfig();
    const data = scheduleTemplateData(config, { store: '山大店', date: '2026-10-16', shift: '晚班',
      start: new Date('2026-10-16T01:00:00Z'), end: new Date('2026-10-16T09:00:00Z'),
    });
    assert.equal(data.time2.value, '2026年10月16日');
    assert.equal(data.thing3.value, '晚班');
    assert.equal(data.time4.value, '09:00-17:00');
    assert.equal(data.thing5.value, '山大店');
  });
});

test('queued notice claims once and sends only current published version to linked user', async () => {
  await withEnv({ HR_FEATURES_ENABLED: 'true', REPORT_SOURCE: 'database',
    HR_SCHEDULE_NOTIFY_ENABLED: 'true', HR_SCHEDULE_TEMPLATE_ID: 'schedule-template',
    HR_SCHEDULE_TEMPLATE_FIELDS_JSON: '{"thing1":"排班提醒","time2":"{date}","thing3":"{shift}","time4":"{start}～{end}","thing5":"{store}"}',
    WECHAT_APP_ID: 'app', WECHAT_APP_SECRET: 'secret' }, async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, json: async () => calls.length === 1
        ? { access_token: 'short-lived-token', expires_in: 7200 }
        : { errcode: 0, msgid: 'receipt-1' } };
    };
    let outcome;
    const db = { hrScheduleDelivery: {
      findMany: async () => [{ id: 3n, attempts: 0 }],
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ version: 2, schedule: {
        status: 'PUBLISHED', currentVersion: 2,
        businessDate: new Date('2099-10-16T00:00:00Z'),
        employee: { user: { status: true, openid: 'recipient-openid' } },
        store: { storeName: '山大店' }, shiftTemplate: { name: '早班' }, versions: [{ version: 2,
          plannedStart: new Date('2099-10-16T01:00:00Z'),
          plannedEnd: new Date('2099-10-16T09:00:00Z') }],
      } }),
      update: async ({ data }) => { outcome = data; },
    } };
    try {
      await new HrScheduleNotificationService(db, {}).dispatchQueued();
      assert.equal(outcome.status, 'SENT');
      assert.equal(outcome.providerMessageId, 'receipt-1');
      const sent = JSON.parse(calls[1].options.body);
      assert.equal(sent.touser, 'recipient-openid');
      assert.equal(sent.template_id, 'schedule-template');
      assert.equal(sent.page, 'pages/hr/my-schedule');
      assert.equal(sent.data.thing1.value, '排班提醒');
      assert.equal(sent.data.time2.value, '2099年10月16日');
      assert.equal(sent.data.thing3.value, '早班');
      assert.equal(sent.data.time4.value, '09:00~17:00');
      assert.equal(sent.data.thing5.value, '山大店');
    } finally { global.fetch = originalFetch; }
  });
});

test('disabled schedule template preference skips WeChat delivery', async () => {
  await withEnv({ HR_FEATURES_ENABLED: 'true', REPORT_SOURCE: 'database',
    HR_SCHEDULE_NOTIFY_ENABLED: 'true', HR_SCHEDULE_TEMPLATE_ID: 'schedule-template',
    HR_SCHEDULE_TEMPLATE_FIELDS_JSON: '{"thing1":"排班提醒"}',
    WECHAT_APP_ID: 'app', WECHAT_APP_SECRET: 'secret' }, async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('WeChat must not be called when disabled'); };
    let outcome;
    const db = { hrScheduleDelivery: {
      findMany: async () => [{ id: 9n, attempts: 0 }],
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ version: 1, schedule: {
        status: 'PUBLISHED', currentVersion: 1,
        businessDate: new Date('2099-10-16T00:00:00Z'),
        employee: { user: { status: true, openid: 'recipient-openid',
          notificationPreferences: { schedule: false } } },
        store: { storeName: '山大店' }, shiftTemplate: { name: '早班' }, versions: [{ version: 1,
          plannedStart: new Date('2099-10-16T01:00:00Z'), plannedEnd: new Date('2099-10-16T09:00:00Z') }],
      } }),
      update: async ({ data }) => { outcome = data; },
    } };
    try {
      await new HrScheduleNotificationService(db, {}).dispatchQueued();
      assert.equal(outcome.status, 'FAILED');
      assert.equal(outcome.reasonCode, 'USER_DISABLED');
    } finally { global.fetch = originalFetch; }
  });
});

test('uncertain receipt is not blindly retried', async () => {
  const db = { hrSchedule: { findUnique: async () => ({ id: 4n, status: 'PUBLISHED',
    storeId: 2n, businessDate: new Date('2099-10-16T00:00:00Z'), currentVersion: 1,
    employee: { user: { status: true, openid: 'bound' } },
    deliveries: [{ id: 8n, version: 1, status: 'FAILED', attempts: 1,
      reasonCode: 'SEND_INTERRUPTED' }] }) } };
  const service = new HrScheduleNotificationService(db, { assertStorePermission: async () => {} });
  await assert.rejects(service.retry({ id: 3 }, 4), /receipt is uncertain/);
});

test('definitive provider failure can be requeued with a scoped audit event', async () => {
  await withEnv({ HR_SCHEDULE_NOTIFY_ENABLED: 'true', HR_SCHEDULE_TEMPLATE_ID: 'template',
    HR_SCHEDULE_TEMPLATE_FIELDS_JSON: '{"thing1":"{store}"}',
    WECHAT_APP_ID: 'app', WECHAT_APP_SECRET: 'secret' }, async () => {
    let audit;
    const tx = { hrScheduleDelivery: { updateMany: async () => ({ count: 1 }) },
      auditLog: { create: async ({ data }) => { audit = data; } } };
    const db = { hrSchedule: { findUnique: async () => ({ id: 4n, status: 'PUBLISHED',
      storeId: 2n, businessDate: new Date('2099-10-16T00:00:00Z'), currentVersion: 1,
      employee: { user: { status: true, openid: 'bound' } },
      deliveries: [{ id: 8n, version: 1, status: 'FAILED', attempts: 1,
        reasonCode: 'WECHAT_43101' }],
    }) }, $transaction: async (run) => run(tx) };
    const service = new HrScheduleNotificationService(db,
      { assertStorePermission: async (_user, permission, storeId) => {
        assert.equal(permission, 'HR_SCHEDULE_PUBLISH'); assert.equal(storeId, 2n);
      } });
    const result = await service.retry({ id: 3 }, 4);
    assert.equal(result.deliveryStatus, 'QUEUED');
    assert.equal(audit.action, 'RETRY');
    assert.equal(audit.userId, 3n);
  });
});
