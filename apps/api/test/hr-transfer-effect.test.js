const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrTransferService } = require('../dist/hr/hr-transfer.service');

const day = (value) => new Date(`${value}T00:00:00.000Z`);

test('new transfer request starts with destination manager approval', async () => {
  let createdData;
  const tx = {
    $queryRaw: async () => [{ id: 3n }],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrOffboardingRequest: { findFirst: async () => null },
    hrTransferRequest: { count: async () => 0, create: async ({ data }) => {
      createdData = data; return { id: 5n, status: 'PENDING', nextStep: data.nextStep };
    } },
    hrPrimaryAppointment: { findFirst: async () => ({ storeId: 1n }) },
    auditLog: { create: async () => {} },
  };
  const service = new HrTransferService({ store: { findFirst: async () => ({ id: 2n }) },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} });
  const result = await service.request({ id: 9 }, { employeeId: 3, fromStoreId: 1, toStoreId: 2,
    requestedEffectiveDate: '2026-10-21', reason: '调店' });
  assert.equal(result.nextStep, 'DESTINATION_STORE');
  assert.equal(createdData.nextStep, 'DESTINATION_STORE');
});

test('approved backdated transfer splits the historical appointment once and flags reconciliation', async () => {
  const transfer = {
    id: 9n, employeeId: 3n, fromStoreId: 1n, toStoreId: 2n,
    requestedEffectiveDate: day('2026-09-01'), status: 'APPROVED_AWAITING_EFFECTIVE',
  };
  const appointments = [{ id: 4n, employeeId: 3n, storeId: 1n,
    effectiveFrom: day('2026-01-01'), effectiveToExclusive: null }];
  const audit = [];
  const tx = {
    $queryRaw: async () => [{ id: 9n }],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrTransferRequest: {
      findUnique: async () => transfer,
      update: async ({ data }) => Object.assign(transfer, data),
    },
    hrPrimaryAppointment: {
      findMany: async () => appointments,
      update: async ({ where, data }) => Object.assign(appointments.find((item) => item.id === where.id), data),
      create: async ({ data }) => appointments.push({ id: 5n, ...data }),
    },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async ({ data }) => audit.push(data) },
  };
  const service = new HrTransferService({ $transaction: async (run) => run(tx) }, {});
  assert.equal(await service.applyOne(9n), true);
  assert.equal(transfer.status, 'EFFECTIVE');
  assert.equal(transfer.reconciliationRequired, true);
  assert.equal(appointments.length, 2);
  assert.equal(appointments[0].effectiveToExclusive.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(appointments[1].effectiveFrom.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(appointments[1].storeId, 2n);
  assert.equal(await service.applyOne(9n), false);
  assert.equal(appointments.length, 2);
  assert.equal(audit.length, 1);
});

test('an obsolete source appointment marks transfer failed without changing appointments', async () => {
  const transfer = { employeeId: 3n, fromStoreId: 1n, toStoreId: 2n,
    requestedEffectiveDate: day('2026-09-01'), status: 'APPROVED_AWAITING_EFFECTIVE' };
  const appointments = [{ id: 4n, storeId: 6n,
    effectiveFrom: day('2026-01-01'), effectiveToExclusive: null }];
  const tx = {
    $queryRaw: async () => [],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrTransferRequest: {
      findUnique: async () => transfer,
      update: async ({ data }) => Object.assign(transfer, data),
    },
    hrPrimaryAppointment: { findMany: async () => appointments },
    auditLog: { create: async () => {} },
  };
  const service = new HrTransferService({ $transaction: async (run) => run(tx) }, {});
  assert.equal(await service.applyOne(9n), false);
  assert.equal(transfer.status, 'EFFECTIVE_FAILED');
  assert.equal(appointments[0].storeId, 6n);
});

test('same-day transfer moves the starting appointment in place instead of failing on a zero-length interval', async () => {
  const transfer = { id: 33n, employeeId: 3n, fromStoreId: 1n, toStoreId: 2n,
    requestedEffectiveDate: day('2026-10-20'), status: 'APPROVED_AWAITING_EFFECTIVE' };
  const appointments = [{ id: 44n, employeeId: 3n, storeId: 1n,
    effectiveFrom: day('2026-10-20'), effectiveToExclusive: null }];
  const tx = {
    $queryRaw: async () => [{ id: 33n }],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE', userId: null }) },
    hrTransferRequest: { findUnique: async () => transfer,
      update: async ({ data }) => Object.assign(transfer, data) },
    hrPrimaryAppointment: { findMany: async () => appointments,
      update: async ({ where, data }) => Object.assign(appointments.find((item) => item.id === where.id), data),
      create: async () => { throw new Error('same-day transfer must not create a zero-length appointment'); } },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => {} },
  };
  const service = new HrTransferService({ $transaction: async (run) => run(tx) }, {});
  assert.equal(await service.applyOne(33n), true);
  assert.equal(appointments.length, 1);
  assert.equal(appointments[0].storeId, 2n);
  assert.equal(appointments[0].effectiveFrom.toISOString().slice(0, 10), '2026-10-20');
  assert.equal(appointments[0].effectiveToExclusive, null);
  assert.equal(transfer.status, 'EFFECTIVE');
});

test('effective transfer moves the shared account store scope to destination and keeps an audit trail', async () => {
  const transfer = { id: 12n, employeeId: 3n, fromStoreId: 1n, toStoreId: 2n,
    requestedEffectiveDate: day('2026-09-01'), status: 'APPROVED_AWAITING_EFFECTIVE' };
  const appointments = [{ id: 4n, employeeId: 3n, storeId: 1n,
    effectiveFrom: day('2026-01-01'), effectiveToExclusive: null }];
  const storeLinks = [{ storeId: 1n }];
  const audit = [];
  const tx = {
    $queryRaw: async () => [{ id: 12n }],
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE', userId: 30n }) },
    hrTransferRequest: {
      findUnique: async () => transfer,
      update: async ({ data }) => Object.assign(transfer, data),
    },
    hrPrimaryAppointment: {
      findMany: async () => appointments,
      update: async ({ where, data }) => Object.assign(appointments.find((item) => item.id === where.id), data),
      create: async ({ data }) => appointments.push({ id: 5n, ...data }),
    },
    userStore: {
      findMany: async () => storeLinks.map((item) => ({ ...item })),
      upsert: async ({ create }) => { if (!storeLinks.some((item) => item.storeId === create.storeId)) storeLinks.push({ storeId: create.storeId }); return create; },
      deleteMany: async ({ where }) => { const before = storeLinks.length; for (let i = storeLinks.length - 1; i >= 0; i--) if (storeLinks[i].storeId === where.storeId) storeLinks.splice(i, 1); return { count: before - storeLinks.length }; },
    },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async ({ data }) => audit.push(data) },
  };
  const service = new HrTransferService({ $transaction: async (run) => run(tx) }, {});

  assert.equal(await service.applyOne(12n), true);
  assert.deepEqual(storeLinks, [{ storeId: 2n }]);
  const movedScopeAudit = audit.find((item) => item.action === 'TRANSFER_STORE_SCOPE');
  assert.deepEqual(movedScopeAudit.beforeData.storeIds, ['1']);
  assert.equal(movedScopeAudit.afterData.toStoreId, '2');
});
