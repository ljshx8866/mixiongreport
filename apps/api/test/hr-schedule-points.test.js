const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrScheduleService } = require('../dist/hr/hr-schedule.service');

function tomorrow() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => parts.find((item) => item.type === type).value;
  const today = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  return new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
}

test('creating a schedule point trims its name and records the authorized store scope', async () => {
  let created;
  let audit;
  const checks = [];
  const point = { id: 19n, storeId: 4n, name: '前厅', sortOrder: 2, enabled: true };
  const service = new HrScheduleService({ $transaction: async (run) => run({
    hrSchedulePoint: { create: async ({ data }) => { created = data; return point; } },
    auditLog: { create: async ({ data }) => { audit = data; } },
  }) }, { assertStorePermission: async (...args) => checks.push(args) });

  const result = await service.createPoint({ id: 7 }, { storeId: 4, name: '  前厅  ', sortOrder: 2 });
  assert.equal(created.name, '前厅');
  assert.deepEqual(checks[0], [{ id: 7 }, 'HR_SCHEDULE_POINT_EDIT', 4n]);
  assert.equal(audit.entityType, 'HR_SCHEDULE_POINT');
  assert.equal(result.id, 19);
});

test('batch scheduling stores the selected point id and historical name snapshot', async () => {
  const day = tomorrow();
  const point = { id: 19n, storeId: 4n, name: '前厅', enabled: true };
  const template = { id: 11n, storeId: 4n, name: '早班', startTime: '09:00', endTime: '12:00',
    breakMinutes: 0, enabled: true };
  const createdRows = [];
  const audits = [];
  const tx = {
    $queryRaw: async () => [],
    hrShiftTemplate: { findMany: async () => [template] },
    hrSchedulePoint: { findMany: async () => [point] },
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrPrimaryAppointment: { findFirst: async () => ({ id: 3n }) },
    hrOffboardingRequest: { findFirst: async () => null },
    hrSchedule: {
      findMany: async () => [],
      create: async ({ data }) => {
        createdRows.push(data);
        return { id: BigInt(createdRows.length), status: 'DRAFT', currentVersion: 1 };
      },
    },
    auditLog: { create: async ({ data }) => audits.push(data) },
  };
  const service = new HrScheduleService({ $transaction: async (run) => run(tx) }, {
    assertStorePermission: async () => {},
  });

  const result = await service.createBatch({ id: 7 }, { storeId: 4, businessDate: day,
    assignments: [{ employeeId: 3, shiftTemplateId: 11, pointId: 19 }] });
  assert.equal(createdRows[0].pointId, 19n);
  assert.equal(createdRows[0].pointName, '前厅');
  assert.equal(result.created[0].pointName, '前厅');
  assert.equal(audits[0].afterData.pointName, '前厅');
});

test('batch scheduling rejects a point that is disabled or belongs to a different store', async () => {
  let creates = 0;
  const template = { id: 11n, storeId: 4n, name: '早班', startTime: '09:00', endTime: '12:00',
    breakMinutes: 0, enabled: true };
  const tx = {
    $queryRaw: async () => [],
    hrShiftTemplate: { findMany: async () => [template] },
    hrSchedulePoint: { findMany: async () => [] },
    hrSchedule: { create: async () => { creates++; } },
    auditLog: { create: async () => {} },
  };
  const service = new HrScheduleService({ $transaction: async (run) => run(tx) }, {
    assertStorePermission: async () => {},
  });

  await assert.rejects(service.createBatch({ id: 7 }, { storeId: 4, businessDate: tomorrow(),
    assignments: [{ employeeId: 3, shiftTemplateId: 11, pointId: 19 }] }), /point is disabled or belongs to another store/);
  assert.equal(creates, 0);
});
