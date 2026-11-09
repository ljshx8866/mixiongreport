const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrMonthlyReviewService } = require('../dist/hr/hr-monthly-review.service');

const date = (value) => new Date(`${value}T00:00:00Z`);

test('monthly preview catches cross-store work on one natural day', async () => {
  let call = 0;
  const records = [
    { id: 1n, employeeId: 3n, storeId: 2n, currentVersion: 2, employee: { displayName: '测试员工' },
      schedule: { businessDate: date('2026-10-01'), currentVersion: 1, versions: [{ version: 1,
        plannedStart: new Date('2026-10-01T01:00:00Z'), plannedEnd: new Date('2026-10-01T09:00:00Z'), breakMinutes: 30 }] },
      versions: [{ version: 1, daySegments: [{ businessDate: date('2026-10-01'), rawMinutes: 500 }] },
        { version: 2, daySegments: [{ businessDate: date('2026-10-01'), rawMinutes: 20 }] }] },
    { id: 2n, employeeId: 3n, storeId: 4n, currentVersion: 1, employee: { displayName: '测试员工' },
      schedule: { businessDate: date('2026-10-01'), currentVersion: 1, versions: [{ version: 1,
        plannedStart: new Date('2026-10-01T01:00:00Z'), plannedEnd: new Date('2026-10-01T09:00:00Z'), breakMinutes: 30 }] },
      versions: [{ version: 1, daySegments: [{ businessDate: date('2026-10-01'), rawMinutes: 20 }] }] },
  ];
  const db = {
    hrWorkRecord: { findMany: async () => ++call === 1 ? [{ employeeId: 3n }] : records },
    hrSchedule: { findMany: async () => [] },
    hrTimeCorrection: { findMany: async () => [] },
    hrTransferRequest: { findMany: async () => [] },
  };
  const service = new HrMonthlyReviewService(db, { assertAnyStorePermission: async () => {} }, {});
  const preview = await service.preview({ id: 6 }, 2, '2026-10');
  assert.equal(preview.snapshot.rows[0].storeRawMinutes, 20);
  assert.equal(preview.snapshot.rows[0].organizationRawMinutes, 40);
  assert.equal(preview.snapshot.rows[0].scheduledMinutes, 450);
  assert.equal(preview.snapshot.totalScheduledMinutes, 450);
  assert.ok(preview.issues.some((item) => item.code === 'CROSS_STORE_DAY_UNRESOLVED'));
  assert.equal(preview.snapshot.totalStatisticalMinutes, null);
});

test('pay preview floors each shift, rounds each day, and uses the effective hourly rate', async () => {
  const previous = process.env.HR_PAY_CALC_ENABLED;
  process.env.HR_PAY_CALC_ENABLED = 'true';
  try {
    let calls = 0;
    const records = [20, 40].map((minutes, index) => ({ id: BigInt(index + 1),
      employeeId: 3n, storeId: 2n, currentVersion: 1,
      employee: { displayName: '测试员工' }, versions: [{ version: 1,
        daySegments: [{ businessDate: date('2026-10-01'), rawMinutes: minutes }] }] }));
    const db = {
      hrWorkRecord: { findMany: async () => ++calls === 1 ? [{ employeeId: 3n }] : records },
      hrSchedule: { findMany: async () => [] },
      hrTimeCorrection: { findMany: async () => [] },
      hrTransferRequest: { findMany: async () => [] },
      hrSalaryRate: { findMany: async () => [{ employeeId: 3n,
        effectiveFrom: date('2026-01-01'), effectiveToExclusive: null,
        hourlyRate: { toFixed: () => '10.01' } }] },
      hrSalaryChangeRequest: { findMany: async () => [] },
    };
    const service = new HrMonthlyReviewService(db,
      { assertAnyStorePermission: async () => {} }, {});
    const result = await service.preview({ id: 6 }, 2, '2026-10');
    assert.equal(result.snapshot.rows[0].storeRawMinutes, 60);
    assert.equal(result.snapshot.rows[0].statisticalMinutes, 30);
    assert.equal(result.snapshot.rows[0].basePayAmount, '5.01');
    assert.equal(result.snapshot.totalBasePayAmount, '5.01');
    assert.deepEqual(result.snapshot.salarySegments, [{ employeeId: 3, employeeName: '测试员工',
      effectiveFrom: '2026-10-01', effectiveToExclusive: '2026-11-01', hourlyRate: '10.01' }]);
  } finally {
    if (previous === undefined) delete process.env.HR_PAY_CALC_ENABLED;
    else process.env.HR_PAY_CALC_ENABLED = previous;
  }
});

