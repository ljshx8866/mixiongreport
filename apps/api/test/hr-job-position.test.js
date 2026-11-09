const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { HrJobPositionService } = require('../dist/hr/hr-job-position.service');

const previous = { reportSource: process.env.REPORT_SOURCE, hrEnabled: process.env.HR_FEATURES_ENABLED };
function enable() { process.env.REPORT_SOURCE = 'database'; process.env.HR_FEATURES_ENABLED = 'true'; }
function restore() {
  if (previous.reportSource === undefined) delete process.env.REPORT_SOURCE; else process.env.REPORT_SOURCE = previous.reportSource;
  if (previous.hrEnabled === undefined) delete process.env.HR_FEATURES_ENABLED; else process.env.HR_FEATURES_ENABLED = previous.hrEnabled;
}

test('one reusable position can be linked to multiple stores with independent hourly rates', async () => {
  enable();
  const audits = [];
  const permissionCalls = [];
  const storeNames = new Map([[4n, '清控店'], [9n, '高新店']]);
  const db = {
    user: { findUnique: async () => ({ id: 9n, role: 'ADMIN', status: true }) },
    store: { findMany: async ({ where }) => where.id.in.filter((id) => storeNames.has(id)).map((id) => ({ id })) },
    hrJobPosition: { findMany: async ({ where }) => {
      const id = where.stores.some.storeId;
      assert.equal('enabled' in where, false, 'the shared position table has no global enabled column');
      return [{ id: 12n, name: '店长', scheduleOnly: false, enabled: true,
        stores: [{ hourlyRate: new Prisma.Decimal(id === 4n ? '24.00' : '26.50') }] }];
    } },
    $transaction: async (callback) => callback({
      hrJobPosition: { create: async ({ data }) => ({ id: 12n, name: data.name, scheduleOnly: data.scheduleOnly, enabled: true,
        createdAt: new Date('2026-10-20T00:00:00.000Z'), updatedAt: new Date('2026-10-20T00:00:00.000Z'),
        stores: data.stores.create.map((link) => ({ storeId: link.storeId, hourlyRate: link.hourlyRate,
          enabled: true, store: { id: link.storeId, storeName: storeNames.get(link.storeId) } })) }) },
      auditLog: { create: async ({ data }) => audits.push(data) },
    }),
  };
  const access = {
    assertStorePermission: async (...args) => permissionCalls.push(args),
    assertAnyStorePermission: async (_user, permissions, storeId) => permissionCalls.push([permissions, storeId]),
  };
  const service = new HrJobPositionService(db, access);
  try {
    const created = await service.create({ id: 9 }, { name: '店长', storeIds: [4, 9], storeRates: [
      { storeId: 4, hourlyRate: '24.00' }, { storeId: 9, hourlyRate: '26.50' },
    ] });
    assert.equal(created.id, 12);
    assert.equal(created.scheduleOnly, false);
    assert.deepEqual(created.stores.map((store) => [store.id, store.storeName, store.hourlyRate]), [
      [4, '清控店', '24.00'], [9, '高新店', '26.50'],
    ]);
    assert.equal(audits[0].action, 'CREATE');
    assert.equal(audits[0].afterData.stores.length, 2);
    assert.deepEqual(await service.selectable({ id: 3 }, 4), [{ id: 12, name: '店长', scheduleOnly: false, hourlyRate: '24.00' }]);
    assert.deepEqual(permissionCalls, [
      [['HR_EMPLOYEE_EDIT', 'HR_ONBOARDING_CREATE'], 4n],
      [['HR_JOB_POSITION_READ', 'HR_ONBOARDING_CREATE'], 4n],
    ]);
    await assert.rejects(service.create({ id: 9 }, { name: '兼职', storeIds: [4, 9],
      storeRates: [{ storeId: 4, hourlyRate: '24.00' }] }), /each selected store/);
    const scheduleOnly = await service.create({ id: 9 }, { name: '月薪管理岗', storeIds: [4], scheduleOnly: true });
    assert.equal(scheduleOnly.scheduleOnly, true);
    assert.equal(scheduleOnly.stores[0].hourlyRate, null);
  } finally { restore(); }
});

test('an administrator can delete a shared position and audit its store links', async () => {
  enable();
  const audits = [];
  let deleted = false;
  const db = {
    user: { findUnique: async () => ({ id: 9n, role: 'ADMIN', status: true }) },
    $transaction: async (callback) => callback({
      hrJobPosition: {
        findUnique: async () => ({ id: 12n, name: '店长', stores: [
          { storeId: 4n, hourlyRate: new Prisma.Decimal('24.00'), store: { storeName: '清控店' } },
          { storeId: 9n, hourlyRate: new Prisma.Decimal('26.50'), store: { storeName: '高新店' } },
        ] }),
        delete: async ({ where }) => { deleted = where.id === 12n; },
      },
      auditLog: { create: async ({ data }) => audits.push(data) },
    }),
  };
  const service = new HrJobPositionService(db, {});
  try {
    assert.deepEqual(await service.remove({ id: 9 }, 12), { deleted: true, id: 12 });
    assert.equal(deleted, true);
    assert.equal(audits[0].action, 'DELETE');
    assert.deepEqual(audits[0].beforeData.stores.map((store) => store.name), ['清控店', '高新店']);
    await assert.rejects(new HrJobPositionService({ user: { findUnique: async () => ({ id: 7n, role: 'STORE_MANAGER', status: true }) } }, {})
      .listForAdmin({ id: 7 }), /Administrator is required/);
  } finally { restore(); }
});
