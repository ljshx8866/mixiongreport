const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException } = require('@nestjs/common');
const { HrApprovalService } = require('../dist/hr/hr-approval.service');

test('a request copies its configured approval roles and version', async () => {
  let created;
  const tx = {
    $queryRaw: async () => [],
    hrApprovalWorkflow: { findUnique: async () => ({ version: 4, steps: [
      { position: 1, roleId: 11n, role: { enabled: true } },
      { position: 2, roleId: 12n, role: { enabled: true } },
    ] }) },
    hrApprovalInstance: { create: async ({ data }) => { created = data; return { id: 3n }; } },
  };
  const service = new HrApprovalService({}, {});
  await service.createForSubject(tx, 'MONTHLY_REVIEW', 77n, 2n, 5n);
  assert.equal(created.workflowVersion, 4);
  assert.deepEqual(created.steps.create.map((item) => item.roleId), [11n, 12n]);
});

test('requester cannot approve their own adjustment even with matching role', async () => {
  let accessChecked = false;
  const service = new HrApprovalService({
    hrApprovalInstance: { findUnique: async () => ({
      status: 'PENDING', currentPosition: 1, requestedBy: 5n, scopeStoreId: 2n,
      kind: 'SALARY_CHANGE', steps: [{ position: 1, roleId: 11n, decision: null }],
    }) },
  }, { assertWorkflowRolePermission: async () => { accessChecked = true; } });
  await assert.rejects(service.decide({ id: 5 }, 7n, 'APPROVE', ''), /\u7533\u8bf7\u4eba\u4e0d\u80fd\u5ba1\u6279\u672c\u4eba\u63d0\u4ea4\u7684\u7533\u8bf7/);
  assert.equal(accessChecked, false);
});

test('only the current snapshotted role can advance an approval', async () => {
  const checked = [];
  const notices = [];
  const current = {
    kind: 'TIME_CORRECTION', subjectId: 19n, status: 'PENDING', currentPosition: 1,
    requestedBy: 5n, scopeStoreId: 2n,
    steps: [{ position: 1, roleId: 11n, decision: null }, { position: 2, roleId: 12n, decision: null }],
  };
  const tx = {
    $queryRaw: async () => [],
    hrApprovalInstance: {
      findUnique: async () => current,
      update: async ({ data }) => Object.assign(current, data),
    },
    hrApprovalInstanceStep: { update: async ({ where, data }) => Object.assign(
      current.steps.find((item) => item.position === where.instanceId_position.position), data,
    ) },
    userNotification: { createMany: async ({ data }) => { notices.push(...data); return { count: data.length }; } },
    auditLog: { create: async () => {} },
  };
  const db = { hrApprovalInstance: { findUnique: async () => current }, $transaction: async (run) => run(tx) };
  const service = new HrApprovalService(db, {
    assertWorkflowRolePermission: async (_user, permission, storeId, roleId) => checked.push({ permission, storeId, roleId }),
  });
  const first = await service.decide({ id: 6 }, 7n, 'APPROVE', 'ok');
  assert.equal(first.nextPosition, 2);
  assert.equal(checked[0].roleId, 11n);
  const second = await service.decide({ id: 7 }, 7n, 'APPROVE', 'ok');
  assert.equal(second.status, 'APPROVED');
  assert.equal(checked[1].roleId, 12n);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].userId, 5n);
  assert.equal(notices[0].category, 'RESULT');
  await assert.rejects(service.decide({ id: 6 }, 7n, 'APPROVE', ''), /\u8be5\u5ba1\u6279\u5df2\u5904\u7406\u6216\u5df2\u53d8\u5316/);
});

test('a missing current workflow role grant explains which role and shared store access are required', async () => {
  const service = new HrApprovalService({ hrApprovalInstance: { findUnique: async () => ({
    status: 'PENDING', currentPosition: 1, requestedBy: 5n, scopeStoreId: 2n,
    kind: 'ONBOARDING', steps: [{ position: 1, roleId: 11n, role: { name: '人事审批' }, decision: null }],
  }) } }, { assertWorkflowRolePermission: async () => { throw new ForbiddenException('HR access denied'); } });
  await assert.rejects(service.decide({ id: 6 }, 7n, 'APPROVE', ''), /人事审批.*管理门店/);
});
