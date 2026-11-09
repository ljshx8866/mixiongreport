const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrTimeCorrectionService } = require('../dist/hr/hr-time-correction.service');

test('authorized time correction applies directly and preserves the natural-day split', async () => {
  let created;
  let newVersion;
  let updatedRecord;
  const refreshedInputs = [];
  const version = { version: 1, actualStart: new Date('2026-10-01T15:00:00Z'),
    actualEnd: new Date('2026-10-01T18:00:00Z'), rawMinutes: 180, breaks: [], daySegments: [
      { businessDate: new Date('2026-10-01T00:00:00Z'), rawMinutes: 180 },
    ] };
  const record = { id: 3n, storeId: 2n, currentVersion: 1, versions: [version] };
  const tx = {
    $queryRaw: async () => [],
    hrWorkRecord: { findUnique: async () => record,
      update: async ({ data }) => { updatedRecord = data; Object.assign(record, data); },
      findMany: async () => [
        { currentVersion: 2, employee: { jobPosition: { scheduleOnly: false } }, versions: [
          { version: 2, daySegments: [
            { businessDate: new Date('2026-10-01T00:00:00Z'), rawMinutes: 60 },
            { businessDate: new Date('2026-10-02T00:00:00Z'), rawMinutes: 120 },
          ] },
        ] },
        { currentVersion: 1, employee: { jobPosition: { scheduleOnly: false } }, versions: [
          { version: 1, daySegments: [{ businessDate: new Date('2026-10-01T00:00:00Z'), rawMinutes: 60 }] },
        ] },
        { currentVersion: 1, employee: { jobPosition: { scheduleOnly: true } }, versions: [
          { version: 1, daySegments: [{ businessDate: new Date('2026-10-01T00:00:00Z'), rawMinutes: 600 }] },
        ] },
      ] },
    hrTimeCorrection: {
      count: async () => 0,
      create: async ({ data }) => { created = data; return { id: 7n, status: 'APPLIED' }; },
    },
    hrWorkRecordVersion: { create: async ({ data }) => { newVersion = data; } },
    storeDailyInput: { updateMany: async (args) => { refreshedInputs.push(args); return { count: 1 }; } },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => {} },
  };
  const service = new HrTimeCorrectionService({
    hrWorkRecord: { findUnique: async () => record },
    $transaction: async (run) => run(tx),
  }, { assertStorePermission: async (_user, permission) => assert.equal(permission, 'HR_TIME_CORRECTION_EDIT') }, {});
  const result = await service.request({ id: 5 }, {
    recordId: 3, expectedVersion: 1, reason: '补正实到时间',
    actualStart: '2026-10-01T23:00:00+08:00', actualEnd: '2026-10-02T02:00:00+08:00', breaks: [],
  });
  assert.equal(result.status, 'APPLIED');
  assert.equal(result.recordVersion, 2);
  assert.deepEqual(updatedRecord, { currentVersion: 2 });
  assert.equal(created.status, 'APPLIED');
  assert.deepEqual(created.proposedSegments.map((part) => [part.businessDate, part.rawMinutes]),
    [['2026-10-01', 60], ['2026-10-02', 120]]);
  assert.deepEqual(newVersion.daySegments.create.map((part) => [part.businessDate.toISOString().slice(0, 10), part.rawMinutes]),
    [['2026-10-01', 60], ['2026-10-02', 120]]);
  assert.deepEqual(refreshedInputs.map((item) => [item.where.businessDate.toISOString().slice(0, 10), item.data.laborHours]),
    [['2026-10-01', 2], ['2026-10-02', 2]]);
});

