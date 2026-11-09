const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrScheduleService } = require('../dist/hr/hr-schedule.service');

function shanghaiTomorrow() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => parts.find((item) => item.type === type).value;
  const today = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  return new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
}

test('tomorrow schedule binds an active employee to a configured store shift', async () => {
  const day = shanghaiTomorrow();
  const checks = [];
  let saved;
  const tx = {
    $queryRaw: async () => [],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrPrimaryAppointment: { findFirst: async () => ({ id: 8n }) },
    hrOffboardingRequest: { findFirst: async () => null },
    hrShiftTemplate: { findFirst: async () => ({ id: 9n, storeId: 4n, name: '早班',
      startTime: '09:00', endTime: '17:00', breakMinutes: 60, enabled: true }) },
    hrSchedule: {
      findMany: async () => [],
      create: async ({ data }) => { saved = data; return { id: 7n, status: 'DRAFT', currentVersion: 1 }; },
    },
    auditLog: { create: async () => {} },
  };
  const service = new HrScheduleService({ $transaction: async (run) => run(tx) }, {
    assertStorePermission: async (...args) => checks.push(args),
  });
  const result = await service.create({ id: 2 }, {
    employeeId: 3, storeId: 4, businessDate: day, shiftTemplateId: 9,
  });
  assert.equal(result.status, 'DRAFT');
  assert.equal(saved.shiftTemplateId, 9n);
  assert.equal(saved.versions.create.plannedStart.toISOString(), `${day}T01:00:00.000Z`);
  assert.equal(saved.versions.create.breakMinutes, 60);
  assert.equal(checks[0][1], 'HR_SCHEDULE_DRAFT_EDIT');
});

test('a trial employee can be scheduled at the trial store starting on the recorded trial date', async () => {
  const service = new HrScheduleService({}, {});
  const employee = { status: 'TRIAL', initialStoreId: 4n,
    trialStartedAt: new Date('2026-10-20T00:00:00Z'), user: null };
  const tx = { hrEmployee: { findUnique: async () => employee },
    hrPrimaryAppointment: { findFirst: async () => null },
    hrOffboardingRequest: { findFirst: async () => null } };
  await service.assertEligible(tx, 3n, 4n, new Date('2026-10-20T00:00:00Z'));
  await service.assertEligible(tx, 3n, 4n, new Date('2026-10-22T00:00:00Z'));
  await assert.rejects(service.assertEligible(tx, 3n, 4n, new Date('2026-10-19T00:00:00Z')),
    /not active in this store/);
  await assert.rejects(service.assertEligible(tx, 3n, 9n, new Date('2026-10-22T00:00:00Z')),
    /not active in this store/);
});

