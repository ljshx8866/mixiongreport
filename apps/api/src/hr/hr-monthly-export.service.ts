import { ConflictException, Injectable } from '@nestjs/common';
import { HrMonthlyReviewStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Workbook } from 'exceljs';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { snapshotHash } from './hr-snapshot-hash';

type SnapshotRow = {
  employeeId: number; employeeName: string; businessDate: string;
  scheduledMinutes?: number;
  storeRawMinutes: number; organizationRawMinutes: number;
  statisticalMinutes: number | null; discardedMinutes: number | null;
  hourlyRate?: string | null; basePayAmount?: string | null;
  recordRefs: { recordId: number; version: number }[];
};
type Snapshot = { month: string; ruleCode: string; label: string; rows: SnapshotRow[];
  totalRawMinutes: number; totalScheduledMinutes?: number; totalStatisticalMinutes: number | null;
  totalBasePayAmount?: string | null;
  corrections?: { correctionId: number; recordId: number; employeeId: number; employeeName: string;
    expectedVersion: number; appliedVersion: number; businessDates: string[];
    beforeRawMinutes: number; afterRawMinutes: number; appliedAt: string | null }[];
  salarySegments?: { employeeId: number; employeeName: string; effectiveFrom: string;
    effectiveToExclusive: string; hourlyRate: string }[] };

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.month === 'string' && typeof snapshot.ruleCode === 'string' &&
    typeof snapshot.label === 'string' && Array.isArray(snapshot.rows) &&
    Number.isFinite(snapshot.totalRawMinutes) &&
    (snapshot.totalStatisticalMinutes === null || Number.isFinite(snapshot.totalStatisticalMinutes)) &&
    (snapshot.totalBasePayAmount === undefined || snapshot.totalBasePayAmount === null ||
      /^\d+\.\d{2}$/.test(String(snapshot.totalBasePayAmount))) &&
    snapshot.rows.every((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const row = value as Record<string, unknown>;
      return Number.isSafeInteger(row.employeeId) && typeof row.employeeName === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(row.businessDate)) &&
        Number.isFinite(row.storeRawMinutes) && Number.isFinite(row.organizationRawMinutes) &&
        (row.statisticalMinutes === null || Number.isFinite(row.statisticalMinutes)) &&
        (row.discardedMinutes === null || Number.isFinite(row.discardedMinutes)) &&
        (row.scheduledMinutes === undefined || Number.isFinite(row.scheduledMinutes)) &&
        (snapshot.totalBasePayAmount === undefined ||
          (typeof row.hourlyRate === 'string' && /^\d+\.\d{2}$/.test(row.hourlyRate) &&
            typeof row.basePayAmount === 'string' && /^\d+\.\d{2}$/.test(row.basePayAmount))) &&
        Array.isArray(row.recordRefs) && row.recordRefs.every((value) =>
          value && typeof value === 'object' && Number.isSafeInteger(value.recordId) &&
          Number.isSafeInteger(value.version));
    }) && (snapshot.corrections === undefined || (Array.isArray(snapshot.corrections) &&
      snapshot.corrections.every((value) => value && Number.isSafeInteger(value.correctionId) &&
        Number.isSafeInteger(value.recordId) && Number.isSafeInteger(value.employeeId) &&
        typeof value.employeeName === 'string' && Number.isSafeInteger(value.expectedVersion) &&
        Number.isSafeInteger(value.appliedVersion) && Array.isArray(value.businessDates) &&
        value.businessDates.every((date: unknown) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) &&
        Number.isFinite(value.beforeRawMinutes) && Number.isFinite(value.afterRawMinutes) &&
        (value.appliedAt === null || typeof value.appliedAt === 'string')))) &&
      (snapshot.salarySegments === undefined || (Array.isArray(snapshot.salarySegments) &&
        snapshot.salarySegments.every((value) => value && Number.isSafeInteger(value.employeeId) &&
          typeof value.employeeName === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveFrom) &&
          /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveToExclusive) && /^\d+\.\d{2}$/.test(value.hourlyRate))));
}

