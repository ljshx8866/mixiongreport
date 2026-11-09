import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HrEmployeeStatus, HrTransferDecisionType, HrTransferStatus, HrTransferStep } from '@prisma/client';
import { applyTransferDecision, findPrimaryAppointmentOverlaps } from '@restaurant/hr-engine';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrApprovalNotificationService } from './hr-approval-notification.service';

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

function parseBusinessDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Effective date must be YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateOnly(date) !== value)
    throw new BadRequestException('Invalid effective date');
  return date;
}

function todayInShanghai(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return parseBusinessDate(`${part('year')}-${part('month')}-${part('day')}`);
}

const approvalPermissions: Record<HrTransferStep, string> = {
  SOURCE_STORE: 'HR_TRANSFER_APPROVE_SOURCE',
  DESTINATION_STORE: 'HR_TRANSFER_APPROVE_DESTINATION',
  HR: 'HR_TRANSFER_APPROVE_HR',
};

@Injectable()
export class HrTransferService {
  private readonly logger = new Logger(HrTransferService.name);
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly notifications?: HrApprovalNotificationService) {}

  async destinations(user: AuthContext | undefined, fromStoreId: bigint) {
    await this.access.assertStorePermission(user, 'HR_TRANSFER_REQUEST', fromStoreId);
    const stores = await this.db.store.findMany({ where: { status: true, id: { not: fromStoreId } },
      select: { id: true, storeName: true }, orderBy: { storeName: 'asc' } });
    return stores.map((store) => ({ id: Number(store.id), storeName: store.storeName }));
  }

  async request(user: AuthContext | undefined, input: Record<string, unknown>) {
    const employeeId = this.positiveId(input.employeeId);
    const fromStoreId = this.positiveId(input.fromStoreId);
    const toStoreId = this.positiveId(input.toStoreId);
    const effectiveDate = parseBusinessDate(input.requestedEffectiveDate);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (fromStoreId === toStoreId || !reason) throw new BadRequestException('Different stores and a reason are required');
    await this.access.assertStorePermission(user, 'HR_TRANSFER_REQUEST', fromStoreId);
    if (!await this.db.store.findFirst({ where: { id: toStoreId, status: true }, select: { id: true } }))
      throw new BadRequestException('Destination store is unavailable');
    const actorId = BigInt(user!.id!);

    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
      if (!locked.length) throw new BadRequestException('Employee does not exist');
      const employee = await tx.hrEmployee.findUnique({ where: { id: employeeId }, select: { status: true } });
      if (employee?.status !== HrEmployeeStatus.ACTIVE)
        throw new ConflictException('Only active employees can transfer');
      const departure = await tx.hrOffboardingRequest.findFirst({ where: { employeeId,
        status: { in: ['SUBMITTED', 'APPROVED_AWAITING_EFFECTIVE'] } }, select: { id: true } });
      if (departure) throw new ConflictException('Employee has an unfinished offboarding request');
      const pending = await tx.hrTransferRequest.count({ where: {
        employeeId, status: { in: [HrTransferStatus.PENDING, HrTransferStatus.APPROVED_AWAITING_EFFECTIVE] },
      } });
      if (pending) throw new ConflictException('Employee already has an unfinished transfer');
      const source = await tx.hrPrimaryAppointment.findFirst({ where: {
        employeeId, effectiveFrom: { lte: effectiveDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: effectiveDate } }],
      } });
      if (!source || source.storeId !== fromStoreId)
        throw new ConflictException('Source store is not the primary appointment on the effective date');
      const created = await tx.hrTransferRequest.create({ data: {
        employeeId, fromStoreId, toStoreId, requestedEffectiveDate: effectiveDate,
        reason, requestedBy: actorId, nextStep: HrTransferStep.DESTINATION_STORE,
      } });
      if (created.nextStep) await this.notifications?.queueTransferStep(tx, {
        subjectId: created.id, requestedBy: actorId, fromStoreId, toStoreId, nextStep: created.nextStep,
      });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_TRANSFER', entityId: created.id, action: 'REQUEST',
        afterData: { employeeId: String(employeeId), fromStoreId: String(fromStoreId), toStoreId: String(toStoreId), requestedEffectiveDate: dateOnly(effectiveDate) },
      } });
      return { id: Number(created.id), status: created.status, nextStep: created.nextStep };
    });
  }

  async decide(user: AuthContext | undefined, transferIdValue: number, input: Record<string, unknown>) {
    const transferId = this.positiveId(transferIdValue);
    const decision = input.decision;
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (decision !== 'APPROVE' && decision !== 'REJECT') throw new BadRequestException('Invalid transfer decision');
    if (decision === 'REJECT' && !reason) throw new BadRequestException('A rejection reason is required');
    const preview = await this.db.hrTransferRequest.findUnique({ where: { id: transferId } });
    if (!preview || preview.status !== HrTransferStatus.PENDING || !preview.nextStep)
      throw new ConflictException('Transfer is not awaiting approval');
    const permissionStoreId = preview.nextStep === HrTransferStep.SOURCE_STORE ? preview.fromStoreId : preview.toStoreId;
    await this.access.assertStorePermission(user, approvalPermissions[preview.nextStep], permissionStoreId);
    const actorId = BigInt(user!.id!);

    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_transfer_requests WHERE id = ${transferId} FOR UPDATE`;
      const current = await tx.hrTransferRequest.findUnique({
        where: { id: transferId }, include: { decisions: { orderBy: { id: 'asc' } } },
      });
      if (!current || current.status !== HrTransferStatus.PENDING || !current.nextStep || current.nextStep !== preview.nextStep)
        throw new ConflictException('Approval step changed; reload the transfer');
      const progress = applyTransferDecision({
        status: 'PENDING', nextStep: current.nextStep,
        decisions: current.decisions.map((item) => ({ step: item.step, decision: item.decision })),
      }, current.nextStep, decision);
      await tx.hrTransferDecision.create({ data: {
        transferId, step: current.nextStep, decision: decision as HrTransferDecisionType,
        actorUserId: actorId, reason: reason || null,
      } });
      const updated = await tx.hrTransferRequest.update({ where: { id: transferId }, data: {
        status: progress.status as HrTransferStatus,
        nextStep: progress.nextStep as HrTransferStep | null,
        version: { increment: 1 },
      } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_TRANSFER', entityId: transferId, action: decision,
        beforeData: { status: current.status, nextStep: current.nextStep },
        afterData: { status: updated.status, nextStep: updated.nextStep, reason: reason || null },
      } });
      if (decision === 'REJECT') {
        await this.notifications?.queueTransferCorrection(tx, {
          subjectId: current.id, requestedBy: current.requestedBy, fromStoreId: current.fromStoreId,
        });
      } else if (updated.nextStep) {
        await this.notifications?.queueTransferStep(tx, {
          subjectId: current.id, requestedBy: current.requestedBy, fromStoreId: current.fromStoreId,
          toStoreId: current.toStoreId, nextStep: updated.nextStep,
        });
      } else if (updated.status === HrTransferStatus.APPROVED_AWAITING_EFFECTIVE) {
        await tx.userNotification.createMany({
          data: [{
            userId: current.requestedBy,
            category: 'RESULT',
            title: '员工转店审批已通过',
            summary: `转店申请已通过，计划生效日期：${dateOnly(current.requestedEffectiveDate)}`,
            page: `pages/hr/transfer?storeId=${Number(current.fromStoreId)}`,
            eventKey: `hr:transfer:${current.id}:approved:${current.version + 1}`,
          }],
          skipDuplicates: true,
        });
      }
      return { status: updated.status, nextStep: updated.nextStep, effectiveDate: updated.requestedEffectiveDate };
    });
    if (result.status === HrTransferStatus.APPROVED_AWAITING_EFFECTIVE && result.effectiveDate <= todayInShanghai()) {
      try { await this.applyOne(transferId); }
      catch (error) { this.logger.error(`Transfer ${transferId} immediate effect failed`, error instanceof Error ? error.stack : String(error)); }
    }
    const current = await this.db.hrTransferRequest.findUnique({ where: { id: transferId } });
    return { id: Number(transferId), status: current?.status ?? result.status, nextStep: current?.nextStep ?? null };
  }

  async list(user: AuthContext | undefined, storeId: bigint) {
    await this.access.assertAnyStorePermission(user, [
      'HR_EMPLOYEE_LIST_READ', 'HR_TRANSFER_LIST_READ', 'HR_TRANSFER_REQUEST', 'HR_TRANSFER_APPROVE_SOURCE',
      'HR_TRANSFER_APPROVE_DESTINATION', 'HR_TRANSFER_APPROVE_HR',
    ], storeId);
    const transfers = await this.db.hrTransferRequest.findMany({
      where: { OR: [{ fromStoreId: storeId }, { toStoreId: storeId }] },
      include: { employee: { select: { displayName: true } }, decisions: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'desc' }, take: 100,
    });
    return transfers.map((item) => ({
      id: Number(item.id), employeeId: Number(item.employeeId), employeeName: item.employee.displayName,
      fromStoreId: Number(item.fromStoreId), toStoreId: Number(item.toStoreId),
      requestedEffectiveDate: dateOnly(item.requestedEffectiveDate), status: item.status,
      nextStep: item.nextStep, reconciliationRequired: item.reconciliationRequired,
      failureCode: item.failureCode,
      decisions: item.decisions.map((decision) => ({
        step: decision.step, decision: decision.decision, decidedAt: decision.decidedAt,
      })),
    }));
  }

  @Cron('0 */5 * * * *', { timeZone: 'Asia/Shanghai' })
  async applyDue() {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database') return;
    const due = await this.db.hrTransferRequest.findMany({
      where: { status: HrTransferStatus.APPROVED_AWAITING_EFFECTIVE, requestedEffectiveDate: { lte: todayInShanghai() } },
      select: { id: true }, orderBy: { id: 'asc' }, take: 50,
    });
    for (const item of due) {
      try { await this.applyOne(item.id); }
      catch (error) { this.logger.error(`Transfer ${item.id} scheduled effect failed`, error instanceof Error ? error.stack : String(error)); }
    }
  }

  private async applyOne(transferId: bigint) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_transfer_requests WHERE id = ${transferId} FOR UPDATE`;
      const transfer = await tx.hrTransferRequest.findUnique({ where: { id: transferId } });
      if (!transfer || transfer.status !== HrTransferStatus.APPROVED_AWAITING_EFFECTIVE) return false;
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${transfer.employeeId} FOR UPDATE`;
      const employee = await tx.hrEmployee.findUnique({ where: { id: transfer.employeeId }, select: { status: true, userId: true } });
      const appointments = await tx.hrPrimaryAppointment.findMany({
        where: { employeeId: transfer.employeeId }, orderBy: { effectiveFrom: 'asc' },
      });
      const boundary = transfer.requestedEffectiveDate;
      const source = appointments.find((item) => item.effectiveFrom <= boundary &&
        (item.effectiveToExclusive === null || item.effectiveToExclusive > boundary));
      const conflict = employee?.status !== HrEmployeeStatus.ACTIVE || !source || source.storeId !== transfer.fromStoreId || source.effectiveFrom > boundary;
      if (conflict) {
        await tx.hrTransferRequest.update({ where: { id: transferId }, data: {
          status: HrTransferStatus.EFFECTIVE_FAILED, nextStep: null, failureCode: 'SOURCE_APPOINTMENT_CONFLICT',
        } });
        await tx.auditLog.create({ data: {
          entityType: 'HR_TRANSFER', entityId: transferId, action: 'EFFECT_FAILED',
          afterData: { failureCode: 'SOURCE_APPOINTMENT_CONFLICT' },
        } });
        return false;
      }
      const sameDayMove = source.effectiveFrom.getTime() === boundary.getTime();
      const revised = appointments.map((item) => ({
        storeId: String(item.id === source.id && sameDayMove ? transfer.toStoreId : item.storeId),
        effectiveFrom: dateOnly(item.effectiveFrom),
        effectiveToExclusive: item.id === source.id && !sameDayMove ? dateOnly(boundary) :
          item.effectiveToExclusive ? dateOnly(item.effectiveToExclusive) : null,
      }));
      if (!sameDayMove) revised.push({
        storeId: String(transfer.toStoreId), effectiveFrom: dateOnly(boundary),
        effectiveToExclusive: source.effectiveToExclusive ? dateOnly(source.effectiveToExclusive) : null,
      });
      if (findPrimaryAppointmentOverlaps(revised).length) throw new ConflictException('Appointment intervals overlap');
      if (sameDayMove) {
        // A zero-length source appointment is invalid; when the transfer date is
        // the appointment start date, move that appointment in place.
        await tx.hrPrimaryAppointment.update({ where: { id: source.id }, data: { storeId: transfer.toStoreId } });
      } else {
        await tx.hrPrimaryAppointment.update({ where: { id: source.id }, data: { effectiveToExclusive: boundary } });
        await tx.hrPrimaryAppointment.create({ data: {
          employeeId: transfer.employeeId, storeId: transfer.toStoreId,
          effectiveFrom: boundary, effectiveToExclusive: source.effectiveToExclusive,
        } });
      }
      if (employee.userId != null) {
        const beforeStoreIds = (await tx.userStore.findMany({ where: { userId: employee.userId },
          select: { storeId: true } })).map((item) => String(item.storeId));
        await tx.userStore.upsert({ where: { userId_storeId: { userId: employee.userId, storeId: transfer.toStoreId } },
          create: { userId: employee.userId, storeId: transfer.toStoreId }, update: {} });
        await tx.userStore.deleteMany({ where: { userId: employee.userId, storeId: transfer.fromStoreId } });
        await tx.auditLog.create({ data: { entityType: 'USER_STORE', entityId: employee.userId,
          action: 'TRANSFER_STORE_SCOPE', beforeData: { userId: String(employee.userId), storeIds: beforeStoreIds },
          afterData: { transferId: String(transferId), userId: String(employee.userId),
            fromStoreId: String(transfer.fromStoreId), toStoreId: String(transfer.toStoreId) } } });
      }
      const retroactive = boundary < todayInShanghai();
      if (retroactive) {
        const affectedMonth = new Date(`${dateOnly(boundary).slice(0, 7)}-01T00:00:00.000Z`);
        await tx.hrMonthlyReview.updateMany({ where: {
          storeId: { in: [transfer.fromStoreId, transfer.toStoreId] },
          month: { gte: affectedMonth }, status: 'APPROVED', invalidatedAt: null,
        }, data: { invalidatedAt: new Date(), invalidationReason: `TRANSFER:${transferId}` } });
      }
      await tx.hrTransferRequest.update({ where: { id: transferId }, data: {
        status: HrTransferStatus.EFFECTIVE, nextStep: null, appliedAt: new Date(),
        reconciliationRequired: retroactive, failureCode: null, version: { increment: 1 },
      } });
      await tx.auditLog.create({ data: {
        entityType: 'HR_TRANSFER', entityId: transferId, action: 'EFFECT',
        afterData: { effectiveDate: dateOnly(boundary), retroactive },
      } });
      return true;
    });
  }

  async retryEffect(user: AuthContext | undefined, transferIdValue: number) {
    const transferId = this.positiveId(transferIdValue);
    const transfer = await this.db.hrTransferRequest.findUnique({ where: { id: transferId } });
    if (!transfer) throw new BadRequestException('Transfer request not found');
    await this.access.assertStorePermission(user, 'HR_TRANSFER_APPROVE_HR', transfer.fromStoreId);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_transfer_requests WHERE id = ${transferId} FOR UPDATE`;
      const current = await tx.hrTransferRequest.findUnique({ where: { id: transferId },
        include: { decisions: true } });
      if (!current || current.status !== HrTransferStatus.EFFECTIVE_FAILED ||
          current.failureCode !== 'SOURCE_APPOINTMENT_CONFLICT' || current.decisions.some((item) => item.decision !== 'APPROVE') ||
          !current.decisions.some((item) => item.step === HrTransferStep.HR))
        throw new ConflictException('Only fully approved source appointment failures can be retried');
      await tx.hrTransferRequest.update({ where: { id: transferId }, data: {
        status: HrTransferStatus.APPROVED_AWAITING_EFFECTIVE, failureCode: null,
      } });
    });
    await this.applyOne(transferId);
    const updated = await this.db.hrTransferRequest.findUnique({ where: { id: transferId },
      select: { status: true, failureCode: true } });
    return { id: Number(transferId), status: updated?.status, failureCode: updated?.failureCode ?? null };
  }

  private positiveId(value: unknown): bigint {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
    return BigInt(parsed);
  }
}
