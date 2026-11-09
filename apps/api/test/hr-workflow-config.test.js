const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrRoleAdminController } = require('../dist/hr/hr-role-admin.controller');

const request = { user: { id: 1, role: 'ADMIN' } };

test('workflow can be configured only with roles allowed to approve that kind', async () => {
  const oldEnabled = process.env.HR_FEATURES_ENABLED;
  const oldSource = process.env.REPORT_SOURCE;
  process.env.HR_FEATURES_ENABLED = 'true';
  process.env.REPORT_SOURCE = 'database';
  const roles = [{ id: 8n, enabled: true, permissions: [{ permissionCode: 'HR_MONTH_APPROVE' }] }];
  const db = {
    user: { findUnique: async () => ({ id: 1n, status: true, role: 'ADMIN', source: 'LOCAL' }) },
    hrRole: { findMany: async () => roles },
  };
  try {
    const controller = new HrRoleAdminController(db);
    await assert.rejects(controller.replaceWorkflow(request, 'SALARY_CHANGE', {
      expectedVersion: 0, roleIds: [8],
    }), /required permission/);
    await assert.rejects(controller.replaceWorkflow(request, 'MONTHLY_REVIEW', {
      expectedVersion: 0, roleIds: [],
    }), /1 to 10/);
  } finally {
    if (oldEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = oldEnabled;
    if (oldSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = oldSource;
  }
});

test('workflow replacement checks version under lock and audits the role sequence', async () => {
  const oldEnabled = process.env.HR_FEATURES_ENABLED;
  const oldSource = process.env.REPORT_SOURCE;
  process.env.HR_FEATURES_ENABLED = 'true';
  process.env.REPORT_SOURCE = 'database';
  let version = 2;
  const savedSteps = [{ roleId: 7n }];
  const audit = [];
  const tx = {
    hrApprovalWorkflow: {
      upsert: async () => {},
      findUnique: async () => ({ version, steps: savedSteps.map((step) => ({ ...step })) }),
      update: async () => ({ version: ++version }),
    },
    $queryRaw: async () => [],
    hrApprovalWorkflowStep: {
      deleteMany: async () => {},
      createMany: async ({ data }) => savedSteps.splice(0, savedSteps.length, ...data),
    },
    auditLog: { create: async ({ data }) => audit.push(data) },
  };
  const db = {
    user: { findUnique: async () => ({ id: 1n, status: true, role: 'ADMIN', source: 'LOCAL' }) },
    hrRole: { findMany: async () => [{ id: 8n, enabled: true, permissions: [{ permissionCode: 'HR_MONTH_APPROVE' }] }] },
    $transaction: async (run) => run(tx),
  };
  try {
    const controller = new HrRoleAdminController(db);
    await assert.rejects(controller.replaceWorkflow(request, 'MONTHLY_REVIEW', {
      expectedVersion: 1, roleIds: [8],
    }), /Workflow changed/);
    assert.equal(savedSteps[0].roleId, 7n);
    const result = await controller.replaceWorkflow(request, 'MONTHLY_REVIEW', {
      expectedVersion: 2, roleIds: [8],
    });
    assert.equal(result.version, 3);
    assert.equal(savedSteps[0].roleId, 8n);
    assert.deepEqual(audit[0].beforeData.roleIds, ['7']);
    assert.deepEqual(audit[0].afterData.roleIds, ['8']);
  } finally {
    if (oldEnabled === undefined) delete process.env.HR_FEATURES_ENABLED;
    else process.env.HR_FEATURES_ENABLED = oldEnabled;
    if (oldSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = oldSource;
  }
});