test('time correction preserves existing break intervals when the user leaves breaks unchanged', async () => {
  const breakPeriod = { start: '2026-10-01T05:00:00.000Z', end: '2026-10-01T05:30:00.000Z' };
  const version = { version: 1, actualStart: new Date('2026-10-01T01:00:00Z'),
    actualEnd: new Date('2026-10-01T09:00:00Z'), rawMinutes: 450, breaks: [breakPeriod],
    daySegments: [{ businessDate: new Date('2026-10-01T00:00:00Z'), elapsedMinutes: 480,
      breakMinutes: 30, rawMinutes: 450 }] };
  const record = { id: 13n, storeId: 2n, currentVersion: 1, versions: [version] };
  let createdVersion;
  const tx = { $queryRaw: async () => [],
    hrWorkRecord: { findUnique: async () => record, update: async ({ data }) => Object.assign(record, data),
      findMany: async () => [] },
    hrTimeCorrection: { count: async () => 0, create: async ({ data }) => ({ id: 19n, ...data }) },
    hrWorkRecordVersion: { create: async ({ data }) => { createdVersion = data; } },
    storeDailyInput: { updateMany: async () => ({ count: 1 }) },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) }, auditLog: { create: async () => {} },
  };
  const service = new HrTimeCorrectionService({ hrWorkRecord: { findUnique: async () => record },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} }, {});
  await service.request({ id: 5 }, { recordId: 13, expectedVersion: 1, reason: '调整上下班时间',
    actualStart: '2026-10-01T09:00:00+08:00', actualEnd: '2026-10-01T17:00:00+08:00' });
  assert.deepEqual(createdVersion.breaks, [breakPeriod]);
  assert.deepEqual(createdVersion.daySegments.create.map((part) =>
    [part.elapsedMinutes, part.breakMinutes, part.rawMinutes]), [[480, 30, 450]]);
});

test('time correction preserves a scheduled break-minute deduction without a clock interval', async () => {
  const version = { version: 1, actualStart: new Date('2026-10-01T01:00:00Z'),
    actualEnd: new Date('2026-10-01T09:00:00Z'), rawMinutes: 450, breaks: [],
    daySegments: [{ businessDate: new Date('2026-10-01T00:00:00Z'), elapsedMinutes: 480,
      breakMinutes: 30, rawMinutes: 450 }] };
  const record = { id: 14n, storeId: 2n, currentVersion: 1, versions: [version] };
  let createdVersion;
  const tx = { $queryRaw: async () => [],
    hrWorkRecord: { findUnique: async () => record, update: async ({ data }) => Object.assign(record, data),
      findMany: async () => [] },
    hrTimeCorrection: { count: async () => 0, create: async ({ data }) => ({ id: 20n, ...data }) },
    hrWorkRecordVersion: { create: async ({ data }) => { createdVersion = data; } },
    storeDailyInput: { updateMany: async () => ({ count: 1 }) },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) }, auditLog: { create: async () => {} },
  };
  const service = new HrTimeCorrectionService({ hrWorkRecord: { findUnique: async () => record },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} }, {});
  await service.request({ id: 5 }, { recordId: 14, expectedVersion: 1, reason: '调整上下班时间',
    actualStart: '2026-10-01T09:00:00+08:00', actualEnd: '2026-10-01T17:00:00+08:00' });
  assert.deepEqual(createdVersion.breaks, []);
  assert.equal(createdVersion.rawMinutes, 450);
  assert.deepEqual(createdVersion.daySegments.create.map((part) =>
    [part.elapsedMinutes, part.breakMinutes, part.rawMinutes]), [[480, 30, 450]]);
});