@Injectable()
export class HrMonthlyExportService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  async generate(user: AuthContext | undefined, reviewId: bigint) {
    if (reviewId <= 0n) throw new ConflictException('Invalid review id');
    const review = await this.db.hrMonthlyReview.findUnique({ where: { id: reviewId },
      include: { store: { select: { storeName: true } } } });
    if (!review) throw new ConflictException('Monthly review does not exist');
    await this.access.assertStorePermission(user, 'HR_MONTH_EXPORT', review.storeId);
    if (review.status !== HrMonthlyReviewStatus.APPROVED || review.invalidatedAt)
      throw new ConflictException('Only a current approved review can be exported');
    if (snapshotHash(review.snapshot) !== review.snapshotHash || !validSnapshot(review.snapshot))
      throw new ConflictException('Monthly snapshot integrity check failed');
    const approval = await this.db.hrApprovalInstance.findUnique({ where: {
      kind_subjectId: { kind: 'MONTHLY_REVIEW', subjectId: reviewId },
    }, include: { steps: { orderBy: { position: 'asc' } } } });
    const exportedAt = new Date();
    const exportedBy = user?.id == null ? '系统' : `用户 ID ${user.id}`;
    const workbook = this.buildWorkbook(review.snapshot, {
      storeName: review.store.storeName, revision: review.revision, submittedAt: review.submittedAt,
      approvedAt: review.approvedAt, snapshotHash: review.snapshotHash, exportedAt, exportedBy,
      approvals: approval?.steps.map((step) => ({ position: step.position,
        actorId: step.actorId?.toString() ?? '', decision: step.decision ?? '',
        decidedAt: step.decidedAt?.toISOString() ?? '' })) ?? [],
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    await this.db.auditLog.create({ data: {
      userId: BigInt(user!.id!), entityType: 'HR_MONTHLY_REVIEW', entityId: reviewId, action: 'EXPORT',
      afterData: { snapshotHash: review.snapshotHash, fileHash, bytes: buffer.length,
        exportedAt: exportedAt.toISOString(), exportedBy },
    } });
    return { buffer, fileHash,
      fileName: `hr-monthly-${review.snapshot.month}-store-${review.storeId}-v${review.revision}.xlsx` };
  }

  buildWorkbook(snapshot: Snapshot, meta: { storeName: string; revision: number;
    submittedAt: Date; approvedAt: Date | null; snapshotHash: string; exportedAt: Date; exportedBy: string;
    approvals: { position: number; actorId: string; decision: string; decidedAt: string }[] }) {
    const book = new Workbook();
    book.creator = '米熊人事管理';
    book.created = meta.submittedAt;
    book.modified = meta.approvedAt ?? meta.submittedAt;
    const summary = book.addWorksheet('月度汇总');
    summary.columns = [{ width: 27 }, { width: 34 }];
    summary.addRows([
      ['门店', meta.storeName], ['月份', snapshot.month], ['审核版本', meta.revision],
      ...(snapshot.totalScheduledMinutes === undefined ? [] : [['排班工时（小时）', (snapshot.totalScheduledMinutes / 60).toFixed(2)]]),
      ['统计工时（小时）', snapshot.totalStatisticalMinutes == null ? '待核对' : (snapshot.totalStatisticalMinutes / 60).toFixed(2)],
      ...(snapshot.totalBasePayAmount === undefined ? [] :
        [['基础时薪应发合计', snapshot.totalBasePayAmount ?? '待核对']]),
      ['规则版本', snapshot.ruleCode], ['用途', snapshot.label], ['快照 SHA-256', meta.snapshotHash],
      ['导出时间', meta.exportedAt.toISOString()], ['导出操作者', meta.exportedBy],
    ]);
    const daily = book.addWorksheet('每日工时');
    daily.columns = [
      { header: '日期', key: 'date', width: 16 }, { header: '员工ID', key: 'employeeId', width: 12 },
      { header: '员工姓名', key: 'employeeName', width: 20 }, { header: '排班工时（小时）', key: 'scheduled', width: 20 },
      { header: '统计工时（小时）', key: 'statistical', width: 20 },
    ];
    for (const row of snapshot.rows) daily.addRow({ date: row.businessDate, employeeId: row.employeeId,
      employeeName: row.employeeName, scheduled: row.scheduledMinutes === undefined
        ? '—' : (row.scheduledMinutes / 60).toFixed(2),
      statistical: row.statisticalMinutes == null ? '待核对' : (row.statisticalMinutes / 60).toFixed(2) });
    if (snapshot.totalBasePayAmount !== undefined) {
      const pay = book.addWorksheet('基础时薪应发明细');
      pay.addRow(['日期', '员工ID', '员工姓名', '统计工时（小时）', '当日时薪', '当日基础应发']);
      for (const row of snapshot.rows) pay.addRow([row.businessDate, row.employeeId,
        row.employeeName, row.statisticalMinutes == null ? '待核对' : (row.statisticalMinutes / 60).toFixed(2),
        row.hourlyRate, row.basePayAmount]);
      pay.addRow(['合计', '', '', snapshot.totalStatisticalMinutes == null
        ? '待核对' : (snapshot.totalStatisticalMinutes / 60).toFixed(2), '', snapshot.totalBasePayAmount]);
    }
    if (snapshot.salarySegments !== undefined) {
      const rates = book.addWorksheet('时薪有效段');
      rates.columns = [
        { header: '员工ID', key: 'employeeId', width: 12 }, { header: '员工姓名', key: 'employeeName', width: 20 },
        { header: '本月有效起始日', key: 'from', width: 18 },
        { header: '本月有效结束日（不含）', key: 'to', width: 24 },
        { header: '时薪', key: 'rate', width: 14 },
      ];
      for (const row of snapshot.salarySegments) rates.addRow({ employeeId: row.employeeId,
        employeeName: row.employeeName, from: row.effectiveFrom, to: row.effectiveToExclusive,
        rate: row.hourlyRate });
    }
    const corrections = book.addWorksheet('异常与工时更正');
    corrections.columns = [
      { header: '更正单ID', key: 'correctionId', width: 14 }, { header: '工时记录ID', key: 'recordId', width: 16 },
      { header: '员工ID', key: 'employeeId', width: 12 }, { header: '员工姓名', key: 'employeeName', width: 20 },
      { header: '影响日期', key: 'dates', width: 28 }, { header: '原版本', key: 'beforeVersion', width: 12 },
      { header: '更正版本', key: 'afterVersion', width: 12 }, { header: '应用时间', key: 'appliedAt', width: 24 },
    ];
    for (const row of snapshot.corrections ?? []) corrections.addRow({ correctionId: row.correctionId,
      recordId: row.recordId, employeeId: row.employeeId, employeeName: row.employeeName,
      dates: row.businessDates.join('、'), beforeVersion: row.expectedVersion,
      afterVersion: row.appliedVersion, appliedAt: row.appliedAt ?? '' });
    if (!(snapshot.corrections ?? []).length) corrections.addRow(['本月没有已应用的工时更正']);
    const review = book.addWorksheet('审核与异常');
    review.addRows([['项目', '值'], ['门店', meta.storeName], ['月份', snapshot.month],
      ['提交时间', meta.submittedAt.toISOString()], ['审核完成时间', meta.approvedAt?.toISOString() ?? ''],
      ['导出时间', meta.exportedAt.toISOString()], ['导出操作者', meta.exportedBy],
      ['说明', snapshot.totalBasePayAmount === undefined ?
        '导出的是审核快照；不含应发工资、实发工资和付款指令。' :
        '基础时薪应发按班次取整及每日金额舍入计算；其他工资项目、实发金额和付款指令不在本表。']]);
    for (const item of meta.approvals) review.addRow([`审批第 ${item.position} 步`,
      `${item.actorId} / ${item.decision} / ${item.decidedAt}`]);
    for (const sheet of book.worksheets) {
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFED7AA' } };
    }
    return book;
  }
}
