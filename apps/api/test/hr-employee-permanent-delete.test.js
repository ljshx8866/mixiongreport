require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrEmployeeController } = require('../dist/hr/hr-employee.controller');
const { snapshotHash } = require('../dist/hr/hr-snapshot-hash');

test('permanent employee delete is admin-only and scrubs employee rows from monthly snapshots', async () => {
  assert.deepEqual(Reflect.getMetadata('roles', HrEmployeeController.prototype.permanentlyDelete), ['ADMIN']);
  const targetedRow = { employeeId: 8, employeeName: '待删除姓名', businessDate: '2026-10-01',
    storeRawMinutes: 120, statisticalMinutes: 90, basePayAmount: '15.00', recordRefs: [{ recordId: 10, version: 1 }] };
  const retainedRow = { employeeId: 9, employeeName: '保留员工', businessDate: '2026-10-02',
    storeRawMinutes: 60, statisticalMinutes: 30, basePayAmount: '5.25', recordRefs: [{ recordId: 11, version: 1 }] };
  const snapshot = { storeId: 2, month: '2026-10', rows: [targetedRow, retainedRow],
    totalRawMinutes: 180, totalStatisticalMinutes: 120, totalBasePayAmount: '20.25',
    unresolvedCrossStoreDays: [{ employeeId: 8, businessDate: '2026-10-01' }],
    corrections: [{ employeeId: 8, employeeName: '待删除姓名' }],
    salarySegments: [{ employeeId: 8, employeeName: '待删除姓名', hourlyRate: '10.00' }] };
  let updatedReview;
  const deletionAudits = [];
  let accountDeleted = false;
  let employeeDeleted = false;
  const empty = async () => [];
  const noOp = { findMany: empty, deleteMany: async () => ({ count: 0 }) };
  const tx = {
    $queryRaw: async () => [],
    hrEmployee: { findUnique: async () => ({ id: 8n, status: 'TERMINATED', userId: 7n, initialStoreId: 2n }),
      delete: async ({ where }) => { employeeDeleted = where.id === 8n; } },
    hrSchedule: noOp, hrWorkRecord: noOp, hrOnboardingRequest: noOp, hrOffboardingRequest: noOp,
    hrSalaryChangeRequest: noOp, hrBankChangeRequest: noOp, hrTransferRequest: noOp, hrSalaryRate: noOp,
    hrTimeCorrection: noOp, hrPrimaryAppointment: noOp, hrBankAccountVersion: noOp,
    hrSensitiveDraftRevision: noOp, hrScheduleDelivery: noOp,
    user: { findUnique: async () => ({ id: 7n, name: '员工账号', mobile: '13800000000',
      role: 'STORE_MANAGER', source: 'LOCAL', status: true }),
      delete: async ({ where }) => { accountDeleted = where.id === 7n; } },
    userStore: { deleteMany: async () => ({ count: 0 }) },
    fillReminderRecipient: { deleteMany: async () => ({ count: 0 }) },
    storeDailyInput: { updateMany: async () => ({ count: 0 }) },
    hrMonthlyReview: { findMany: async ({ where }) => {
      assert.deepEqual(where.storeId.in, [2n]); return [{ id: 50n, snapshot }];
    }, update: async ({ data }) => { updatedReview = data; } },
    hrIdentityClaim: { deleteMany: async () => ({ count: 0 }) },
    hrApprovalNotification: { deleteMany: async () => ({ count: 0 }) },
    hrApprovalInstanceStep: { deleteMany: async () => ({ count: 0 }) },
    hrApprovalInstance: { deleteMany: async () => ({ count: 0 }) },
    hrTransferDecision: { deleteMany: async () => ({ count: 0 }) },
    hrWorkDaySegment: { deleteMany: async () => ({ count: 0 }) },
    hrWorkRecordVersion: { deleteMany: async () => ({ count: 0 }) },
    hrScheduleVersion: { deleteMany: async () => ({ count: 0 }) },
    auditLog: { deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => { deletionAudits.push(data); } },
  };
  const controller = new HrEmployeeController({ $transaction: async (run) => run(tx) }, {});
  const result = await controller.permanentlyDelete({ user: { id: 1, role: 'ADMIN' } }, 8, { reason: '重复员工档案清理' });
  assert.deepEqual(result, { deleted: true, id: 8, accountDeleted: true });
  assert.equal(employeeDeleted, true);
  assert.equal(accountDeleted, true);
  assert.deepEqual(updatedReview.snapshot.rows, [retainedRow]);
  assert.equal(updatedReview.snapshot.totalRawMinutes, 60);
  assert.equal(updatedReview.snapshot.totalStatisticalMinutes, 30);
  assert.equal(updatedReview.snapshot.totalBasePayAmount, '5.25');
  assert.deepEqual(updatedReview.snapshot.unresolvedCrossStoreDays, []);
  assert.deepEqual(updatedReview.snapshot.corrections, []);
  assert.deepEqual(updatedReview.snapshot.salarySegments, []);
  assert.equal(updatedReview.invalidatedAt instanceof Date, true);
  assert.equal(updatedReview.snapshotHash, snapshotHash(updatedReview.snapshot));
  const employeeAudit = deletionAudits.find((item) => item.entityType === 'HR_EMPLOYEE_PURGED');
  assert.equal(employeeAudit.beforeData.accountDeleted, true);
  assert.equal(JSON.stringify(employeeAudit.beforeData).includes('待删除姓名'), false);
});
