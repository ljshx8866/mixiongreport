const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrOffboardingService } = require('../dist/hr/hr-offboarding.service');
const day = (value) => new Date(`${value}T00:00:00.000Z`);

async function withEnabled(run) {
  const old = process.env.HR_OFFBOARDING_ENABLED;
  process.env.HR_OFFBOARDING_ENABLED = 'true';
  try { await run(); } finally {
    if (old === undefined) delete process.env.HR_OFFBOARDING_ENABLED;
    else process.env.HR_OFFBOARDING_ENABLED = old;
  }
}

test('offboarding submission requires active appointment and opens configured approval', async () => {
  await withEnabled(async () => {
    const request = { id: 8n, status: 'SUBMITTED' };
    const persistedDeleteAccount = [];
    const tx = {
      $queryRaw: async () => [{ id: 3n }],
      hrEmployee: { findUnique: async () => ({ status: 'ACTIVE', userId: null }) },
      hrPrimaryAppointment: { findFirst: async () => ({ storeId: 2n }), count: async () => 0 },
      hrOffboardingRequest: { findFirst: async () => null,
        create: async ({ data }) => { assert.equal(data.revision, 1);
          persistedDeleteAccount.push(data.deleteAccountOnEffective); return request; } },
      hrTransferRequest: { count: async () => 0 },
      hrSchedule: { count: async () => 0 },
      hrWorkDaySegment: { count: async () => 0 },
      hrSalaryChangeRequest: { count: async () => 0 },
      hrBankChangeRequest: { count: async () => 0 },
      auditLog: { create: async () => {} },
    };
    const service = new HrOffboardingService({ $transaction: async (callback) => callback(tx) },
      { assertStorePermission: async (_user, code, storeId) => {
        assert.equal(code, 'HR_OFFBOARDING_REQUEST'); assert.equal(storeId, 2n);
      } }, { createForSubject: async (_tx, kind, subjectId) => {
        assert.equal(kind, 'OFFBOARDING'); assert.equal(subjectId, 8n);
      } });
    const result = await service.submit({ id: 5 }, { employeeId: 3, storeId: 2,
      effectiveDate: '2026-10-20', reason: '离职' });
    assert.equal(result.status, 'SUBMITTED');
    assert.equal(persistedDeleteAccount[0], true);
    await service.submit({ id: 5 }, { employeeId: 3, storeId: 2,
      effectiveDate: '2026-10-20', reason: '离职', deleteAccountOnEffective: false });
    assert.equal(persistedDeleteAccount[1], false);
  });
});

test('offboarding reports each blocking schedule or pending bank change in Chinese', async () => {
  await withEnabled(async () => {
    const tx = {
      $queryRaw: async () => [],
      hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
      hrPrimaryAppointment: { findFirst: async () => ({ storeId: 2n }), count: async () => 0 },
      hrOffboardingRequest: { findFirst: async () => null, create: async () => { throw new Error('must be blocked'); } },
      hrTransferRequest: { count: async () => 0 }, hrSchedule: { count: async () => 1 },
      hrWorkDaySegment: { count: async () => 0 }, hrSalaryChangeRequest: { count: async () => 0 },
      hrBankChangeRequest: { count: async () => 1 },
    };
    const service = new HrOffboardingService({ $transaction: async (callback) => callback(tx) },
      { assertStorePermission: async () => {} }, { createForSubject: async () => {} });
    await assert.rejects(service.submit({ id: 5 }, { employeeId: 3, storeId: 2,
      effectiveDate: '2026-10-20', reason: '离职' }), /离职生效日及之后的排班、待处理的银行卡变更申请/);
  });
});

