import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HrApprovalKind, HrApprovalStatus, HrEmployeeStatus, HrOffboardingStatus,
  HrScheduleStatus, HrTransferStatus, HrTransferDecisionType, Prisma } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrApprovalService } from './hr-approval.service';
import { assertHrLinkedAccountRemovable, deleteHrLinkedAccount } from './hr-user-account';

function positiveId(value: unknown): bigint {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('员工、门店或申请编号无效，请刷新页面后重试。');
  return BigInt(parsed);
}
function dateOnly(value: Date): string { return value.toISOString().slice(0, 10); }
function parseDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('请重新选择离职生效日期。');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateOnly(date) !== value)
    throw new BadRequestException('离职生效日期无效，请重新选择。');
  return date;
}
function todayShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

@Injectable()
export class HrOffboardingService {
  private readonly logger = new Logger(HrOffboardingService.name);
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly approvals: HrApprovalService) {}

  private enabled() {
    if (process.env.HR_OFFBOARDING_ENABLED !== 'true')
      throw new ServiceUnavailableException('员工离职功能暂未启用，请联系管理员。');
  }

  async submit(user: AuthContext | undefined, input: Record<string, unknown>) {
    this.enabled();
    const employeeId = positiveId(input.employeeId);
    const storeId = positiveId(input.storeId);
    const effectiveDate = parseDate(input.effectiveDate);
    const deleteAccountOnEffective = input.deleteAccountOnEffective === undefined ? true : input.deleteAccountOnEffective;
    if (typeof deleteAccountOnEffective !== 'boolean')
      throw new BadRequestException('账号删除选项无效，请刷新页面后重试。');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason || reason.length > 1000) throw new BadRequestException('请填写离职原因，最多 1000 个字符。');
    await this.access.assertStorePermission(user, 'HR_OFFBOARDING_REQUEST', storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
      const employee = await tx.hrEmployee.findUnique({ where: { id: employeeId }, select: { status: true, userId: true } });
      if (employee?.status !== HrEmployeeStatus.ACTIVE) throw new ConflictException('所选员工已不在职，不能发起离职申请。请刷新员工列表。');
      if (deleteAccountOnEffective && employee.userId != null)
        await assertHrLinkedAccountRemovable(tx, employee.userId);
      const appointment = await tx.hrPrimaryAppointment.findFirst({ where: { employeeId,
        effectiveFrom: { lt: effectiveDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: effectiveDate } }],
      } });
      if (!appointment || appointment.storeId !== storeId)
        throw new ConflictException('离职生效日期前，该员工不属于所选门店。请核对门店和生效日期。');
      if (await tx.hrOffboardingRequest.findFirst({ where: { employeeId, status: { in: [
        HrOffboardingStatus.SUBMITTED, HrOffboardingStatus.APPROVED_AWAITING_EFFECTIVE,
      ] } }, select: { id: true } })) throw new ConflictException('该员工已有待处理的离职申请，请在申请列表查看并处理原申请。');
      await this.assertNoConflicts(tx, employeeId, effectiveDate);
      const latest = await tx.hrOffboardingRequest.findFirst({ where: { employeeId },
        orderBy: { revision: 'desc' }, select: { revision: true } });
      const request = await tx.hrOffboardingRequest.create({ data: {
        employeeId, storeId, effectiveDate, reason, deleteAccountOnEffective, requestedBy: actorId,
        revision: (latest?.revision ?? 0) + 1,
      } });
      try {
        await this.approvals.createForSubject(tx, HrApprovalKind.OFFBOARDING,
          request.id, storeId, actorId);
      } catch (error) {
        if (error instanceof ConflictException && String(error.message).toLowerCase().includes('approval workflow'))
          throw new ConflictException('离职审批流程尚未配置有效的审批角色，请管理员检查人事审批流程设置。');
        throw error;
      }
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_OFFBOARDING',
        entityId: request.id, action: 'SUBMIT', afterData: { employeeId: String(employeeId),
          storeId: String(storeId), effectiveDate: dateOnly(effectiveDate), deleteAccountOnEffective } } });
      return { id: Number(request.id), status: request.status, effectiveDate: dateOnly(effectiveDate) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async list(user: AuthContext | undefined, storeIdValue?: unknown) {
    this.enabled();
    const access = await this.access.currentAccess(user);
    const permitted = access.stores.filter((store) => store.permissionCodes.includes('HR_OFFBOARDING_LIST_READ') ||
      store.permissionCodes.includes('HR_OFFBOARDING_REQUEST') || store.permissionCodes.includes('HR_OFFBOARDING_APPROVE'));
    const selectedId = storeIdValue == null || storeIdValue === '' ? null : positiveId(storeIdValue);
    if (selectedId && !permitted.some((store) => BigInt(store.id) === selectedId)) throw new ForbiddenException('HR access denied');
    const storeIds = selectedId ? [selectedId] : permitted.map((store) => BigInt(store.id));
    if (!storeIds.length) return [];
    const rows = await this.db.hrOffboardingRequest.findMany({ where: { storeId: { in: storeIds } },
      include: { employee: { select: { displayName: true } } }, orderBy: { id: 'desc' } });
    return Promise.all(rows.map(async (row) => {
      const approval = await this.db.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.OFFBOARDING, subjectId: row.id },
      }, include: { steps: true } });
      const rejectionReason = approval?.steps.find((step) => step.decision === HrTransferDecisionType.REJECT)?.reason ?? null;
      return { id: Number(row.id), employeeId: Number(row.employeeId), storeId: Number(row.storeId),
      employeeName: row.employee.displayName, effectiveDate: dateOnly(row.effectiveDate),
      reason: row.reason, status: row.status, failureCode: row.failureCode,
      rejectionReason, revision: row.revision,
      deleteAccountOnEffective: row.deleteAccountOnEffective };
    }));
  }

  async resubmit(user: AuthContext | undefined, requestIdValue: unknown, input: Record<string, unknown>) {
    this.enabled();
    const requestId = positiveId(requestIdValue);
    const effectiveDate = parseDate(input.effectiveDate);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const deleteAccountOnEffective = input.deleteAccountOnEffective;
    if (!reason || reason.length > 1000) throw new BadRequestException('请填写离职原因，最多 1000 个字符。');
    if (typeof deleteAccountOnEffective !== 'boolean') throw new BadRequestException('账号删除选项无效，请刷新页面后重试。');
    const preview = await this.db.hrOffboardingRequest.findUnique({ where: { id: requestId },
      select: { id: true, employeeId: true, storeId: true, revision: true, status: true } });
    if (!preview || preview.status !== HrOffboardingStatus.REJECTED)
      throw new ConflictException('只有已驳回的离职申请可以修改后重新提交。');
    await this.access.assertStorePermission(user, 'HR_OFFBOARDING_REQUEST', preview.storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_offboarding_requests WHERE id = ${requestId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${preview.employeeId} FOR UPDATE`;
      const current = await tx.hrOffboardingRequest.findUnique({ where: { id: requestId } });
      if (!current || current.status !== HrOffboardingStatus.REJECTED || current.revision !== preview.revision)
        throw new ConflictException('离职申请已发生变化，请刷新列表后重试。');
      const employee = await tx.hrEmployee.findUnique({ where: { id: current.employeeId },
        select: { status: true, userId: true } });
      if (employee?.status !== HrEmployeeStatus.ACTIVE) throw new ConflictException('员工已不在职，无法重新提交离职申请。');
      const anotherPendingRequest = await tx.hrOffboardingRequest.count({ where: { employeeId: current.employeeId,
        id: { not: requestId }, status: { in: [HrOffboardingStatus.SUBMITTED,
          HrOffboardingStatus.APPROVED_AWAITING_EFFECTIVE] } } });
      if (anotherPendingRequest) throw new ConflictException('该员工已有另一条待处理的离职申请，请先处理原申请。');
      if (deleteAccountOnEffective && employee.userId != null)
        await assertHrLinkedAccountRemovable(tx, employee.userId);
      const appointment = await tx.hrPrimaryAppointment.findFirst({ where: { employeeId: current.employeeId,
        effectiveFrom: { lt: effectiveDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: effectiveDate } }],
      } });
      if (!appointment || appointment.storeId !== current.storeId)
        throw new ConflictException('离职生效日期前，该员工不属于原申请门店。请核对门店和生效日期。');
      await this.assertNoConflicts(tx, current.employeeId, effectiveDate);
      const revision = current.revision + 1;
      const updated = await tx.hrOffboardingRequest.update({ where: { id: requestId }, data: {
        effectiveDate, reason, deleteAccountOnEffective, revision, status: HrOffboardingStatus.SUBMITTED,
        appliedAt: null, failureCode: null,
      } });
      try {
        await this.approvals.restartForSubject(tx, HrApprovalKind.OFFBOARDING,
          requestId, actorId, revision, current.storeId);
      } catch (error) {
        if (error instanceof ConflictException && String(error.message).toLowerCase().includes('approval workflow'))
          throw new ConflictException('离职审批流程尚未配置有效的审批角色，请管理员检查人事审批流程设置。');
        throw error;
      }
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_OFFBOARDING',
        entityId: requestId, action: 'CORRECTION_RESUBMIT',
        beforeData: { revision: current.revision, status: current.status,
          effectiveDate: dateOnly(current.effectiveDate), reason: current.reason,
          deleteAccountOnEffective: current.deleteAccountOnEffective },
        afterData: { revision, status: updated.status, effectiveDate: dateOnly(effectiveDate),
          reason, deleteAccountOnEffective } } });
      return { id: Number(updated.id), status: updated.status, revision,
        effectiveDate: dateOnly(updated.effectiveDate) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async decide(user: AuthContext | undefined, requestIdValue: unknown, input: Record<string, unknown>) {
    this.enabled();
    const requestId = positiveId(requestIdValue);
    const decision = input.decision;
    if (decision !== HrTransferDecisionType.APPROVE && decision !== HrTransferDecisionType.REJECT)
      throw new BadRequestException('审批操作无效，请刷新离职申请后重试。');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (decision === HrTransferDecisionType.REJECT && !reason)
      throw new BadRequestException('请填写驳回原因。');
    const request = await this.db.hrOffboardingRequest.findUnique({ where: { id: requestId } });
    if (request?.status !== HrOffboardingStatus.SUBMITTED)
      throw new ConflictException('该离职申请已处理或已变化，请刷新申请列表。');
    const instance = await this.db.hrApprovalInstance.findUnique({ where: {
      kind_subjectId: { kind: HrApprovalKind.OFFBOARDING, subjectId: requestId },
    } });
    if (!instance) throw new ConflictException('未找到该离职申请的审批流程，请联系管理员检查配置。');
    const progress = await this.approvals.decide(user, instance.id, decision, reason);
    if (progress.status === HrApprovalStatus.PENDING) return { id: Number(requestId), status: request.status,
      nextApprovalPosition: progress.nextPosition };
    return this.finalize(requestId);
  }

  @Cron('0 */5 * * * *', { timeZone: 'Asia/Shanghai' })
  async reconcile() {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.HR_OFFBOARDING_ENABLED !== 'true' ||
        process.env.REPORT_SOURCE !== 'database') return;
    const rows = await this.db.hrOffboardingRequest.findMany({ where: { status: { in: [
      HrOffboardingStatus.SUBMITTED, HrOffboardingStatus.APPROVED_AWAITING_EFFECTIVE,
    ] } }, select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
    for (const row of rows) {
      try { await this.finalize(row.id); }
      catch (error) { this.logger.error(`Offboarding ${row.id} reconcile failed`,
        error instanceof Error ? error.stack : String(error)); }
    }
  }

  private async assertNoConflicts(tx: Prisma.TransactionClient, employeeId: bigint, effectiveDate: Date) {
    const [transfers, schedules, work, laterAppointment, salary, bankChanges] = await Promise.all([
      tx.hrTransferRequest.count({ where: { employeeId, status: { in: [
        HrTransferStatus.PENDING, HrTransferStatus.APPROVED_AWAITING_EFFECTIVE,
      ] } } }),
      tx.hrSchedule.count({ where: { employeeId, businessDate: { gte: effectiveDate },
        status: { not: HrScheduleStatus.CANCELED } } }),
      tx.hrWorkDaySegment.count({ where: { businessDate: { gte: effectiveDate },
        workVersion: { record: { employeeId } } } }),
      tx.hrPrimaryAppointment.count({ where: { employeeId, effectiveFrom: { gte: effectiveDate } } }),
      tx.hrSalaryChangeRequest.count({ where: { employeeId,
        status: { in: ['SUBMITTED', 'APPROVED_AWAITING_EFFECTIVE'] } } }),
      tx.hrBankChangeRequest.count({ where: { employeeId, status: 'SUBMITTED' } }),
    ]);
    const conflicts: string[] = [];
    if (transfers) conflicts.push('待处理的转店申请');
    if (schedules) conflicts.push('离职生效日及之后的排班');
    if (work) conflicts.push('离职生效日及之后的工时记录');
    if (laterAppointment) conflicts.push('离职生效日之后生效的门店任职记录');
    if (salary) conflicts.push('待处理的调薪申请');
    if (bankChanges) conflicts.push('待处理的银行卡变更申请');
    if (conflicts.length)
      throw new ConflictException(`无法提交离职申请，以下事项尚未处理：${conflicts.join('、')}。请先处理相关事项，或调整离职生效日期。`);
  }

  private async finalize(requestId: bigint) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_offboarding_requests WHERE id = ${requestId} FOR UPDATE`;
      const request = await tx.hrOffboardingRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new ConflictException('离职申请不存在，请刷新后重试。');
      if (request.status !== HrOffboardingStatus.SUBMITTED &&
          request.status !== HrOffboardingStatus.APPROVED_AWAITING_EFFECTIVE)
        return { id: Number(requestId), status: request.status };
      const approval = await tx.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.OFFBOARDING, subjectId: requestId },
      } });
      if (approval?.status === HrApprovalStatus.PENDING)
        return { id: Number(requestId), status: request.status };
      if (approval?.status === HrApprovalStatus.REJECTED) {
        await tx.hrOffboardingRequest.update({ where: { id: requestId }, data: { status: HrOffboardingStatus.REJECTED } });
        return { id: Number(requestId), status: HrOffboardingStatus.REJECTED };
      }
      if (approval?.status !== HrApprovalStatus.APPROVED)
        throw new ConflictException('未找到该离职申请的审批流程，请联系管理员检查配置。');
      if (dateOnly(request.effectiveDate) > todayShanghai()) {
        if (request.status !== HrOffboardingStatus.APPROVED_AWAITING_EFFECTIVE)
          await tx.hrOffboardingRequest.update({ where: { id: requestId },
            data: { status: HrOffboardingStatus.APPROVED_AWAITING_EFFECTIVE } });
        return { id: Number(requestId), status: HrOffboardingStatus.APPROVED_AWAITING_EFFECTIVE };
      }
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${request.employeeId} FOR UPDATE`;
      const employee = await tx.hrEmployee.findUnique({ where: { id: request.employeeId }, select: { status: true, userId: true } });
      const appointment = await tx.hrPrimaryAppointment.findFirst({ where: {
        employeeId: request.employeeId, storeId: request.storeId,
        effectiveFrom: { lt: request.effectiveDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: request.effectiveDate } }],
      } });
      let conflict = employee?.status !== HrEmployeeStatus.ACTIVE || !appointment;
      if (!conflict) {
        try { await this.assertNoConflicts(tx, request.employeeId, request.effectiveDate); }
        catch (error) { if (error instanceof ConflictException) conflict = true; else throw error; }
      }
      if (conflict || !appointment) {
        await tx.hrOffboardingRequest.update({ where: { id: requestId }, data: {
          status: HrOffboardingStatus.EFFECTIVE_FAILED, failureCode: 'SOURCE_CHANGED',
        } });
        return { id: Number(requestId), status: HrOffboardingStatus.EFFECTIVE_FAILED };
      }
      const linkedUserId = employee?.userId ?? null;
      const accountDeleted = request.deleteAccountOnEffective === true && linkedUserId != null
        ? await deleteHrLinkedAccount(tx, linkedUserId) : false;
      await tx.hrPrimaryAppointment.update({ where: { id: appointment.id },
        data: { effectiveToExclusive: request.effectiveDate } });
      await tx.hrEmployee.update({ where: { id: request.employeeId }, data: { status: HrEmployeeStatus.TERMINATED } });
      const month = new Date(`${dateOnly(request.effectiveDate).slice(0, 7)}-01T00:00:00.000Z`);
      await tx.hrMonthlyReview.updateMany({ where: { storeId: request.storeId, month: { gte: month },
        status: 'APPROVED', invalidatedAt: null }, data: {
        invalidatedAt: new Date(), invalidationReason: `OFFBOARDING:${requestId}`,
      } });
      await tx.hrOffboardingRequest.update({ where: { id: requestId }, data: {
        status: HrOffboardingStatus.EFFECTIVE, appliedAt: new Date(), failureCode: null,
      } });
      await tx.auditLog.create({ data: { entityType: 'HR_OFFBOARDING', entityId: requestId,
        action: 'EFFECTIVE', afterData: { employeeId: String(request.employeeId),
          effectiveDate: dateOnly(request.effectiveDate),
          deleteAccountOnEffective: request.deleteAccountOnEffective === true, accountDeleted } } });
      return { id: Number(requestId), status: HrOffboardingStatus.EFFECTIVE, accountDeleted };
    });
  }
}
