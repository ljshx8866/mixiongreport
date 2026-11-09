const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { HrSalaryService } = require('../dist/hr/hr-salary.service');

async function withEnabled(run) {
  const old = process.env.HR_SALARY_ENABLED;
  process.env.HR_SALARY_ENABLED = 'true';
  try { await run(); } finally {
    if (old === undefined) delete process.env.HR_SALARY_ENABLED;
    else process.env.HR_SALARY_ENABLED = old;
  }
}

test('lower hourly rate requires written agreement reference before approval', async () => {
  await withEnabled(async () => {
    const source = { id: 1n, effectiveFrom: new Date('2026-01-01'),
      hourlyRate: new Prisma.Decimal('20.00') };
    const tx = {
      $queryRaw: async () => [{ id: 3n }],
      hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
      hrPrimaryAppointment: { findFirst: async () => ({ id: 4n }) },
      hrOffboardingRequest: { findFirst: async () => null },
      hrSalaryChangeRequest: { findFirst: async () => null,
        create: async ({ data }) => ({ id: 9n, status: 'SUBMITTED', ...data }) },
      hrSalaryRate: { findFirst: async () => source },
      auditLog: { create: async () => {} },
    };
    const service = new HrSalaryService({ $transaction: async (callback) => callback(tx) },
      { assertStorePermission: async () => {} },
      { createForSubject: async (_tx, kind) => assert.equal(kind, 'SALARY_CHANGE') });
    const input = { employeeId: 3, storeId: 2, effectiveDate: '2026-10-01',
      hourlyRate: '18.50', reason: '调整' };
    await assert.rejects(service.submit({ id: 5 }, input), /written agreement/);
    assert.equal((await service.submit({ id: 5 },
      { ...input, agreementReference: '协议-2026-01' })).status, 'SUBMITTED');
  });
});

test('approved retroactive hourly change preserves the previous rate interval and invalidates reviews', async () => {
  const source = { id: 1n, employeeId: 3n,
    effectiveFrom: new Date('2020-01-01T00:00:00Z'), effectiveToExclusive: null,
    hourlyRate: new Prisma.Decimal('20.00') };
  const change = { id: 9n, employeeId: 3n, storeId: 2n, status: 'SUBMITTED',
    effectiveDate: new Date('2020-06-01T00:00:00Z'), expectedRateId: 1n,
    proposedRate: new Prisma.Decimal('22.00') };
  const created = [];
  let invalidated = false;
  const tx = {
    $queryRaw: async () => [{ id: 9n }],
    hrSalaryChangeRequest: { findUnique: async () => change,
      update: async ({ data }) => Object.assign(change, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrPrimaryAppointment: { findFirst: async () => ({ id: 4n, storeId: 2n }),
      findMany: async () => [{ storeId: 2n }] },
    hrSalaryRate: { findFirst: async () => source,
      update: async ({ data }) => Object.assign(source, data),
      create: async ({ data }) => created.push(data) },
    hrMonthlyReview: { updateMany: async () => { invalidated = true; } },
    auditLog: { create: async () => {} },
  };
  const service = new HrSalaryService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(9n)).status, 'EFFECTIVE');
  assert.equal((await service.finalize(9n)).status, 'EFFECTIVE');
  assert.equal(source.effectiveToExclusive.toISOString().slice(0, 10), '2020-06-01');
  assert.equal(created.length, 1);
  assert.equal(created[0].hourlyRate.toFixed(2), '22.00');
  assert.equal(invalidated, true);
});

test('salary request permission can load active store employees without employee roster permission', async () => {
  await withEnabled(async () => {
    let permissionCall;
    let query;
    const service = new HrSalaryService({ hrEmployee: { findMany: async (value) => {
      query = value;
      return [{ id: 12n, displayName: '测试员工' }];
    } } }, { assertStorePermission: async (...args) => { permissionCall = args; } }, {});

    const result = await service.employeesForRequest({ id: 5 }, '22');

    assert.deepEqual(permissionCall, [{ id: 5 }, 'HR_SALARY_CHANGE_REQUEST', 22n]);
    assert.equal(query.where.status, 'ACTIVE');
    assert.equal(query.where.primaryAppointments.some.storeId, 22n);
    assert.deepEqual(result, [{ id: 12, displayName: '测试员工' }]);
  });
});