test('deleting confirmed work applies immediately and preserves the source version', async () => {
  const date = new Date('2026-10-01T00:00:00Z');
  let created;
  let newVersion;
  const workRecord = { id: 3n, storeId: 2n, currentVersion: 1, versions: [{ version: 1,
    actualStart: new Date('2026-10-01T01:00:00Z'), actualEnd: new Date('2026-10-01T03:00:00Z'),
    rawMinutes: 120, breaks: [], daySegments: [{ businessDate: date, rawMinutes: 120 }] }] };
  const tx = { $queryRaw: async () => [],
    hrWorkRecord: { findUnique: async () => workRecord, update: async () => {},
      findMany: async () => [] },
    hrTimeCorrection: { count: async () => 0,
      create: async ({ data }) => { created = data; return { id: 8n, status: 'APPLIED' }; } },
    hrWorkRecordVersion: { create: async ({ data }) => { newVersion = data; } },
    storeDailyInput: { updateMany: async () => ({ count: 1 }) },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => {} },
  };
  const service = new HrTimeCorrectionService({
    hrWorkRecord: { findUnique: async () => workRecord },
    $transaction: async (run) => run(tx),
  }, { assertStorePermission: async () => {} }, { createForSubject: async () => {} });
  const result = await service.request({ id: 5 }, { recordId: 3, expectedVersion: 1,
    action: 'DELETE', reason: '误确认，员工当天未出勤' });
  assert.equal(result.status, 'APPLIED');
  assert.equal(created.status, 'APPLIED');
  assert.deepEqual(created.proposedSegments, []);
  assert.equal(created.proposedRawMinutes, 0);
  assert.equal(created.proposedStart.toISOString(), '2026-10-01T01:00:00.000Z');
  assert.equal(created.proposedEnd.toISOString(), '2026-10-01T03:00:00.000Z');
  assert.deepEqual(newVersion.daySegments.create, []);
  assert.equal(newVersion.rawMinutes, 0);
});

test('approved correction with a stale work version is marked for reconciliation', async () => {
  const correction = { status: 'PENDING', recordId: 3n, expectedVersion: 1,
    proposedSegments: [{ businessDate: '2026-10-01', rawMinutes: 100 }] };
  const tx = {
    $queryRaw: async () => [],
    hrTimeCorrection: { findUnique: async () => correction,
      update: async ({ data }) => Object.assign(correction, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED', steps: [{ decision: 'APPROVE', actorId: 6n }] }) },
    hrWorkRecord: { findUnique: async () => ({ currentVersion: 2 }) },
  };
  const service = new HrTimeCorrectionService({ $transaction: async (run) => run(tx) }, {}, {});
  const result = await service.applyApproved(7n);
  assert.equal(result.status, 'APPLY_FAILED');
  assert.equal(correction.failureCode, 'WORK_VERSION_CHANGED');
});

test('approved deletion appends an empty current version and keeps the historical work version', async () => {
  const correction = { id: 7n, status: 'PENDING', recordId: 3n, expectedVersion: 1,
    proposedStart: new Date('2026-10-01T01:00:00Z'), proposedEnd: new Date('2026-10-01T03:00:00Z'),
    proposedBreaks: [], proposedSegments: [], proposedRawMinutes: 0, reason: '重复确认',
    appliedAt: null };
  let newVersion;
  let recordUpdate;
  const tx = {
    $queryRaw: async () => [],
    hrTimeCorrection: { findUnique: async () => correction,
      update: async ({ data }) => Object.assign(correction, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED',
      steps: [{ decision: 'APPROVE', actorId: 6n }] }) },
    hrWorkRecord: { findUnique: async () => ({ id: 3n, storeId: 2n, currentVersion: 1,
      versions: [{ version: 1, daySegments: [{ businessDate: new Date('2026-10-01T00:00:00Z'), rawMinutes: 120 }] }] }),
      update: async ({ data }) => { recordUpdate = data; }, findMany: async () => [] },
    hrWorkRecordVersion: { create: async ({ data }) => { newVersion = data; } },
    storeDailyInput: { updateMany: async () => ({ count: 1 }) },
    hrMonthlyReview: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => {} },
  };
  const service = new HrTimeCorrectionService({ $transaction: async (run) => run(tx) }, {}, {});
  const result = await service.applyApproved(7n);
  assert.deepEqual(result, { id: 7, status: 'APPLIED', recordVersion: 2, deleted: true });
  assert.deepEqual(recordUpdate, { currentVersion: 2 });
  assert.deepEqual(newVersion.daySegments, { create: [] });
  assert.equal(newVersion.rawMinutes, 0);
  assert.equal(correction.status, 'APPLIED');
});
