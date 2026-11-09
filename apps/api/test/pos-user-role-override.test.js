const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SyncService } = require('../dist/sync.service');

test('POS user sync keeps the locally assigned account role', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  process.env.REPORT_SOURCE = 'database';
  try {
    const existing = { id: 11n, name: '原 POS 姓名', mobile: '13800138000', role: 'ADMIN',
      status: true, source: 'POS', externalUserId: 'POS-USER-1', externalUserCode: 'EMP-1',
      externalDutyName: '门店员工', localRoleOverride: true, stores: [{ storeId: 3n }, { storeId: 4n }] };
    let accountUpdate;
    let auditAfter;
    let storeScopeWrites = 0;
    const tx = {
      user: {
        findMany: async ({ where }) => where.OR ? [existing] : [],
        update: async ({ data }) => {
          accountUpdate = data;
          return { ...existing, ...data };
        },
        create: async () => { throw new Error('the existing POS user should be updated'); },
      },
      userStore: {
        deleteMany: async () => { storeScopeWrites++; return {}; },
        createMany: async () => { storeScopeWrites++; return {}; },
      },
      auditLog: { create: async ({ data }) => { auditAfter = data.afterData; } },
    };
    const service = new SyncService({
      store: { findMany: async () => [{ id: 3n, externalStoreCode: 'POS-STORE-3', status: true }] },
      $transaction: async (callback) => callback(tx),
    });
    service.posClient = {
      employees: async () => [{ id: 'ARCHIVE-1', code: 'EMP-1', name: 'POS 新姓名',
        cellphone: '13800138000', dutyName: '门店主管' }],
      employeeAccessShops: async () => [{ id: 'POS-USER-1', code: 'EMP-1', name: 'POS 新姓名',
        isEnable: true, isAdmin: false, authAccessShopList: [{ id: 'POS-STORE-3' }] }],
    };

    const result = await service.syncUsers();

    assert.equal(result.updated, 1);
    assert.equal(Object.hasOwn(accountUpdate, 'role'), false);
    assert.equal(accountUpdate.name, 'POS 新姓名');
    assert.equal(auditAfter.role, 'ADMIN');
    assert.equal(auditAfter.localRoleOverride, true);
    assert.equal(storeScopeWrites, 0);
    assert.deepEqual(auditAfter.storeIds, [3, 4]);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
  }
});