test('schedule accepts a user-selected future date beyond tomorrow', async () => {
  const day = new Date(`${shanghaiTomorrow()}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 4);
  const selectedDate = day.toISOString().slice(0, 10);
  let saved;
  const tx = {
    $queryRaw: async () => [],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrPrimaryAppointment: { findFirst: async () => ({ id: 8n }) },
    hrOffboardingRequest: { findFirst: async () => null },
    hrShiftTemplate: { findFirst: async () => ({ id: 9n, storeId: 4n, name: '晚班',
      startTime: '17:00', endTime: '23:00', breakMinutes: 30, enabled: true }) },
    hrSchedule: {
      findMany: async () => [],
      create: async ({ data }) => { saved = data; return { id: 7n, status: 'DRAFT', currentVersion: 1 }; },
    },
    auditLog: { create: async () => {} },
  };
  const service = new HrScheduleService({ $transaction: async (run) => run(tx) }, {
    assertStorePermission: async () => {},
  });

  await service.create({ id: 2 }, {
    employeeId: 3, storeId: 4, businessDate: selectedDate, shiftTemplateId: 9,
  });
  assert.equal(saved.businessDate.toISOString().slice(0, 10), selectedDate);
});

test('schedule refuses an overlapping shift even if the other shift starts the next day', async () => {
  const day = shanghaiTomorrow();
  const start = new Date(`${day}T23:00:00+08:00`);
  const end = new Date(start.getTime() + 3 * 3600000);
  const existing = { currentVersion: 1, versions: [{ version: 1,
    plannedStart: new Date(start.getTime() + 2 * 3600000),
    plannedEnd: new Date(end.getTime() + 2 * 3600000) }] };
  const service = new HrScheduleService({}, {});
  await assert.rejects(service.assertNoOverlap({ hrSchedule: { findMany: async () => [existing] } },
    3n, new Date(`${day}T00:00:00Z`), start, end), /overlapping schedule/);
});

test('schedule requires a preconfigured store shift template', async () => {
  const service = new HrScheduleService({}, {});
  await assert.rejects(service.create({ id: 2 }, {
    employeeId: 3, storeId: 4, businessDate: shanghaiTomorrow(),
  }), /Invalid id/);
});

test('store shift templates reject cross-midnight intervals', async () => {
  const service = new HrScheduleService({}, { assertStorePermission: async () => {} });
  await assert.rejects(service.createShiftTemplate({ id: 2 }, {
    storeId: 4, name: '夜班', startTime: '22:00', endTime: '02:00', breakMinutes: 0,
  }), /end must be later than start/);
});

test('publishing queues one employee notice only with dedicated template and bound recipient', async () => {
  const keys = ['HR_SCHEDULE_NOTIFY_ENABLED', 'HR_SCHEDULE_TEMPLATE_ID',
    'HR_SCHEDULE_TEMPLATE_FIELDS_JSON', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { HR_SCHEDULE_NOTIFY_ENABLED: 'true',
    HR_SCHEDULE_TEMPLATE_ID: 'dedicated-template',
    HR_SCHEDULE_TEMPLATE_FIELDS_JSON: '{"thing1":"{store}"}',
    WECHAT_APP_ID: 'app', WECHAT_APP_SECRET: 'secret' });
  const day = shanghaiTomorrow();
  const schedule = { id: 7n, employeeId: 3n, storeId: 4n,
    businessDate: new Date(`${day}T00:00:00Z`), status: 'DRAFT', currentVersion: 1,
    versions: [{ version: 1, plannedStart: new Date(`${day}T09:00:00+08:00`),
      plannedEnd: new Date(`${day}T17:00:00+08:00`) }] };
  let delivery;
  const notices = [];
  const tx = {
    $queryRaw: async () => [],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE', user: { id: 3n, status: true, openid: 'bound' } }) },
    hrPrimaryAppointment: { findFirst: async () => ({ id: 1n }) },
    hrOffboardingRequest: { findFirst: async () => null },
    hrSchedule: { findUnique: async () => schedule, findMany: async () => [], update: async () => {} },
    hrScheduleVersion: { update: async () => {} },
    userNotification: { createMany: async ({ data }) => { notices.push(...data); return { count: data.length }; } },
    hrScheduleDelivery: { create: async ({ data }) => { delivery = data; } },
    auditLog: { create: async () => {} },
  };
  const service = new HrScheduleService({ hrSchedule: { findUnique: async () => schedule },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} });
  try {
    const result = await service.publish({ id: 2 }, 7);
    assert.equal(result.deliveryStatus, 'QUEUED');
    assert.equal(delivery.scheduleId, 7n);
    assert.equal(delivery.version, 1);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].userId, 3n);
    assert.equal(notices[0].category, 'SCHEDULE');
    assert.equal(notices[0].title, '新排班已发布');

    schedule.versions[0].publishedAt = new Date();
    schedule.versions.push({ version: 2, plannedStart: new Date(`${day}T10:00:00+08:00`),
      plannedEnd: new Date(`${day}T18:00:00+08:00`) });
    schedule.status = 'DRAFT';
    schedule.currentVersion = 2;
    const adjusted = await service.publish({ id: 2 }, 7);
    assert.equal(adjusted.version, 2);
    assert.equal(notices.length, 2);
    assert.equal(notices[1].title, '排班调整通知');
    assert.equal(notices[1].eventKey, 'hr:schedule:7:version:2');
  } finally { for (const key of keys) {
    if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
  } }
});

function batchScheduleDb(templates) {
  const schedules = [];
  const audits = [];
  const notices = [];
  let nextId = 1n;
  const point = { id: 99n, storeId: 4n, name: '大厅', enabled: true };
  const tx = {
    $queryRaw: async () => [],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE', user: { id: 3n, status: true, openid: null } }) },
    hrPrimaryAppointment: { findFirst: async () => ({ id: 1n }) },
    hrOffboardingRequest: { findFirst: async () => null },
    hrShiftTemplate: { findMany: async () => templates },
    hrSchedulePoint: { findMany: async () => [point] },
    hrSchedule: {
      findMany: async ({ where = {} } = {}) => schedules.filter((item) =>
        (where.employeeId == null || item.employeeId === where.employeeId) &&
        (where.id?.not == null || item.id !== where.id.not)),
      create: async ({ data }) => {
        const item = { id: nextId++, employeeId: data.employeeId, storeId: data.storeId,
          businessDate: data.businessDate, status: 'DRAFT', currentVersion: 1,
          versions: [{ ...data.versions.create }] };
        schedules.push(item); return item;
      },
      update: async ({ where, data }) => {
        const item = schedules.find((row) => row.id === where.id);
        Object.assign(item, data); return item;
      },
    },
    hrScheduleVersion: { update: async () => {} },
    userNotification: { createMany: async ({ data }) => { notices.push(...data); return { count: data.length }; } },
    hrScheduleDelivery: { create: async () => {} },
    auditLog: { create: async ({ data }) => audits.push(data) },
  };
  return { schedules, audits, notices, tx };
}

test('batch scheduling supports multiple shifts for one employee and publishes the whole draft set', async () => {
  const day = shanghaiTomorrow();
  const templates = [
    { id: 11n, storeId: 4n, name: '早班', startTime: '09:00', endTime: '12:00', breakMinutes: 0, enabled: true },
    { id: 12n, storeId: 4n, name: '晚班', startTime: '13:00', endTime: '17:00', breakMinutes: 0, enabled: true },
  ];
  const { schedules, notices, tx } = batchScheduleDb(templates);
  const db = { hrSchedule: { findMany: async () => schedules },
    $transaction: async (run) => run(tx) };
  const service = new HrScheduleService(db, { assertStorePermission: async () => {} });
  const created = await service.createBatch({ id: 2 }, { storeId: 4, businessDate: day,
    assignments: [{ employeeId: 3, shiftTemplateId: 11, pointId: 99 },
      { employeeId: 3, shiftTemplateId: 12, pointId: 99 }] });
  assert.equal(created.count, 2);
  assert.equal(schedules.length, 2);
  const published = await service.publishBatch({ id: 2 }, { storeId: 4, businessDate: day,
    scheduleIds: created.created.map((item) => item.id) });
  assert.equal(published.count, 2);
  assert.ok(schedules.every((item) => item.status === 'PUBLISHED'));
  assert.deepEqual(notices.map((notice) => notice.title), ['新排班已发布', '新排班已发布']);

  for (const schedule of schedules) {
    schedule.versions[0].publishedAt = new Date();
    schedule.versions.push({ ...schedule.versions[0], version: 2 });
    schedule.status = 'DRAFT';
    schedule.currentVersion = 2;
  }
  const adjusted = await service.publishBatch({ id: 2 }, { storeId: 4, businessDate: day,
    scheduleIds: created.created.map((item) => item.id) });
  assert.equal(adjusted.count, 2);
  assert.deepEqual(notices.slice(2).map((notice) => notice.title), ['排班调整通知', '排班调整通知']);
});

test('batch scheduling rejects a conflict between selected shifts for one employee', async () => {
  const templates = [
    { id: 21n, storeId: 4n, name: '早班', startTime: '09:00', endTime: '13:00', breakMinutes: 0, enabled: true },
    { id: 22n, storeId: 4n, name: '中班', startTime: '12:00', endTime: '17:00', breakMinutes: 0, enabled: true },
  ];
  const { schedules, tx } = batchScheduleDb(templates);
  const db = { $transaction: async (run) => {
    const before = [...schedules];
    try { return await run(tx); } catch (error) { schedules.splice(0, schedules.length, ...before); throw error; }
  } };
  const service = new HrScheduleService(db, { assertStorePermission: async () => {} });
  await assert.rejects(service.createBatch({ id: 2 }, { storeId: 4, businessDate: shanghaiTomorrow(),
    assignments: [{ employeeId: 3, shiftTemplateId: 21, pointId: 99 },
      { employeeId: 3, shiftTemplateId: 22, pointId: 99 }] }),
  /overlapping schedule/);
  assert.equal(schedules.length, 0);
});

test('deleting a pending schedule cancels it and writes an audit record', async () => {
  const current = { id: 12n, employeeId: 3n, storeId: 4n,
    businessDate: new Date(`${shanghaiTomorrow()}T00:00:00Z`), status: 'DRAFT', currentVersion: 2 };
  let updated;
  let audit;
  const tx = {
    $queryRaw: async () => [],
    hrSchedule: {
      findUnique: async () => current,
      update: async ({ data }) => { updated = data; return { ...current, ...data }; },
    },
    auditLog: { create: async ({ data }) => { audit = data; } },
  };
  const service = new HrScheduleService({
    hrSchedule: { findUnique: async () => current },
    $transaction: async (run) => run(tx),
  }, { assertStorePermission: async () => {} });

  const result = await service.cancelDraft({ id: 2 }, 12, 2);
  assert.deepEqual(result, { id: 12, status: 'CANCELED', wasPublished: false });
  assert.deepEqual(updated, { status: 'CANCELED' });
  assert.equal(audit.action, 'CANCEL_DRAFT');
  assert.equal(audit.entityId, 12n);
});

test('a published shift without confirmed work can be withdrawn and audited', async () => {
  const current = { id: 12n, employeeId: 3n, storeId: 4n, shiftTemplateId: 6n,
    businessDate: new Date(`${shanghaiTomorrow()}T00:00:00Z`), status: 'PUBLISHED', currentVersion: 1 };
  let updated;
  let deliveryUpdate;
  let audit;
  const service = new HrScheduleService({
    hrSchedule: { findUnique: async () => current },
    $transaction: async (run) => run({
      $queryRaw: async () => [],
      hrSchedule: { findUnique: async () => current, update: async ({ data }) => { updated = data; } },
      hrWorkRecord: { findUnique: async () => null },
      hrScheduleDelivery: { updateMany: async ({ where, data }) => { deliveryUpdate = { where, data }; return { count: 1 }; } },
      auditLog: { create: async ({ data }) => { audit = data; } },
    }),
  }, { assertStorePermission: async () => {} });
  const result = await service.cancelDraft({ id: 2 }, 12, 1);
  assert.deepEqual(result, { id: 12, status: 'CANCELED', wasPublished: true });
  assert.deepEqual(updated, { status: 'CANCELED' });
  assert.deepEqual(deliveryUpdate, { where: { scheduleId: 12n, version: 1, status: 'QUEUED' },
    data: { status: 'FAILED', reasonCode: 'SCHEDULE_CANCELED' } });
  assert.equal(audit.action, 'CANCEL_PUBLISHED');
});

test('a published shift with confirmed work must go through time correction before withdrawal', async () => {
  const current = { id: 12n, employeeId: 3n, storeId: 4n, status: 'PUBLISHED', currentVersion: 1 };
  const service = new HrScheduleService({
    hrSchedule: { findUnique: async () => current },
    $transaction: async (run) => run({
      $queryRaw: async () => [],
      hrSchedule: { findUnique: async () => current, update: async () => { throw new Error('must not update'); } },
      hrWorkRecord: { findUnique: async () => ({ id: 30n }) },
      hrScheduleDelivery: { updateMany: async () => { throw new Error('must not update delivery'); } },
      auditLog: { create: async () => {} },
    }),
  }, { assertStorePermission: async () => {} });
  await assert.rejects(service.cancelDraft({ id: 2 }, 12, 1), /Confirmed work hours exist/);
});

test('a published shift can be withdrawn after its work record was approved for deletion', async () => {
  const current = { id: 12n, employeeId: 3n, storeId: 4n,
    businessDate: new Date(`${shanghaiTomorrow()}T00:00:00Z`), status: 'PUBLISHED', currentVersion: 1 };
  let updated;
  let audit;
  const service = new HrScheduleService({
    hrSchedule: { findUnique: async () => current },
    $transaction: async (run) => run({
      $queryRaw: async () => [],
      hrSchedule: { findUnique: async () => current, update: async ({ data }) => { updated = data; } },
      hrWorkRecord: { findUnique: async () => ({ id: 30n, currentVersion: 2, versions: [{ version: 2,
        rawMinutes: 0, daySegments: [] }] }) },
      hrScheduleDelivery: { updateMany: async () => ({ count: 0 }) },
      auditLog: { create: async ({ data }) => { audit = data; } },
    }),
  }, { assertStorePermission: async () => {} });
  const result = await service.cancelDraft({ id: 2 }, 12, 1);
  assert.deepEqual(result, { id: 12, status: 'CANCELED', wasPublished: true });
  assert.deepEqual(updated, { status: 'CANCELED' });
  assert.equal(audit.action, 'CANCEL_PUBLISHED');
});

test('shift templates with schedule history cannot be deleted', async () => {
  const template = { id: 6n, storeId: 4n, code: 'SHIFT_6', name: '早班', startTime: '09:00',
    endTime: '17:00', breakMinutes: 30, enabled: false, sortOrder: 0 };
  const service = new HrScheduleService({
    hrShiftTemplate: { findUnique: async () => template },
    $transaction: async (run) => run({
      $queryRaw: async () => [],
      hrShiftTemplate: { findUnique: async () => template, delete: async () => { throw new Error('must not delete'); } },
      hrSchedule: { count: async () => 1 },
      auditLog: { create: async () => { throw new Error('must not audit'); } },
    }),
  }, { assertStorePermission: async () => {} });
  await assert.rejects(service.deleteShiftTemplate({ id: 2 }, 6), /已用于历史排班/);
});

test('unused shift templates can be deleted and the action is audited', async () => {
  const template = { id: 6n, storeId: 4n, code: 'SHIFT_6', name: '临时班', startTime: '09:00',
    endTime: '17:00', breakMinutes: 30, enabled: true, sortOrder: 2 };
  let deleted;
  let audit;
  const service = new HrScheduleService({
    hrShiftTemplate: { findUnique: async () => template },
    $transaction: async (run) => run({
      $queryRaw: async () => [],
      hrShiftTemplate: { findUnique: async () => template, delete: async ({ where }) => { deleted = where.id; } },
      hrSchedule: { count: async () => 0 },
      auditLog: { create: async ({ data }) => { audit = data; } },
    }),
  }, { assertStorePermission: async () => {} });
  const result = await service.deleteShiftTemplate({ id: 2 }, 6);
  assert.deepEqual(result, { id: 6, deleted: true });
  assert.equal(deleted, 6n);
  assert.equal(audit.action, 'DELETE');
  assert.equal(audit.beforeData.name, '临时班');
});
