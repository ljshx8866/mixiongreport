const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException } = require('@nestjs/common');
const { HrApprovalInboxService } = require('../dist/hr/hr-approval-inbox.service');

const originalCryptoEnv = Object.fromEntries(['HR_DATA_ACTIVE_KEY_ID', 'HR_DATA_KEYS_JSON', 'HR_DATA_LOOKUP_KEY']
  .map((key) => [key, process.env[key]]));
const testKey = Buffer.alloc(32, 67).toString('base64');
process.env.HR_DATA_ACTIVE_KEY_ID = 'test';
process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: testKey });
process.env.HR_DATA_LOOKUP_KEY = testKey;
after(() => { for (const [key, value] of Object.entries(originalCryptoEnv)) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
} });

function fixture({ actorId = 7, requesterId = 8, canApprove = true } = {}) {
  const instance = {
    id: 51n, kind: 'ONBOARDING', subjectId: 41n, scopeStoreId: 4n,
    requestedBy: BigInt(requesterId), currentPosition: 1, status: 'PENDING',
    steps: [{ position: 1, roleId: 12n, decision: null, role: { name: '人事复核' } }],
  };
  const checks = [];
  const db = {
    hrApprovalInstance: { findMany: async () => [instance] },
    hrOnboardingRequest: { findMany: async () => [{ id: 41n, employeeId: 13n,
      employee: { displayName: '测试员工' }, effectiveDate: new Date('2026-10-20T00:00:00Z'),
      createdAt: new Date('2026-10-16T02:00:00Z'), status: 'SUBMITTED', failureCode: null }] },
    hrSensitiveDraftRevision: { findMany: async () => [] },
    auditLog: { create: async () => {} },
  };
  const access = {
    currentAccess: async () => ({ stores: [{ id: 4, storeName: '山大店',
      permissionCodes: ['HR_ONBOARDING_APPROVE', 'HR_APPROVAL_DETAIL_READ', 'HR_EMPLOYEE_SENSITIVE_READ'] }] }),
    assertWorkflowRolePermission: async (...args) => {
      checks.push(args);
      if (!canApprove) throw new ForbiddenException('role not assigned');
    },
  };
  return { service: new HrApprovalInboxService(db, access), user: { id: actorId }, checks };
}

test('approval inbox exposes pending approvals with status and actionable metadata', async () => {
  const { service, user, checks } = fixture();
  const result = await service.list(user);

  assert.equal(result.length, 1);
  const { details, ...summary } = result[0];
  assert.deepEqual(summary, {
    id: 51, kind: 'ONBOARDING', subjectId: 41, storeId: 4, storeName: '山大店',
    employeeName: '测试员工', label: '员工入职：2026-10-20',
    submittedAt: '2026-10-16T02:00:00.000Z', currentPosition: 1,
    totalSteps: 1, roleName: '人事复核', status: 'PENDING', canDecide: true,
    businessStatus: 'SUBMITTED', failureCode: null, rejectionReason: null,
  });
  assert.ok(details.some(({ label }) => label === '身份证号'));
  assert.equal(Object.hasOwn(result[0], 'identityMask'), false);
  assert.equal(Object.hasOwn(result[0], 'bankMask'), false);
  assert.equal(checks[0][3], 12n);
});

test('approval inbox checks each store role permission once when many records share a workflow step', async () => {
  const { service, user, checks } = fixture();
  service.db.hrApprovalInstance.findMany = async () => [
    { id: 51n, kind: 'ONBOARDING', subjectId: 41n, scopeStoreId: 4n,
      requestedBy: 8n, currentPosition: 1, status: 'PENDING',
      steps: [{ position: 1, roleId: 12n, decision: null, role: { name: '人事复核' } }] },
    { id: 52n, kind: 'ONBOARDING', subjectId: 42n, scopeStoreId: 4n,
      requestedBy: 9n, currentPosition: 1, status: 'PENDING',
      steps: [{ position: 1, roleId: 12n, decision: null, role: { name: '人事复核' } }] },
  ];
  service.db.hrOnboardingRequest.findMany = async () => [41n, 42n].map((id) => ({ id,
    employee: { displayName: '测试员工' }, effectiveDate: new Date('2026-10-20T00:00:00Z'),
    createdAt: new Date('2026-10-16T02:00:00Z'), status: 'SUBMITTED', failureCode: null }));
  const result = await service.list(user);
  assert.equal(result.length, 2);
  assert.equal(checks.length, 1);
});

test('approval inbox retains records that the user cannot decide', async () => {
  const requester = fixture({ actorId: 8, requesterId: 8 });
  assert.equal((await requester.service.list(requester.user))[0].canDecide, false);

  const wrongRole = fixture({ canApprove: false });
  assert.equal((await wrongRole.service.list(wrongRole.user))[0].canDecide, false);
});

test('approval inbox includes completed workflow records with the final status', async () => {
  const { service, user } = fixture();
  const db = service.db;
  db.hrApprovalInstance.findMany = async () => [{
    id: 52n, kind: 'ONBOARDING', subjectId: 41n, scopeStoreId: 4n,
    requestedBy: 8n, currentPosition: null, status: 'APPROVED',
    steps: [{ position: 1, roleId: 12n, decision: 'APPROVE', role: { name: '人事复核' } }],
  }];

  const result = await service.list(user);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'APPROVED');
  assert.equal(result[0].businessStatus, 'SUBMITTED');
  assert.equal(result[0].canDecide, false);
  assert.equal(result[0].roleName, '人事复核');
});

test('approval inbox keeps approval decision separate from failed onboarding effectiveness', async () => {
  const { service, user } = fixture();
  service.db.hrApprovalInstance.findMany = async () => [{
    id: 53n, kind: 'ONBOARDING', subjectId: 41n, scopeStoreId: 4n,
    requestedBy: 8n, currentPosition: null, status: 'APPROVED',
    steps: [{ position: 1, roleId: 12n, decision: 'APPROVE', role: { name: '人事复核' } }],
  }];
  service.db.hrOnboardingRequest.findMany = async () => [{ id: 41n,
    employee: { displayName: '测试员工' }, effectiveDate: new Date('2026-10-20T00:00:00Z'),
    createdAt: new Date('2026-10-16T02:00:00Z'), status: 'EFFECTIVE_FAILED', failureCode: 'PHONE_REQUIRED' }];

  const [item] = await service.list(user);
  assert.equal(item.status, 'APPROVED');
  assert.equal(item.businessStatus, 'EFFECTIVE_FAILED');
  assert.equal(item.failureCode, 'PHONE_REQUIRED');
});

test('approval inbox rejects a store outside the actor scope', async () => {
  const { service, user } = fixture();
  await assert.rejects(service.list(user, '99'), ForbiddenException);
});
