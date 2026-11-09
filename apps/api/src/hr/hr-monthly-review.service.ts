import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HrApprovalKind, HrApprovalStatus, HrMonthlyReviewStatus, HrTimeCorrectionStatus, HrTransferDecisionType, HrTransferStatus, Prisma } from '@prisma/client';
import { buildStoreMonthlyWorkSnapshot, calculateDailyHourlyPay, sumDailyHourlyPay,
  type MonthlyWorkPart } from '@restaurant/hr-engine';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrApprovalService } from './hr-approval.service';
import { snapshotHash } from './hr-snapshot-hash';

function id(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

function monthRange(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    throw new BadRequestException('Month must be YYYY-MM');
  const start = new Date(`${value}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { label: value, start, end, previousDay: new Date(start.getTime() - 86400000),
    startInstant: new Date(start.getTime() - 8 * 3600000),
    endInstant: new Date(end.getTime() - 8 * 3600000) };
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

@Injectable()
export class HrMonthlyReviewService {
  private readonly logger = new Logger(HrMonthlyReviewService.name);
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly approvals: HrApprovalService) {}

  async preview(user: AuthContext | undefined, storeIdInput: unknown, monthInput: unknown) {
    const storeId = id(storeIdInput);
    const range = monthRange(monthInput);
    await this.access.assertAnyStorePermission(user,
      ['HR_MONTH_LIST_READ', 'HR_MONTH_SUBMIT', 'HR_MONTH_APPROVE', 'HR_MONTH_EXPORT'], storeId);
    const result = await this.buildSnapshot(this.db, storeId, range);
    if (process.env.HR_PAY_CALC_ENABLED !== 'true') return result;
    try {
      await this.access.assertAnyStorePermission(user, ['HR_MONTH_APPROVE', 'HR_MONTH_EXPORT'], storeId);
      return result;
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      const { totalBasePayAmount: _hidden, ...snapshot } = result.snapshot;
      return { ...result, snapshot: { ...snapshot, rows: snapshot.rows.map((row) => {
        const { hourlyRate: _rate, basePayAmount: _amount, ...visible } = row;
        return visible;
      }) } };
    }
  }

  async submit(user: AuthContext | undefined, storeIdInput: unknown, monthInput: unknown) {
    const storeId = id(storeIdInput);
    const range = monthRange(monthInput);
    await this.access.assertStorePermission(user, 'HR_MONTH_SUBMIT', storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      const latest = await tx.hrMonthlyReview.findFirst({ where: { storeId, month: range.start },
        orderBy: { revision: 'desc' } });
      if (latest && ((latest.status === HrMonthlyReviewStatus.SUBMITTED && !latest.invalidatedAt) ||
        (latest.status === HrMonthlyReviewStatus.APPROVED && !latest.invalidatedAt)))
        throw new ConflictException('Current month revision is already under review or approved');
      const result = await this.buildSnapshot(tx, storeId, range);
      if (result.issues.length) throw new ConflictException({ message: 'Month has unresolved work', issues: result.issues });
      const snapshot = result.snapshot;
      const hash = snapshotHash(snapshot);
      const review = await tx.hrMonthlyReview.create({ data: {
        storeId, month: range.start, revision: (latest?.revision ?? 0) + 1,
        snapshot: snapshot as unknown as Prisma.InputJsonValue, snapshotHash: hash, submittedBy: actorId,
      } });
      await this.approvals.createForSubject(tx, HrApprovalKind.MONTHLY_REVIEW, review.id, storeId, actorId);
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_MONTHLY_REVIEW', entityId: review.id, action: 'SUBMIT',
        afterData: { storeId: String(storeId), month: range.label, revision: review.revision, snapshotHash: hash },
      } });
      return { id: Number(review.id), month: range.label, revision: review.revision,
        status: review.status, snapshotHash: hash };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async decide(user: AuthContext | undefined, reviewIdInput: unknown, input: Record<string, unknown>) {
    const reviewId = id(reviewIdInput);
    const decision = input.decision;
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (decision !== HrTransferDecisionType.APPROVE && decision !== HrTransferDecisionType.REJECT)
      throw new BadRequestException('Invalid monthly review decision');
    const review = await this.db.hrMonthlyReview.findUnique({ where: { id: reviewId } });
    if (!review || review.status !== HrMonthlyReviewStatus.SUBMITTED || review.invalidatedAt)
      throw new ConflictException('Review is no longer pending');
    const instance = await this.db.hrApprovalInstance.findUnique({ where: {
      kind_subjectId: { kind: HrApprovalKind.MONTHLY_REVIEW, subjectId: reviewId },
    } });
    if (!instance) throw new ConflictException('Approval instance is missing');
    const progress = await this.approvals.decide(user, instance.id, decision, reason);
    if (progress.status === HrApprovalStatus.PENDING)
      return { id: Number(reviewId), status: HrMonthlyReviewStatus.SUBMITTED,
        nextApprovalPosition: progress.nextPosition };
    return this.finalize(reviewId, progress.status);
  }

  async list(user: AuthContext | undefined, storeIdInput: unknown, monthInput: unknown) {
    const storeId = id(storeIdInput);
    const range = monthRange(monthInput);
    await this.access.assertAnyStorePermission(user,
      ['HR_MONTH_LIST_READ', 'HR_MONTH_SUBMIT', 'HR_MONTH_APPROVE', 'HR_MONTH_EXPORT'], storeId);
    const rows = await this.db.hrMonthlyReview.findMany({ where: { storeId, month: range.start },
      orderBy: { revision: 'desc' } });
    return rows.map((row) => ({ id: Number(row.id), month: range.label, revision: row.revision,
      status: row.status, snapshotHash: row.snapshotHash,
      invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
      submittedAt: row.submittedAt.toISOString(), approvedAt: row.approvedAt?.toISOString() ?? null }));
  }

  @Cron('0 */5 * * * *', { timeZone: 'Asia/Shanghai' })
  async reconcileDecisions() {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database') return;
    const pending = await this.db.hrMonthlyReview.findMany({ where: { status: HrMonthlyReviewStatus.SUBMITTED,
      invalidatedAt: null },
      select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
    for (const row of pending) {
      const approval = await this.db.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.MONTHLY_REVIEW, subjectId: row.id },
      } });
      if (approval?.status === HrApprovalStatus.APPROVED || approval?.status === HrApprovalStatus.REJECTED) {
        try { await this.finalize(row.id, approval.status); }
        catch (error) { this.logger.error(`Monthly review ${row.id} reconcile failed`, error instanceof Error ? error.stack : String(error)); }
      }
    }
  }

  private async finalize(reviewId: bigint, approvalStatus: HrApprovalStatus) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_monthly_reviews WHERE id = ${reviewId} FOR UPDATE`;
      const review = await tx.hrMonthlyReview.findUnique({ where: { id: reviewId } });
      if (!review) throw new ConflictException('Monthly review is missing');
      if (review.status !== HrMonthlyReviewStatus.SUBMITTED)
        return { id: Number(reviewId), status: review.status };
      const approval = await tx.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.MONTHLY_REVIEW, subjectId: reviewId },
      } });
      if (approval?.status !== approvalStatus || approvalStatus === HrApprovalStatus.PENDING)
        throw new ConflictException('Approval state changed');
      const status = approvalStatus === HrApprovalStatus.APPROVED ? HrMonthlyReviewStatus.APPROVED : HrMonthlyReviewStatus.REJECTED;
      await tx.hrMonthlyReview.update({ where: { id: reviewId }, data: {
        status, approvedAt: status === HrMonthlyReviewStatus.APPROVED ? new Date() : null,
      } });
      await tx.auditLog.create({ data: {
        entityType: 'HR_MONTHLY_REVIEW', entityId: reviewId, action: status,
        afterData: { snapshotHash: review.snapshotHash, revision: review.revision },
      } });
      return { id: Number(reviewId), status, revision: review.revision };
    });
  }

  private async buildSnapshot(db: Prisma.TransactionClient | PrismaService, storeId: bigint,
    range: ReturnType<typeof monthRange>) {
    const storeRecords = await db.hrWorkRecord.findMany({ where: { storeId,
      versions: { some: { daySegments: { some: { businessDate: { gte: range.start, lt: range.end } } } } } },
      select: { employeeId: true, employee: { select: { status: true,
        jobPosition: { select: { scheduleOnly: true } } } } },
    });
      const employeeIds = [...new Set(storeRecords.filter((item) => !item.employee?.jobPosition?.scheduleOnly)
      .map((item) => item.employeeId))];
    const employeesById = new Map(storeRecords.map((item) => [Number(item.employeeId), item.employee]));
    const records = employeeIds.length ? await db.hrWorkRecord.findMany({ where: {
      employeeId: { in: employeeIds },
      versions: { some: { daySegments: { some: { businessDate: { gte: range.start, lt: range.end } } } } },
    }, include: { employee: { select: { displayName: true } },
      schedule: { include: { versions: true } },
      versions: { include: { daySegments: { where: { businessDate: { gte: range.start, lt: range.end } } } } } },
    }) : [];
    const names = new Map(records.map((record) => [Number(record.employeeId), record.employee.displayName]));
    const parts: MonthlyWorkPart[] = records.flatMap((record) => record.versions
      .filter((version) => version.version === record.currentVersion)
      .flatMap((version) => version.daySegments.map((segment) => ({
        employeeId: Number(record.employeeId), storeId: Number(record.storeId),
        businessDate: dateOnly(segment.businessDate), rawMinutes: segment.rawMinutes,
        recordId: Number(record.id), recordVersion: version.version,
      }))));
    const calculated = buildStoreMonthlyWorkSnapshot(Number(storeId), range.label, parts);
    const scheduledByDay = new Map<string, number>();
    for (const record of records) {
      const schedule = record.schedule;
      const version = schedule?.versions.find((item) => item.version === schedule.currentVersion);
      if (!schedule || !version) continue;
      const date = dateOnly(schedule.businessDate);
      if (!date.startsWith(`${range.label}-`)) continue;
      const minutes = Math.max(0, Math.floor((version.plannedEnd.getTime()
        - version.plannedStart.getTime()) / 60000) - version.breakMinutes);
      const key = `${Number(record.storeId)}:${Number(record.employeeId)}:${date}`;
      scheduledByDay.set(key, (scheduledByDay.get(key) ?? 0) + minutes);
    }
    const pendingSchedules = await db.hrSchedule.findMany({ where: {
      storeId, businessDate: { gte: range.previousDay, lt: range.end },
      status: 'PUBLISHED', workRecord: null,
    }, include: { versions: true, employee: { select: { jobPosition: { select: { scheduleOnly: true } } } } } });
    const pendingCorrections = await db.hrTimeCorrection.findMany({
      where: { status: HrTimeCorrectionStatus.PENDING, record: { storeId } },
      select: {
        id: true,
        proposedSegments: true,
        record: { select: {
          currentVersion: true,
          employee: { select: { jobPosition: { select: { scheduleOnly: true } } } },
          versions: { include: { daySegments: true } },
        } },
      },
    });
    const pendingTransfers = await db.hrTransferRequest.findMany({ where: {
      status: { in: [HrTransferStatus.PENDING, HrTransferStatus.APPROVED_AWAITING_EFFECTIVE] },
      requestedEffectiveDate: { lt: range.end },
      OR: [{ fromStoreId: storeId }, { toStoreId: storeId }],
    }, select: { id: true } });
    const issues: { code: string; ids?: number[]; days?: string[] }[] = [];
    if (!calculated.rows.length) issues.push({ code: 'NO_CONFIRMED_WORK' });
    if (calculated.unresolvedCrossStoreDays.length)
      issues.push({ code: 'CROSS_STORE_DAY_UNRESOLVED',
        days: calculated.unresolvedCrossStoreDays.map((item) => `${item.employeeId}:${item.businessDate}`) });
    const unconfirmed = pendingSchedules.filter((schedule) => {
      if (schedule.employee?.jobPosition?.scheduleOnly) return false;
      const current = schedule.versions.find((item) => item.version === schedule.currentVersion);
      return current && current.plannedEnd > range.startInstant && current.plannedStart < range.endInstant;
    });
    if (unconfirmed.length) issues.push({ code: 'UNCONFIRMED_SHIFTS', ids: unconfirmed.map((item) => Number(item.id)) });
    const pendingInMonth = pendingCorrections.filter((item) => !item.record.employee?.jobPosition?.scheduleOnly).filter((item) => {
      const proposed = Array.isArray(item.proposedSegments) && item.proposedSegments.some((part) =>
        part && typeof part === 'object' && !Array.isArray(part) &&
        typeof part.businessDate === 'string' && part.businessDate.startsWith(`${range.label}-`));
      const previous = item.record.versions.some((version) => version.version === item.record.currentVersion &&
        version.daySegments.some((segment) => dateOnly(segment.businessDate).startsWith(`${range.label}-`)));
      return proposed || previous;
    });
    if (pendingInMonth.length) issues.push({ code: 'PENDING_TIME_CORRECTIONS', ids: pendingInMonth.map((item) => Number(item.id)) });
    if (pendingTransfers.length) issues.push({ code: 'PENDING_TRANSFERS', ids: pendingTransfers.map((item) => Number(item.id)) });
    let payRows: Array<{ employeeId: number; businessDate: string; hourlyRate: string | null;
      basePayAmount: string | null; trialNotPayable: boolean }> | undefined;
    let totalBasePayAmount: string | null | undefined;
    if (process.env.HR_PAY_CALC_ENABLED === 'true') {
      const rates = employeeIds.length ? await db.hrSalaryRate.findMany({ where: {
        employeeId: { in: employeeIds }, effectiveFrom: { lt: range.end },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: range.start } }],
      } }) : [];
      payRows = calculated.rows.map((row) => {
        const employee = employeesById.get(row.employeeId);
        if (employee?.status === 'TRIAL' || employee?.status === 'TRIAL_ENDED') return { employeeId: row.employeeId,
          businessDate: row.businessDate, hourlyRate: null, basePayAmount: null, trialNotPayable: true };
        const matches = rates.filter((rate) => Number(rate.employeeId) === row.employeeId &&
          dateOnly(rate.effectiveFrom) <= row.businessDate &&
          (!rate.effectiveToExclusive || dateOnly(rate.effectiveToExclusive) > row.businessDate));
        if (matches.length !== 1 || row.statisticalMinutes == null) {
          if (matches.length !== 1) issues.push({ code: 'MISSING_OR_OVERLAPPING_HOURLY_RATE',
            ids: [row.employeeId], days: [row.businessDate] });
          return { employeeId: row.employeeId, businessDate: row.businessDate,
            hourlyRate: null, basePayAmount: null, trialNotPayable: false };
        }
        const rate = matches[0].hourlyRate.toFixed(2);
        return { employeeId: row.employeeId, businessDate: row.businessDate, hourlyRate: rate,
          basePayAmount: calculateDailyHourlyPay(row.statisticalMinutes, rate).amount, trialNotPayable: false };
      });
      const pendingSalary = employeeIds.length ? await db.hrSalaryChangeRequest.findMany({ where: {
        employeeId: { in: employeeIds }, effectiveDate: { lt: range.end },
        status: { in: ['SUBMITTED', 'APPROVED_AWAITING_EFFECTIVE'] },
      }, select: { id: true } }) : [];
      if (pendingSalary.length) issues.push({ code: 'PENDING_SALARY_CHANGES',
        ids: pendingSalary.map((item) => Number(item.id)) });
      const payableRows = payRows.filter((row) => !row.trialNotPayable);
      totalBasePayAmount = payableRows.length === 0 ? '0.00' : payableRows.every((row) => row.basePayAmount != null)
        ? sumDailyHourlyPay(payableRows.map((row) => row.basePayAmount!)) : null;
    }
    // Freeze the effective rate intervals into the approved snapshot so later rate changes
    // cannot alter the explanation of a previously approved monthly calculation.
    const salarySegments = process.env.HR_PAY_CALC_ENABLED === 'true' && employeeIds.length
      ? (await db.hrSalaryRate.findMany({ where: { employeeId: { in: employeeIds },
        effectiveFrom: { lt: range.end },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: range.start } }],
      }, orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }] })).map((rate) => ({
        employeeId: Number(rate.employeeId), employeeName: names.get(Number(rate.employeeId)) ?? '未知员工',
        effectiveFrom: dateOnly(rate.effectiveFrom) < range.label + '-01' ? range.label + '-01' : dateOnly(rate.effectiveFrom),
        effectiveToExclusive: !rate.effectiveToExclusive || dateOnly(rate.effectiveToExclusive) > dateOnly(range.end)
          ? dateOnly(range.end) : dateOnly(rate.effectiveToExclusive),
        hourlyRate: rate.hourlyRate.toFixed(2),
      })) : undefined;
    // Keep a minimal correction trace in the frozen report: affected dates and minute totals.
    // Free-text reasons stay in the permission-checked correction workflow and are not copied
    // into an export, where users may have accidentally entered personal data.
    const appliedCorrections = employeeIds.length ? await db.hrTimeCorrection.findMany({
      where: { status: HrTimeCorrectionStatus.APPLIED, record: { storeId, employeeId: { in: employeeIds } } },
      include: { record: { select: { id: true, employeeId: true, employee: { select: { displayName: true } },
        versions: { include: { daySegments: true } } } } },
      orderBy: { id: 'asc' }, take: 1000,
    }) : [];
    const corrections = appliedCorrections.flatMap((item) => {
      const before = item.record.versions.find((version) => version.version === item.expectedVersion);
      const after = item.record.versions.find((version) => version.version === item.expectedVersion + 1);
      const inMonth = (segment: { businessDate: Date }) => segment.businessDate >= range.start && segment.businessDate < range.end;
      const beforeSegments = before?.daySegments.filter(inMonth) ?? [];
      const afterSegments = after?.daySegments.filter(inMonth) ?? [];
      const businessDates = [...new Set([...beforeSegments, ...afterSegments].map((segment) => dateOnly(segment.businessDate)))].sort();
      if (!businessDates.length) return [];
      return [{ correctionId: Number(item.id), recordId: Number(item.recordId),
        employeeId: Number(item.record.employeeId), employeeName: item.record.employee.displayName,
        expectedVersion: item.expectedVersion, appliedVersion: item.expectedVersion + 1,
        businessDates, beforeRawMinutes: beforeSegments.reduce((sum, segment) => sum + segment.rawMinutes, 0),
        afterRawMinutes: afterSegments.reduce((sum, segment) => sum + segment.rawMinutes, 0),
        appliedAt: item.appliedAt?.toISOString() ?? null }];
    });
    const snapshot = { ...calculated,
      rows: calculated.rows.map((row) => ({ ...row,
        scheduledMinutes: scheduledByDay.get(`${Number(storeId)}:${row.employeeId}:${row.businessDate}`) ?? 0,
        employeeName: names.get(row.employeeId) ?? '未知员工',
        ...(payRows ? { trialNotPayable: payRows.find((pay) => pay.employeeId === row.employeeId &&
          pay.businessDate === row.businessDate)?.trialNotPayable ?? false,
          hourlyRate: payRows.find((pay) => pay.employeeId === row.employeeId &&
          pay.businessDate === row.businessDate)?.hourlyRate ?? null,
          basePayAmount: payRows.find((pay) => pay.employeeId === row.employeeId &&
            pay.businessDate === row.businessDate)?.basePayAmount ?? null } : {}) })),
      totalScheduledMinutes: calculated.rows.reduce((sum, row) => sum +
        (scheduledByDay.get(`${Number(storeId)}:${row.employeeId}:${row.businessDate}`) ?? 0), 0),
      ...(payRows ? { totalBasePayAmount } : {}),
      corrections,
      ...(salarySegments ? { salarySegments } : {}),
      label: payRows ? '基础时薪应发工资：每班次取整、每日金额四舍五入后求和；不含其他工资项目' :
        '业务工时审核数据，非工资支付指令' };
    return { snapshot, issues };
  }
}