test('ended trial history remains non-payable in the monthly preview', async () => {
  const previous = process.env.HR_PAY_CALC_ENABLED;
  process.env.HR_PAY_CALC_ENABLED = 'true';
  try {
    let calls = 0;
    const employee = { status: 'TRIAL_ENDED', jobPosition: { scheduleOnly: false } };
    const record = { id: 4n, employeeId: 3n, storeId: 2n, currentVersion: 1,
      employee: { displayName: '已结束试岗员工' }, versions: [{ version: 1,
        daySegments: [{ businessDate: date('2026-10-01'), rawMinutes: 240 }] }] };
    const db = {
      hrWorkRecord: { findMany: async () => ++calls === 1 ? [{ employeeId: 3n, employee }] : [record] },
      hrSchedule: { findMany: async () => [] },
      hrTimeCorrection: { findMany: async () => [] },
      hrTransferRequest: { findMany: async () => [] },
      hrSalaryRate: { findMany: async () => [{ employeeId: 3n,
        effectiveFrom: date('2026-01-01'), effectiveToExclusive: null,
        hourlyRate: { toFixed: () => '10.00' } }] },
      hrSalaryChangeRequest: { findMany: async () => [] },
    };
    const result = await new HrMonthlyReviewService(db,
      { assertAnyStorePermission: async () => {} }, {}).preview({ id: 6 }, 2, '2026-10');
    assert.equal(result.snapshot.rows[0].trialNotPayable, true);
    assert.equal(result.snapshot.rows[0].basePayAmount, null);
    assert.equal(result.snapshot.totalBasePayAmount, '0.00');
  } finally {
    if (previous === undefined) delete process.env.HR_PAY_CALC_ENABLED;
    else process.env.HR_PAY_CALC_ENABLED = previous;
  }
});

test('monthly snapshot freezes applied correction trace for the affected store and month', async () => {
  let recordsRead = 0;
  const versions = [
    { version: 1, daySegments: [{ businessDate: date('2026-10-01'), rawMinutes: 420 }] },
    { version: 2, daySegments: [{ businessDate: date('2026-10-01'), rawMinutes: 475 }] },
  ];
  const record = { id: 31n, employeeId: 3n, storeId: 2n, currentVersion: 2,
    employee: { displayName: '测试员工' }, versions };
  const db = {
    hrWorkRecord: { findMany: async () => ++recordsRead === 1 ? [{ employeeId: 3n }] : [record] },
    hrSchedule: { findMany: async () => [] },
    hrTimeCorrection: { findMany: async (args) => args.where.status === 'PENDING' ? [] : [{
      id: 9n, recordId: 31n, expectedVersion: 1, appliedAt: new Date('2026-10-02T02:00:00Z'),
      record: { ...record, versions },
    }] },
    hrTransferRequest: { findMany: async () => [] },
  };
  const result = await new HrMonthlyReviewService(db,
    { assertAnyStorePermission: async () => {} }, {}).preview({ id: 6 }, 2, '2026-10');
  assert.deepEqual(result.snapshot.corrections, [{ correctionId: 9, recordId: 31, employeeId: 3,
    employeeName: '测试员工', expectedVersion: 1, appliedVersion: 2,
    businessDates: ['2026-10-01'], beforeRawMinutes: 420, afterRawMinutes: 475,
    appliedAt: '2026-10-02T02:00:00.000Z' }]);
  assert.equal(JSON.stringify(result.snapshot).includes('reason'), false);
});

test('monthly submission refuses an unconfirmed shift before opening approval', async () => {
  let approvalOpened = false;
  const tx = {
    hrMonthlyReview: { findFirst: async () => null },
    hrWorkRecord: { findMany: async () => [] },
    hrSchedule: { findMany: async () => [{ id: 7n, currentVersion: 1,
      versions: [{ version: 1, plannedStart: new Date('2026-10-01T01:00:00Z'),
        plannedEnd: new Date('2026-10-01T09:00:00Z') }] }] },
    hrTimeCorrection: { findMany: async () => [] },
    hrTransferRequest: { findMany: async () => [] },
  };
  const service = new HrMonthlyReviewService({ $transaction: async (run) => run(tx) },
    { assertStorePermission: async () => {} },
    { createForSubject: async () => { approvalOpened = true; } });
  await assert.rejects(service.submit({ id: 5 }, 2, '2026-10'), (error) => {
    assert.ok(error.getResponse().issues.some((item) => item.code === 'UNCONFIRMED_SHIFTS'));
    return true;
  });
  assert.equal(approvalOpened, false);
});
