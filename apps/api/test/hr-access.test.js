const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrAccessService } = require('../dist/hr/hr-access.service');

const actor = { id: 7, role: 'ADMIN', storeIds: [11, 12] };
const grant = () => ({
  active: true,
  role: { enabled: true, name: '区域经理', showStoreSwitcher: false, permissions: [{ permissionCode: 'HR_EMPLOYEE_READ' }] },
});

test('HR role grants use the report UserStore scope as their only store scope', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  let currentGrants = [grant()];
  let accountReads = 0;
  const service = new HrAccessService({
    user: { findUnique: async () => { accountReads++; return { status: true,
      stores: [{ storeId: 11n }], hrRoleGrants: currentGrants }; } },
    store: { findUnique: async ({ where }) => ({ id: where.id, regionId: 2n }) },
  });
  try {
    assert.equal((await service.assertStorePermission(actor, 'HR_EMPLOYEE_READ', 11n)).id, 11n);
    await assert.rejects(service.assertStorePermission(actor, 'HR_EMPLOYEE_READ', 12n), /HR access denied/);
    currentGrants = [];
    await assert.rejects(service.assertStorePermission(actor, 'HR_EMPLOYEE_READ', 11n), /HR access denied/);
    assert.equal(accountReads, 3);
    currentGrants = [grant()];
    await assert.rejects(service.assertStorePermission(actor, 'HR_EMPLOYEE_READ', 12n), /HR access denied/);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('HR service rejects API keys, disabled accounts and missing permissions', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  let account = { status: false, stores: [{ storeId: 11n }], hrRoleGrants: [grant()] };
  const service = new HrAccessService({
    user: { findUnique: async () => account },
    store: { findUnique: async () => ({ id: 11n, regionId: null }) },
  });
  try {
    await assert.rejects(service.assertStorePermission({ ...actor, id: null, system: true }, 'HR_EMPLOYEE_READ', 11n), /user account/);
    await assert.rejects(service.assertStorePermission(actor, 'HR_EMPLOYEE_READ', 11n), /HR access denied/);
    account = { status: true, stores: [{ storeId: 11n }], hrRoleGrants: [grant()] };
    await assert.rejects(service.assertStorePermission(actor, 'HR_EMPLOYEE_WRITE', 11n), /HR access denied/);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('current HR access lists only active stores and currently granted permissions', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  let account = { status: true, role: 'STORE_MANAGER', source: 'POS',
    stores: [{ storeId: 11n }, { storeId: 12n }], hrRoleGrants: [grant()] };
  const service = new HrAccessService({
    user: { findUnique: async () => account },
    store: { findMany: async () => [
      { id: 11n, storeName: 'A' },
      { id: 12n, storeName: 'B' },
      { id: 13n, storeName: 'C' },
    ] },
  });
  try {
    assert.deepEqual(await service.currentAccess({ id: 7, role: 'STORE_MANAGER' }), {
      canConfigure: false, isEmployee: false, roleNames: ['区域经理'], showStoreSwitcher: false,
      stores: [
        { id: 11, storeName: 'A', permissionCodes: ['HR_EMPLOYEE_LIST_READ', 'HR_EMPLOYEE_DETAIL_READ', 'HR_EMPLOYEE_SENSITIVE_READ', 'HR_EMPLOYEE_READ'] },
        { id: 12, storeName: 'B', permissionCodes: ['HR_EMPLOYEE_LIST_READ', 'HR_EMPLOYEE_DETAIL_READ', 'HR_EMPLOYEE_SENSITIVE_READ', 'HR_EMPLOYEE_READ'] },
      ],
    });
    account.hrRoleGrants = [{ ...grant(), role: { ...grant().role, showStoreSwitcher: true } }];
    assert.equal((await service.currentAccess({ id: 7, role: 'STORE_MANAGER' })).showStoreSwitcher, true);
    account = { status: true, role: 'ADMIN', source: 'POS',
      stores: [{ storeId: 11n }], hrRoleGrants: [{ ...grant(), active: false }] };
    assert.deepEqual(await service.currentAccess({ id: 7 }), { canConfigure: true, isEmployee: false, roleNames: [], showStoreSwitcher: false, stores: [] });
    account.status = false;
    await assert.rejects(service.currentAccess({ id: 7 }), /HR access denied/);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('monthly readers may hold submit, approve or export permission independently', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  const service = new HrAccessService({
    user: { findUnique: async () => ({ status: true, stores: [{ storeId: 11n }], hrRoleGrants: [{
      ...grant(),
      role: { enabled: true, permissions: [{ permissionCode: 'HR_MONTH_APPROVE' }] },
    }] }) },
    store: { findUnique: async () => ({ id: 11n, regionId: null }) },
  });
  try {
    await service.assertAnyStorePermission({ id: 7 },
      ['HR_MONTH_SUBMIT', 'HR_MONTH_APPROVE', 'HR_MONTH_EXPORT'], 11n);
    await assert.rejects(service.assertStorePermission({ id: 7 }, 'HR_MONTH_SUBMIT', 11n), /HR access denied/);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('active linked employee receives self-service schedule scope without store management permissions', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database'; process.env.HR_FEATURES_ENABLED = 'true';
  const service = new HrAccessService({
    user: { findUnique: async () => ({ status: true, role: 'STORE_MANAGER', stores: [], hrRoleGrants: [],
      hrEmployee: { status: 'ACTIVE', primaryAppointments: [{ storeId: 11n }] } }) },
    store: { findMany: async () => [
      { id: 11n, storeName: 'Assigned', regionId: 2n }, { id: 12n, storeName: 'Other', regionId: 2n },
    ] },
  });
  try {
    assert.deepEqual(await service.currentAccess({ id: 55, role: 'STORE_MANAGER' }), {
      canConfigure: false, isEmployee: true, roleNames: [], showStoreSwitcher: false,
      stores: [{ id: 11, storeName: 'Assigned', permissionCodes: ['HR_SCHEDULE_LIST_READ', 'HR_MY_PROFILE_READ', 'HR_MY_SCHEDULE_READ', 'HR_MY_WORK_READ', 'HR_SCHEDULE_READ'] }],
    });
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE; else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED; else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('an employee self-service account cannot use store-scoped HR management endpoints', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database'; process.env.HR_FEATURES_ENABLED = 'true';
  const service = new HrAccessService({
    user: { findUnique: async () => ({ status: true, stores: [], hrRoleGrants: [],
      hrEmployee: { status: 'ACTIVE', primaryAppointments: [{ storeId: 11n }] } }) },
    store: { findUnique: async ({ where }) => ({ id: where.id, regionId: null }) },
  });
  try {
    await assert.rejects(service.assertStorePermission({ id: 55 }, 'HR_SCHEDULE_READ', 11n), /HR access denied/);
    await assert.rejects(service.assertStorePermission({ id: 55 }, 'HR_TIME_CONFIRM', 11n), /HR access denied/);
    await assert.rejects(service.assertStorePermission({ id: 55 }, 'HR_SCHEDULE_READ', 12n), /HR access denied/);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE; else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED; else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});
