const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrRoleAdminController } = require('../dist/hr/hr-role-admin.controller');

const request = { user: { id: 1, role: 'ADMIN', storeIds: [] } };

test('role creation requires only a name and generates its role number', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  let created, audit;
  const controller = new HrRoleAdminController({
    user: { findUnique: async () => ({ id: 1n, role: 'ADMIN', status: true }) },
    hrRole: { findUnique: async () => null },
    $transaction: async (run) => run({
      hrRole: {
        create: async ({ data }) => { created = data; return { id: 2n, ...data }; },
        findUnique: async () => null,
        update: async ({ where, data }) => ({ id: where.id, ...created, ...data }),
      },
      auditLog: { create: async ({ data }) => { audit = data; } },
    }),
  });
  try {
    assert.deepEqual(await controller.createRole(request, { name: '人事总监' }), {
      id: 2, code: 'HR-0002', name: '人事总监', enabled: true, onboardingAssignable: false,
      participatesInScheduling: true, showStoreSwitcher: false,
    });
    assert.match(created.code, /^PENDING_[A-F0-9]{32}$/);
    assert.equal(created.name.length > 0, true);
    assert.equal(audit.afterData.code, 'HR-0002');
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('only an active administrator may configure HR roles regardless of account source', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  let active = true;
  const controller = new HrRoleAdminController({
    user: { findUnique: async () => ({ id: 1n, role: 'ADMIN', source: 'POS', status: active }) },
  });
  try {
    const permissions = await controller.permissions(request);
    assert.ok(permissions.some((item) => item.code === 'HR_TRANSFER_APPROVE_HR'));
    active = false;
    await assert.rejects(controller.permissions(request), /Administrator is required/);
    await assert.rejects(controller.permissions({ user: { id: null, system: true } }), /Administrator is required/);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('administrator controls which HR roles are selectable during onboarding approval', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  const current = { id: 8n, name: '人事经理', enabled: true, onboardingAssignable: false,
    participatesInScheduling: true, showStoreSwitcher: false };
  let saved, audited;
  const controller = new HrRoleAdminController({
    user: { findUnique: async () => ({ id: 1n, role: 'ADMIN', status: true }) },
    hrRole: { findUnique: async () => current },
    $transaction: async (run) => run({
      hrRole: { update: async ({ data }) => { saved = data; return { ...current, ...data }; } },
      auditLog: { create: async ({ data }) => { audited = data; } },
    }),
  });
  try {
    assert.deepEqual(await controller.updateRole(request, 8, { onboardingAssignable: true }), {
      id: 8, name: '人事经理', enabled: true, onboardingAssignable: true,
      participatesInScheduling: true, showStoreSwitcher: false,
    });
    assert.deepEqual(saved, { name: '人事经理', enabled: true, onboardingAssignable: true,
      participatesInScheduling: true, showStoreSwitcher: false });
    assert.equal(audited.afterData.onboardingAssignable, true);
    assert.equal(audited.afterData.participatesInScheduling, true);
    const disabled = await controller.updateRole(request, 8, { participatesInScheduling: false });
    assert.equal(disabled.participatesInScheduling, false);
    assert.equal(saved.participatesInScheduling, false);
    const enabled = await controller.updateRole(request, 8, { showStoreSwitcher: true });
    assert.equal(enabled.showStoreSwitcher, true);
    assert.equal(saved.showStoreSwitcher, true);
    assert.equal(audited.afterData.showStoreSwitcher, true);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('role permission replacement reports missing permission dictionary rows instead of a database foreign-key error', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  const controller = new HrRoleAdminController({
    user: { findUnique: async () => ({ id: 1n, role: 'ADMIN', status: true }) },
    hrPermission: { findMany: async () => [] },
    $transaction: async () => { throw new Error('permission save should not start'); },
  });
  try {
    await assert.rejects(controller.replaceRolePermissions(request, 8, {
      permissionCodes: ['HR_DAILY_REPORT_READ'],
    }), /系统权限字典缺少以下权限：HR_DAILY_REPORT_READ/);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('saving role permissions only replaces known codes and preserves unknown future grants', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  let deleteWhere, created;
  const controller = new HrRoleAdminController({
    user: { findUnique: async () => ({ id: 1n, role: 'ADMIN', status: true }) },
    hrPermission: { findMany: async ({ where }) => where.code.in.map((code) => ({ code })) },
    hrRole: { findUnique: async () => ({ id: 8n, permissions: [
      { permissionCode: 'HR_EMPLOYEE_READ' }, { permissionCode: 'FUTURE_MODULE_ACTION' },
    ] }) },
    $transaction: async (run) => run({
      hrRolePermission: {
        deleteMany: async ({ where }) => { deleteWhere = where; },
        createMany: async ({ data }) => { created = data; },
      },
      auditLog: { create: async () => {} },
    }),
  });
  try {
    await controller.replaceRolePermissions(request, 8, { permissionCodes: ['HR_DAILY_REPORT_READ'] });
    assert.equal(deleteWhere.roleId, 8n);
    assert.ok(deleteWhere.permissionCode.in.includes('HR_EMPLOYEE_READ'));
    assert.ok(deleteWhere.permissionCode.in.includes('HR_DAILY_REPORT_READ'));
    assert.equal(deleteWhere.permissionCode.in.includes('FUTURE_MODULE_ACTION'), false);
    assert.deepEqual(created, [{ roleId: 8n, permissionCode: 'HR_DAILY_REPORT_READ' }]);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('role editor preselects equivalent new leaves for existing legacy grants', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  const controller = new HrRoleAdminController({
    user: { findUnique: async () => ({ id: 1n, role: 'ADMIN', status: true }) },
    hrRole: { findMany: async () => [{
      id: 8n, code: 'HR-0008', name: '老角色', enabled: true,
      onboardingAssignable: false, participatesInScheduling: true, showStoreSwitcher: false,
      permissions: [
        { permissionCode: 'HR_EMPLOYEE_READ' },
        { permissionCode: 'HR_SCHEDULE_READ' },
        { permissionCode: 'FUTURE_MODULE_ACTION' },
      ],
    }] },
  });
  try {
    const [role] = await controller.roles(request);
    assert.ok(role.permissionCodes.includes('HR_EMPLOYEE_LIST_READ'));
    assert.ok(role.permissionCodes.includes('HR_EMPLOYEE_SENSITIVE_READ'));
    assert.ok(role.permissionCodes.includes('HR_SCHEDULE_LIST_READ'));
    assert.ok(role.permissionCodes.includes('HR_SHIFT_TEMPLATE_READ'));
    assert.equal(role.permissionCodes.includes('FUTURE_MODULE_ACTION'), false);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});

test('role grants attach capabilities to an account and reject a second store scope', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousEnabled = process.env.HR_FEATURES_ENABLED;
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_FEATURES_ENABLED = 'true';
  let savedGrant, audit;
  const controller = new HrRoleAdminController({
    user: { findUnique: async ({ where }) => where.id === 1n
      ? { id: 1n, role: 'ADMIN', source: 'POS', status: true }
      : { status: true } },
    hrRole: { findUnique: async () => ({ enabled: true }) },
    $transaction: async (run) => run({
      hrRoleGrant: { upsert: async (input) => { savedGrant = input; return { id: 9n, active: true }; } },
      auditLog: { create: async ({ data }) => { audit = data; } },
    }),
  });
  try {
    assert.deepEqual(await controller.grant(request, { userId: 2, roleId: 3 }), { id: 9, active: true });
    assert.deepEqual(savedGrant.where, { userId_roleId: { userId: 2n, roleId: 3n } });
    assert.deepEqual(savedGrant.create, { userId: 2n, roleId: 3n });
    assert.equal(audit.afterData.roleScope, 'ACCOUNT');
    await assert.rejects(controller.grant(request, {
      userId: 2, roleId: 3, scopeKind: 'STORE', scopeId: 99,
    }), /门店范围只在账号/);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = previousEnabled;
  }
});
