const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Workbook } = require('exceljs');
const { HrMonthlyExportService } = require('../dist/hr/hr-monthly-export.service');
const { snapshotHash } = require('../dist/hr/hr-snapshot-hash');

const snapshot = {
  month: '2026-10', ruleCode: 'DAILY_FLOOR_30_MIN', label: '月审统计',
  rows: [{ employeeId: 8, employeeName: '张三', businessDate: '2026-10-14',
    scheduledMinutes: 480,
    storeRawMinutes: 475, organizationRawMinutes: 475, statisticalMinutes: 450,
    discardedMinutes: 25, recordRefs: [{ recordId: 31, version: 2 }] }],
  totalRawMinutes: 475, totalScheduledMinutes: 480, totalStatisticalMinutes: 450,
};

function fixture(overrides = {}) {
  const review = {
    id: 7n, storeId: 2n, store: { storeName: '山大店' }, revision: 1,
    status: 'APPROVED', invalidatedAt: null, snapshot,
    snapshotHash: snapshotHash(snapshot),
    submittedAt: new Date('2026-10-14T09:00:00Z'),
    approvedAt: new Date('2026-10-14T10:00:00Z'), ...overrides,
  };
  const audit = [];
  const db = {
    hrMonthlyReview: { findUnique: async () => review },
    hrApprovalInstance: { findUnique: async () => ({ steps: [{ position: 1,
      actorId: 9n, decision: 'APPROVED', decidedAt: new Date('2026-10-14T10:00:00Z') }] }) },
    auditLog: { create: async (value) => audit.push(value.data) },
  };
  const service = new HrMonthlyExportService(db,
    { assertStorePermission: async (_user, permission, storeId) => {
      assert.equal(permission, 'HR_MONTH_EXPORT');
      assert.equal(storeId, 2n);
    } });
  return { service, audit };
}

test('monthly export uses only approved snapshot and records file hash', async () => {
  const { service, audit } = fixture();
  const file = await service.generate({ id: 5 }, 7n);
  assert.match(file.fileName, /^hr-monthly-2026-10-store-2-v1\.xlsx$/);
  assert.match(file.fileHash, /^[a-f0-9]{64}$/);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].afterData.fileHash, file.fileHash);
  assert.equal(audit[0].afterData.exportedBy, '用户 ID 5');
  assert.ok(audit[0].afterData.exportedAt);
  const workbook = new Workbook();
  await workbook.xlsx.load(file.buffer);
  assert.equal(workbook.getWorksheet('月度汇总').getCell('B1').value, '山大店');
  const daily = workbook.getWorksheet('每日工时');
  assert.equal(daily.getCell('A2').value, '2026-10-14');
  assert.equal(daily.getCell('D2').value, '8.00');
  assert.equal(daily.getCell('E2').value, '7.50');
  assert.equal(daily.columnCount, 5);
  assert.ok(workbook.getWorksheet('月度汇总').getCell('B9').value);
  assert.equal(workbook.getWorksheet('月度汇总').getCell('B10').value, '用户 ID 5');
  assert.equal(workbook.getWorksheet('审核与异常').getCell('B7').value, '用户 ID 5');
  assert.match(workbook.getWorksheet('审核与异常').getCell('B8').value, /不含应发工资/);
});

test('monthly export includes frozen salary intervals and correction trace without free-text reasons', async () => {
  const enriched = { ...snapshot, totalBasePayAmount: '75.08',
    rows: [{ ...snapshot.rows[0], hourlyRate: '10.01', basePayAmount: '75.08' }],
    salarySegments: [{ employeeId: 8, employeeName: '张三', effectiveFrom: '2026-10-01',
      effectiveToExclusive: '2026-11-01', hourlyRate: '10.01' }],
    corrections: [{ correctionId: 9, recordId: 31, employeeId: 8, employeeName: '张三',
      expectedVersion: 1, appliedVersion: 2, businessDates: ['2026-10-14'],
      beforeRawMinutes: 420, afterRawMinutes: 475, appliedAt: '2026-10-14T08:00:00.000Z' }] };
  const { service } = fixture({ snapshot: enriched, snapshotHash: snapshotHash(enriched) });
  const file = await service.generate({ id: 5 }, 7n);
  const workbook = new Workbook();
  await workbook.xlsx.load(file.buffer);
  assert.equal(workbook.getWorksheet('时薪有效段').getCell('E2').value, '10.01');
  const corrections = workbook.getWorksheet('异常与工时更正');
  assert.equal(corrections.getCell('A2').value, 9);
  assert.equal(corrections.getCell('G2').value, 2);
  assert.equal(corrections.getCell('H2').value, '2026-10-14T08:00:00.000Z');
  assert.equal(corrections.columnCount, 8);
});

test('monthly export blocks invalidated, altered and structurally broken snapshots', async () => {
  for (const overrides of [
    { invalidatedAt: new Date() },
    { snapshot: { ...snapshot, totalRawMinutes: 999 } },
    { snapshot: { ...snapshot, rows: [{ ...snapshot.rows[0], recordRefs: 'bad' }] },
      snapshotHash: snapshotHash({ ...snapshot, rows: [{ ...snapshot.rows[0], recordRefs: 'bad' }] }) },
  ]) {
    const { service, audit } = fixture(overrides);
    await assert.rejects(service.generate({ id: 5 }, 7n));
    assert.equal(audit.length, 0);
  }
});

test('snapshot hash ignores JSON object key order', () => {
  assert.equal(snapshotHash({ b: 2, a: { d: 4, c: 3 } }),
    snapshotHash({ a: { c: 3, d: 4 }, b: 2 }));
});
