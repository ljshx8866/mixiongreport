import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { HrApprovalKind, HrApprovalStatus, HrTimeCorrectionStatus, HrTransferDecisionType, Prisma } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrApprovalService } from './hr-approval.service';
import { actualWork, deductBreakMinutes, storedBreakMinutes } from './hr-time.service';
import { calculateDailyWorkTime } from '@restaurant/hr-engine';

function id(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

@Injectable()
export class HrTimeCorrectionService {
  private readonly logger = new Logger(HrTimeCorrectionService.name);
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly approvals: HrApprovalService) {}

  async request(user: AuthContext | undefined, input: Record<string, unknown>) {
    const recordId = id(input.recordId);
    const expectedVersion = Number(input.expectedVersion);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const action = input.action === undefined ? 'ADJUST' : input.action;
    if (action !== 'ADJUST' && action !== 'DELETE')
      throw new BadRequestException('Invalid correction action');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !reason)
      throw new BadRequestException('Record version and correction reason are required');
    const record = await this.db.hrWorkRecord.findUnique({ where: { id: recordId }, select: {
      storeId: true, currentVersion: true,
      employee: { select: { jobPosition: { select: { scheduleOnly: true } } } },
    } });
    if (!record || record.currentVersion !== expectedVersion)
      throw new ConflictException('Work record changed; reload');
    if (record.employee?.jobPosition?.scheduleOnly)
      throw new ConflictException('该岗位仅用于排班，没有工时记录可更正');
    // Direct correction and deletion are separate action permissions.
    await this.access.assertStorePermission(user, action === 'DELETE'
      ? 'HR_TIME_CORRECTION_DELETE' : 'HR_TIME_CORRECTION_EDIT', record.storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_work_records WHERE id = ${recordId} FOR UPDATE`;
      const current = await tx.hrWorkRecord.findUnique({ where: { id: recordId }, include: {
        versions: { where: { version: expectedVersion }, include: { daySegments: true } },
      } });
      if (!current || current.currentVersion !== expectedVersion)
        throw new ConflictException('Work record changed; reload');
      const currentVersion = current.versions?.find((item) => item.version === expectedVersion);
      if (!currentVersion) throw new ConflictException('Current work version is missing; reload');
      let proposal = null as ReturnType<typeof actualWork> | null;
      if (action === 'ADJUST') {
        const originalBreaks = Array.isArray(currentVersion.breaks) ? currentVersion.breaks : [];
        proposal = actualWork(input, input.breaks === undefined ? originalBreaks : undefined);
        if (input.breaks === undefined) {
          const recordedBreakMinutes = currentVersion.daySegments.reduce((total, part) => total + part.breakMinutes, 0);
          const untimedBreakMinutes = Math.max(0, recordedBreakMinutes - storedBreakMinutes(originalBreaks));
          if (untimedBreakMinutes) proposal = deductBreakMinutes(proposal, untimedBreakMinutes);
        }
      }
      if (action === 'DELETE' && (!currentVersion || !currentVersion.daySegments.length))
        throw new ConflictException('This work record is already removed; reload');
      const pendingCount = await tx.hrTimeCorrection.count({ where: {
        recordId, status: HrTimeCorrectionStatus.PENDING,
      } });
      if (pendingCount) {
        const pending = await tx.hrTimeCorrection.findMany({ where: {
          recordId, status: HrTimeCorrectionStatus.PENDING,
        }, select: { id: true } });
        const pendingIds = pending.map((item) => item.id);
        if (pendingIds.length) {
          await tx.hrTimeCorrection.updateMany({ where: { id: { in: pendingIds }, status: HrTimeCorrectionStatus.PENDING },
            data: { status: HrTimeCorrectionStatus.REJECTED, failureCode: 'SUPERSEDED_BY_DIRECT_CORRECTION' } });
          await tx.hrApprovalInstance.updateMany({ where: { kind: HrApprovalKind.TIME_CORRECTION,
            subjectId: { in: pendingIds }, status: HrApprovalStatus.PENDING },
          data: { status: HrApprovalStatus.REJECTED, currentPosition: null } });
          await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_WORK_RECORD',
            entityId: recordId, action: 'LEGACY_CORRECTION_SUPERSEDED',
            afterData: { correctionIds: pendingIds.map(String), reason: 'Direct correction workflow enabled' } } });
        }
      }
      const now = new Date();
      const segments = proposal?.segments ?? [];
      const created = await tx.hrTimeCorrection.create({ data: {
        recordId, expectedVersion,
        proposedStart: proposal?.start.date ?? currentVersion.actualStart,
        proposedEnd: proposal?.end.date ?? currentVersion.actualEnd,
        proposedBreaks: proposal ? proposal.breaks.map((item) => ({
          start: new Date(item.startEpochMinutes * 60000).toISOString(),
          end: new Date(item.endEpochMinutes * 60000).toISOString(),
        })) : currentVersion.breaks as Prisma.InputJsonValue,
        // An empty segment list is the versioned deletion marker; source versions remain intact.
        proposedSegments: segments, proposedRawMinutes: proposal?.rawMinutes ?? 0,
        reason, requestedBy: actorId, status: HrTimeCorrectionStatus.APPLIED, appliedAt: now,
      } });
      const nextVersion = current.currentVersion + 1;
      await tx.hrWorkRecordVersion.create({ data: {
        recordId, version: nextVersion,
        actualStart: proposal?.start.date ?? currentVersion.actualStart,
        actualEnd: proposal?.end.date ?? currentVersion.actualEnd,
        breaks: proposal ? proposal.breaks.map((item) => ({
          start: new Date(item.startEpochMinutes * 60000).toISOString(),
          end: new Date(item.endEpochMinutes * 60000).toISOString(),
        })) : currentVersion.breaks as Prisma.InputJsonValue,
        rawMinutes: proposal?.rawMinutes ?? 0, confirmedBy: actorId, reason,
        daySegments: { create: segments.map((part) => ({
          businessDate: new Date(`${part.businessDate}T00:00:00.000Z`),
          elapsedMinutes: part.elapsedMinutes, breakMinutes: part.breakMinutes, rawMinutes: part.rawMinutes,
        })) },
      } });
      await tx.hrWorkRecord.update({ where: { id: recordId }, data: { currentVersion: nextVersion } });
      await this.refreshDailyInputLaborHours(tx, current.storeId, [
        ...currentVersion.daySegments.map((part) => part.businessDate.toISOString().slice(0, 10)),
        ...segments.map((part) => part.businessDate),
      ]);
      const affectedMonths = new Set<string>([
        ...currentVersion.daySegments.map((part) => part.businessDate.toISOString().slice(0, 7)),
        ...segments.map((part) => part.businessDate.slice(0, 7)),
      ]);
      for (const month of affectedMonths) {
        await tx.hrMonthlyReview.updateMany({ where: { storeId: current.storeId,
          month: new Date(`${month}-01T00:00:00.000Z`), status: 'APPROVED', invalidatedAt: null },
        data: { invalidatedAt: now, invalidationReason: `TIME_CORRECTION:${created.id}` },
        });
      }
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_TIME_CORRECTION', entityId: created.id, action: 'DIRECT_APPLY',
        beforeData: { recordId: String(recordId), version: expectedVersion,
          actualStart: currentVersion.actualStart.toISOString(), actualEnd: currentVersion.actualEnd.toISOString(),
          rawMinutes: currentVersion.rawMinutes },
        afterData: { recordId: String(recordId), version: nextVersion, action,
          actualStart: proposal?.start.date.toISOString() ?? currentVersion.actualStart.toISOString(),
          actualEnd: proposal?.end.date.toISOString() ?? currentVersion.actualEnd.toISOString(),
          rawMinutes: proposal?.rawMinutes ?? 0, reason },
      } });
      return { id: Number(created.id), status: HrTimeCorrectionStatus.APPLIED,
        recordVersion: nextVersion, deleted: segments.length === 0 };
    });
  }

  async decide(user: AuthContext | undefined, correctionIdInput: unknown, input: Record<string, unknown>) {
    const correctionId = id(correctionIdInput);
    const decision = input.decision;
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (decision !== HrTransferDecisionType.APPROVE && decision !== HrTransferDecisionType.REJECT)
      throw new BadRequestException('Invalid correction decision');
    const correction = await this.db.hrTimeCorrection.findUnique({ where: { id: correctionId } });
    if (!correction || correction.status !== HrTimeCorrectionStatus.PENDING)
      throw new ConflictException('Correction is not pending');
    const instance = await this.db.hrApprovalInstance.findUnique({ where: {
      kind_subjectId: { kind: HrApprovalKind.TIME_CORRECTION, subjectId: correctionId },
    } });
    if (!instance) throw new ConflictException('Approval instance is missing');
    const progress = await this.approvals.decide(user, instance.id, decision, reason);
    if (progress.status === HrApprovalStatus.REJECTED) {
      await this.db.hrTimeCorrection.update({ where: { id: correctionId },
        data: { status: HrTimeCorrectionStatus.REJECTED } });
      return { id: Number(correctionId), status: HrTimeCorrectionStatus.REJECTED };
    }
    if (progress.status === HrApprovalStatus.APPROVED) return this.applyApproved(correctionId);
    return { id: Number(correctionId), status: HrTimeCorrectionStatus.PENDING,
      nextApprovalPosition: progress.nextPosition };
  }

  async list(user: AuthContext | undefined, storeIdInput: unknown) {
    const storeId = id(storeIdInput);
    await this.access.assertAnyStorePermission(user,
      ['HR_TIME_CORRECTION_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE'], storeId);
    const rows = await this.db.hrTimeCorrection.findMany({ where: { record: { storeId } },
      include: { record: { select: { employeeId: true } } }, orderBy: { id: 'desc' }, take: 100 });
    return rows.map((item) => ({ id: Number(item.id), recordId: Number(item.recordId),
      employeeId: Number(item.record.employeeId), expectedVersion: item.expectedVersion,
      action: Array.isArray(item.proposedSegments) && item.proposedSegments.length === 0 ? 'DELETE' : 'ADJUST',
      proposedStatisticalMinutes: calculateDailyWorkTime(Array.isArray(item.proposedSegments)
        ? item.proposedSegments.flatMap((part) => part && typeof part === 'object' && !Array.isArray(part) &&
          Number.isSafeInteger((part as Record<string, unknown>).rawMinutes)
          ? [{ rawMinutes: Number((part as Record<string, unknown>).rawMinutes) }] : []) : []).statisticalMinutes,
      reason: item.reason, status: item.status,
      failureCode: item.failureCode }));
  }

  @Cron('0 */5 * * * *', { timeZone: 'Asia/Shanghai' })
  async reconcileApproved() {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database') return;
    const pending = await this.db.hrTimeCorrection.findMany({ where: { status: HrTimeCorrectionStatus.PENDING },
      select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
    for (const item of pending) {
      const approval = await this.db.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.TIME_CORRECTION, subjectId: item.id },
      } });
      if (approval?.status === HrApprovalStatus.APPROVED) {
        try { await this.applyApproved(item.id); }
        catch (error) { this.logger.error(`Correction ${item.id} apply retry failed`, error instanceof Error ? error.stack : String(error)); }
      } else if (approval?.status === HrApprovalStatus.REJECTED) {
        await this.db.hrTimeCorrection.updateMany({ where: { id: item.id, status: HrTimeCorrectionStatus.PENDING },
          data: { status: HrTimeCorrectionStatus.REJECTED } });
      }
    }
  }

  private async applyApproved(correctionId: bigint) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_time_corrections WHERE id = ${correctionId} FOR UPDATE`;
      const correction = await tx.hrTimeCorrection.findUnique({ where: { id: correctionId } });
      if (!correction || correction.status !== HrTimeCorrectionStatus.PENDING)
        throw new ConflictException('Correction already handled');
      const approval = await tx.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.TIME_CORRECTION, subjectId: correctionId },
      }, include: { steps: { orderBy: { position: 'desc' } } } });
      if (approval?.status !== HrApprovalStatus.APPROVED)
        throw new ConflictException('Correction approval is not complete');
      const approverId = approval.steps.find((step) => step.decision === HrTransferDecisionType.APPROVE)?.actorId;
      if (!approverId) throw new ConflictException('Correction approver is missing');
      await tx.$queryRaw`SELECT id FROM hr_work_records WHERE id = ${correction.recordId} FOR UPDATE`;
      const record = await tx.hrWorkRecord.findUnique({ where: { id: correction.recordId },
        include: { versions: { where: { version: correction.expectedVersion },
          include: { daySegments: true } } } });
      if (!record || record.currentVersion !== correction.expectedVersion) {
        await tx.hrTimeCorrection.update({ where: { id: correctionId }, data: {
          status: HrTimeCorrectionStatus.APPLY_FAILED, failureCode: 'WORK_VERSION_CHANGED',
        } });
        return { id: Number(correctionId), status: HrTimeCorrectionStatus.APPLY_FAILED,
          failureCode: 'WORK_VERSION_CHANGED' };
      }
      const segments = correction.proposedSegments;
      if (!Array.isArray(segments) || (!segments.length && correction.proposedRawMinutes !== 0))
        throw new ConflictException('Correction segments are missing');
      const nextVersion = record.currentVersion + 1;
      await tx.hrWorkRecordVersion.create({ data: {
        recordId: record.id, version: nextVersion,
        actualStart: correction.proposedStart, actualEnd: correction.proposedEnd,
        breaks: correction.proposedBreaks as Prisma.InputJsonValue,
        rawMinutes: correction.proposedRawMinutes, confirmedBy: approverId,
        reason: correction.reason,
        daySegments: { create: segments.map((part) => {
          if (!part || typeof part !== 'object' || Array.isArray(part))
            throw new ConflictException('Invalid correction segment');
          const segment = part as Record<string, unknown>;
          if (typeof segment.businessDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(segment.businessDate))
            throw new ConflictException('Invalid correction date');
          return { businessDate: new Date(`${segment.businessDate}T00:00:00.000Z`),
            elapsedMinutes: Number(segment.elapsedMinutes),
            breakMinutes: Number(segment.breakMinutes), rawMinutes: Number(segment.rawMinutes) };
        }) },
      } });
      await tx.hrWorkRecord.update({ where: { id: record.id }, data: { currentVersion: nextVersion } });
      const previousVersion = record.versions.find((version) => version.version === correction.expectedVersion);
      await this.refreshDailyInputLaborHours(tx, record.storeId, [
        ...(previousVersion?.daySegments ?? []).map((part) => part.businessDate.toISOString().slice(0, 10)),
        ...segments.flatMap((part) => part && typeof part === 'object' && !Array.isArray(part) &&
          typeof (part as Record<string, unknown>).businessDate === 'string'
          ? [String((part as Record<string, unknown>).businessDate)] : []),
      ]);
      await tx.hrTimeCorrection.update({ where: { id: correctionId }, data: {
        status: HrTimeCorrectionStatus.APPLIED, appliedAt: new Date(),
      } });
      const affectedMonths = new Set<string>([
        ...record.versions.flatMap((version) => version.daySegments.map((part) => part.businessDate.toISOString().slice(0, 7))),
        ...segments.map((part) => String((part as Record<string, unknown>).businessDate).slice(0, 7)),
      ]);
      for (const month of affectedMonths) {
        await tx.hrMonthlyReview.updateMany({ where: { storeId: record.storeId,
          month: new Date(`${month}-01T00:00:00.000Z`), status: 'APPROVED', invalidatedAt: null },
          data: { invalidatedAt: new Date(), invalidationReason: `TIME_CORRECTION:${correctionId}` },
        });
      }
      await tx.auditLog.create({ data: {
        entityType: 'HR_TIME_CORRECTION', entityId: correctionId, action: 'APPLY',
        afterData: { recordId: String(record.id), version: nextVersion,
          action: segments.length ? 'ADJUST' : 'DELETE', rawMinutes: correction.proposedRawMinutes },
      } });
      return { id: Number(correctionId), status: HrTimeCorrectionStatus.APPLIED,
        recordVersion: nextVersion, deleted: segments.length === 0 };
    });
  }

  /** Keep already-submitted report inputs aligned with the current confirmed work versions. */
  private async refreshDailyInputLaborHours(tx: Prisma.TransactionClient, storeId: bigint,
    businessDates: string[]) {
    const dates = [...new Set(businessDates)].filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (!dates.length) return;
    const dateValues = dates.map((value) => new Date(`${value}T00:00:00.000Z`));
    const records = await tx.hrWorkRecord.findMany({
      where: { storeId, versions: { some: { daySegments: { some: { businessDate: { in: dateValues } } } } } },
      include: {
        employee: { select: { jobPosition: { select: { scheduleOnly: true } } } },
        versions: { where: { daySegments: { some: { businessDate: { in: dateValues } } } },
          include: { daySegments: { where: { businessDate: { in: dateValues } } } } },
      },
    });
    const totals = new Map(dates.map((value) => [value, 0]));
    for (const record of records) {
      if (record.employee.jobPosition?.scheduleOnly) continue;
      const current = record.versions.find((version) => version.version === record.currentVersion);
      if (!current) continue;
      for (const segment of current.daySegments) {
        const date = segment.businessDate.toISOString().slice(0, 10);
        if (totals.has(date)) totals.set(date, (totals.get(date) ?? 0) +
          calculateDailyWorkTime([{ rawMinutes: segment.rawMinutes }]).statisticalMinutes);
      }
    }
    for (const date of dates) {
      const statisticalMinutes = totals.get(date) ?? 0;
      await tx.storeDailyInput.updateMany({
        where: { storeId, businessDate: new Date(`${date}T00:00:00.000Z`) },
        data: { laborHours: Number((statisticalMinutes / 60).toFixed(2)) },
      });
    }
  }
}
