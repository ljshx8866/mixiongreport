const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrEmployeeController } = require('../dist/hr/hr-employee.controller');

test('an authorized manager can link an existing same-store account without changing its role or store scope', async () => {
  const employee = { id: 11n, displayName: '王小明', status: 'ACTIVE', userId: null, initialStoreId: 4n };
  const calls = [];
  let employeeUpdate;
  let audit;
  const tx = {
    $queryRaw: async () => [],
    hrEmployee: {
      findUnique: async ({ where }) => where.userId
        ? null : { id: employee.id, displayName: employee.displayName, status: employee.status, userId: employee.userId },
      update: async ({ data }) => { employeeUpdate = data; return { ...employee, ...data }; },
    },
    user: { findUnique: async () => ({ id: 22n, status: true, mobile: '13800000000',
      role: 'STORE_MANAGER', stores: [{ storeId: 4n }] }) },
    hrSensitiveDraftRevision: { findFirst: async () => null },
    auditLog: { create: async ({ data }) => { audit = data; } },
  };
  const db = {
    hrEmployee: { findUnique: async () => employee },
    hrPrimaryAppointment: { findFirst: async () => null },
    $transaction: async (run) => run(tx),
  };
  const access = { assertStorePermission: async (...args) => calls.push(args) };
  const controller = new HrEmployeeController(db, access);

  const result = await controller.linkAccount({ user: { id: 7, role: 'STORE_MANAGER', storeIds: [4] } }, 11, { userId: 22 });

  assert.deepEqual(result, { employeeId: 11, userId: 22, unchanged: false });
  assert.deepEqual(employeeUpdate, { userId: 22n });
  assert.equal(calls[0][1], 'HR_EMPLOYEE_ACCOUNT_LINK');
  assert.equal(calls[0][2], 4n);
  assert.equal(audit.action, 'LINK_ACCOUNT');
  assert.equal(audit.afterData.accountRoleAndStoreScopeChanged, false);
});