test('rejected offboarding is corrected in place and restarts the approval round', async (t) => {
  const old = process.env.HR_OFFBOARDING_ENABLED;
  process.env.HR_OFFBOARDING_ENABLED = 'true';
  t.after(() => { if (old === undefined) delete process.env.HR_OFFBOARDING_ENABLED;
    else process.env.HR_OFFBOARDING_ENABLED = old; });
  const request = { id: 81n, employeeId: 3n, storeId: 2n, revision: 1, status: 'REJECTED',
    effectiveDate: day('2026-10-01'), reason: '原原因', deleteAccountOnEffective: false,
    appliedAt: null, failureCode: null };
  const audit = [];
  const tx = {
    $queryRaw: async () => [{ id: 81n }],
    hrOffboardingRequest: { findUnique: async () => request, count: async () => 0,
      update: async ({ data }) => Object.assign(request, data) },
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE', userId: null }) },
    hrPrimaryAppointment: { findFirst: async () => ({ storeId: 2n }) },
    hrTransferRequest: { count: async () => 0 }, hrSchedule: { count: async () => 0 },
    hrWorkDaySegment: { count: async () => 0 }, hrPrimaryAppointmentCount: {},
    hrSalaryChangeRequest: { count: async () => 0 }, hrBankChangeRequest: { count: async () => 0 },
    auditLog: { create: async ({ data }) => audit.push(data) },
  };
  tx.hrPrimaryAppointment.count = async () => 0;
  const restarts = [];
  const service = new HrOffboardingService({ hrOffboardingRequest: { findUnique: async () => request },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} },
  { restartForSubject: async (...args) => restarts.push(args.slice(1)) });
  const result = await service.resubmit({ id: 7 }, 81, { effectiveDate: '2026-10-22',
    reason: '补正原因', deleteAccountOnEffective: true });
  assert.deepEqual(result, { id: 81, status: 'SUBMITTED', revision: 2, effectiveDate: '2026-10-22' });
  assert.equal(request.id, 81n);
  assert.equal(request.revision, 2);
  assert.equal(request.reason, '补正原因');
  assert.equal(restarts[0][0], 'OFFBOARDING');
  assert.equal(restarts[0][1], 81n);
  assert.equal(restarts[0][3], 2);
  assert.equal(audit.at(-1).action, 'CORRECTION_RESUBMIT');
});

test('approved past offboarding closes appointment once and preserves historical employee row', async () => {
  const request = { id: 8n, employeeId: 3n, storeId: 2n, status: 'SUBMITTED',
    effectiveDate: new Date('2020-01-01T00:00:00.000Z'), deleteAccountOnEffective: true };
  const employee = { status: 'ACTIVE', userId: 7n };
  const appointment = { id: 11n, storeId: 2n, effectiveToExclusive: null };
  let loginDeleted = false;
  const tx = {
    $queryRaw: async () => [{ id: 8n }],
    hrOffboardingRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrEmployee: { findUnique: async () => employee,
      update: async ({ data }) => Object.assign(employee, data) },
    user: { findUnique: async () => ({ id: 7n, name: '员工', mobile: '13800000000',
      role: 'STORE_MANAGER', source: 'LOCAL', status: true }),
      delete: async () => { loginDeleted = true; } },
    userStore: { deleteMany: async () => ({ count: 0 }) },
    fillReminderRecipient: { deleteMany: async () => ({ count: 0 }) },
    storeDailyInput: { updateMany: async () => ({ count: 0 }) },
    hrPrimaryAppointment: { findFirst: async () => appointment,
      count: async () => 0, update: async ({ data }) => Object.assign(appointment, data) },
    hrTransferRequest: { count: async () => 0 },
      hrSchedule: { count: async () => 0 },
    hrWorkDaySegment: { count: async () => 0 },
    hrSalaryChangeRequest: { count: async () => 0 },
    hrBankChangeRequest: { count: async () => 0 },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => {}, updateMany: async () => ({ count: 0 }) },
  };
  const service = new HrOffboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.deepEqual(await service.finalize(8n), { id: 8, status: 'EFFECTIVE', accountDeleted: true });
  assert.equal((await service.finalize(8n)).status, 'EFFECTIVE');
  assert.equal(loginDeleted, true);
  assert.equal(employee.status, 'TERMINATED');
  assert.equal(appointment.effectiveToExclusive.toISOString().slice(0, 10), '2020-01-01');
});

test('offboarding cannot activate when future work appeared after approval', async () => {
  const request = { id: 8n, employeeId: 3n, storeId: 2n, status: 'SUBMITTED',
    effectiveDate: new Date('2020-01-01T00:00:00.000Z') };
  const tx = {
    $queryRaw: async () => [],
    hrOffboardingRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrPrimaryAppointment: { findFirst: async () => ({ id: 11n }), count: async () => 0,
      update: async () => { throw new Error('must not close appointment'); } },
    hrTransferRequest: { count: async () => 0 },
    hrSchedule: { count: async () => 1 },
    hrWorkDaySegment: { count: async () => 0 },
    hrSalaryChangeRequest: { count: async () => 0 },
    hrBankChangeRequest: { count: async () => 0 },
  };
  const service = new HrOffboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(8n)).status, 'EFFECTIVE_FAILED');
  assert.equal(request.failureCode, 'SOURCE_CHANGED');
});
