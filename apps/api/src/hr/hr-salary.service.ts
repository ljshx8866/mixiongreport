import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HrApprovalKind, HrApprovalStatus, HrEmployeeStatus, HrSalaryChangeStatus,
  HrTransferDecisionType, Prisma } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrApprovalService } from './hr-approval.service';

function id(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}
function dateOnly(value: Date): string { return value.toISOString().slice(0, 10); }
function date(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Effective date must be YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || dateOnly(parsed) !== value)
    throw new BadRequestException('Invalid effective date');
  return parsed;
}
function todayShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function hourlyRate(value: unknown): Prisma.Decimal {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value))
    throw new BadRequestException('Hourly rate must be a decimal with at most two places');
  const parsed = new Prisma.Decimal(value);
  if (parsed.lte(0)) throw new BadRequestException('Hourly rate must be positive');
  return parsed;
}

@Injectable()
export class HrSalaryService {
  private readonly logger = new Logger(HrSalaryService.name);
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly approvals: HrApprovalService) {}
  private enabled() {
    if (process.env.HR_SALARY_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR salary changes are not enabled');
  }

  async submit(user: AuthContext | undefined, input: Record<string, unknown>) {
    this.enabled();
    const employeeId = id(input.employeeId), storeId = id(input.storeId);
    const effectiveDate = date(input.effectiveDate), proposedRate = hourlyRate(input.hourlyRate);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const agreementReference = typeof input.agreementReference === 'string'
      ? input.agreementReference.trim() : '';
    if (!reason || reason.length > 1000 || agreementReference.length > 200)
      throw new BadRequestException('Reason or agreement reference is invalid');
    await this.access.assertStorePermission(user, 'HR_SALARY_CHANGE_REQUEST', storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
      const employee = await tx.hrEmployee.findUnique({ where: { id: employeeId }, select: { status: true } });
      if (employee?.status !== HrEmployeeStatus.ACTIVE)
        throw new ConflictException('Only active employees can change hourly rate');
      const appointment = await tx.hrPrimaryAppointment.findFirst({ where: { employeeId, storeId,
        effectiveFrom: { lte: effectiveDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: effectiveDate } }],
      } });
      if (!appointment) throw new ConflictException('Employee is not appointed to this store on the effective date');
      const departure = await tx.hrOffboardingRequest.findFirst({ where: { employeeId,
        effectiveDate: { lte: effectiveDate }, status: { in: [
          'SUBMITTED', 'APPROVED_AWAITING_EFFECTIVE', 'EFFECTIVE',
        ] } }, select: { id: true } });
      if (departure) throw new ConflictException('Hourly rate cannot start after departure');
      if (await tx.hrSalaryChangeRequest.findFirst({ where: { employeeId,
        status: { in: [HrSalaryChangeStatus.SUBMITTED, HrSalaryChangeStatus.APPROVED_AWAITING_EFFECTIVE] },
      }, select: { id: true } })) throw new ConflictException('Another hourly rate change is pending');
      const source = await tx.hrSalaryRate.findFirst({ where: { employeeId,
        effectiveFrom: { lte: effectiveDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: effectiveDate } }],
      } });
      if (!source && await tx.hrSalaryRate.count({ where: { employeeId } }))
        throw new ConflictException('Hourly rate interval is missing or starts later');
      if (source && source.effectiveFrom >= effectiveDate)
        throw new ConflictException('Another hourly rate starts on this date');
      if (source && proposedRate.lt(source.hourlyRate) && !agreementReference)
        throw new BadRequestException('A lower hourly rate requires a written agreement reference');
      const latest = await tx.hrSalaryChangeRequest.findFirst({ where: { employeeId },
        orderBy: { revision: 'desc' }, select: { revision: true } });
      const change = await tx.hrSalaryChangeRequest.create({ data: {
        employeeId, storeId, revision: (latest?.revision ?? 0) + 1,
        expectedRateId: source?.id ?? null, proposedRate, effectiveDate,
        reason, agreementReference: agreementReference || null, requestedBy: actorId,
      } });
      await this.approvals.createForSubject(tx, HrApprovalKind.SALARY_CHANGE,
        change.id, storeId, actorId);
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SALARY_CHANGE',
        entityId: change.id, action: 'SUBMIT', afterData: { employeeId: String(employeeId),
          storeId: String(storeId), effectiveDate: dateOnly(effectiveDate),
          proposedRate: proposedRate.toFixed(2), agreementReference: agreementReference || null } } });
      return { id: Number(change.id), status: change.status, effectiveDate: dateOnly(effectiveDate) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async employeesForRequest(user: AuthContext | undefined, storeIdValue: unknown) {
    this.enabled();
    const storeId = id(storeIdValue);
    await this.access.assertStorePermission(user, 'HR_SALARY_CHANGE_REQUEST', storeId);
    const today = new Date(`${todayShanghai()}T00:00:00.000Z`);
    const employees = await this.db.hrEmployee.findMany({ where: {
      status: HrEmployeeStatus.ACTIVE,
      primaryAppointments: { some: { storeId, effectiveFrom: { lte: today },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }] } },
    }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' }, take: 200 });
    return employees.map((employee) => ({ id: Number(employee.id), displayName: employee.displayName }));
  }

  async list(user: AuthContext | undefined, storeIdValue?: unknown) {
    this.enabled();
    const access = await this.access.currentAccess(user);
    const permitted = access.stores.filter((store) => store.permissionCodes.includes('HR_SALARY_CHANGE_LIST_READ') ||
      store.permissionCodes.includes('HR_SALARY_CHANGE_REQUEST') || store.permissionCodes.includes('HR_SALARY_CHANGE_APPROVE'));
    const selectedId = storeIdValue == null || storeIdValue === '' ? null : id(storeIdValue);
    if (selectedId && !permitted.some((store) => BigInt(store.id) === selectedId)) throw new ForbiddenException('HR access denied');
    const storeIds = selectedId ? [selectedId] : permitted.map((store) => BigInt(store.id));
    if (!storeIds.length) return [];
    const changes = await this.db.hrSalaryChangeRequest.findMany({ where: { storeId: { in: storeIds } },
      include: { employee: { select: { displayName: true } } }, orderBy: { id: 'desc' } });
    return changes.map((change) => ({ id: Number(change.id), employeeId: Number(change.employeeId),
      employeeName: change.employee.displayName, effectiveDate: dateOnly(change.effectiveDate),
      hourlyRate: change.proposedRate.toFixed(2), status: change.status,
      failureCode: change.failureCode, agreementReference: change.agreementReference }));
  }

  async decide(user: AuthContext | undefined, changeIdValue: unknown, input: Record<string, unknown>) {
    this.enabled();
    const changeId = id(changeIdValue), decision = input.decision;
    if (decision !== HrTransferDecisionType.APPROVE && decision !== HrTransferDecisionType.REJECT)
      throw new BadRequestException('Invalid salary decision');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (decision === HrTransferDecisionType.REJECT && !reason)
      throw new BadRequestException('A rejection reason is required');
    const change = await this.db.hrSalaryChangeRequest.findUnique({ where: { id: changeId } });
    if (change?.status !== HrSalaryChangeStatus.SUBMITTED)
      throw new ConflictException('Hourly rate change is not pending');
    const instance = await this.db.hrApprovalInstance.findUnique({ where: {
      kind_subjectId: { kind: HrApprovalKind.SALARY_CHANGE, subjectId: changeId },
    } });
    if (!instance) throw new ConflictException('Salary approval is missing');
    const progress = await this.approvals.decide(user, instance.id, decision, reason);
    if (progress.status === HrApprovalStatus.PENDING)
      return { id: Number(changeId), status: change.status, nextApprovalPosition: progress.nextPosition };
    return this.finalize(changeId);
  }

  @Cron('0 */5 * * * *', { timeZone: 'Asia/Shanghai' })
  async reconcile() {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.HR_SALARY_ENABLED !== 'true' ||
        process.env.REPORT_SOURCE !== 'database') return;
    const rows = await this.db.hrSalaryChangeRequest.findMany({ where: { status: { in: [
      HrSalaryChangeStatus.SUBMITTED, HrSalaryChangeStatus.APPROVED_AWAITING_EFFECTIVE,
    ] } }, select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
    for (const row of rows) {
      try { await this.finalize(row.id); }
      catch (error) { this.logger.error(`Hourly rate change ${row.id} reconcile failed`,
        error instanceof Error ? error.stack : String(error)); }
    }
  }

  private async finalize(changeId: bigint) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_salary_change_requests WHERE id = ${changeId} FOR UPDATE`;
      const change = await tx.hrSalaryChangeRequest.findUnique({ where: { id: changeId } });
      if (!change) throw new ConflictException('Hourly rate change is missing');
      if (change.status !== HrSalaryChangeStatus.SUBMITTED &&
          change.status !== HrSalaryChangeStatus.APPROVED_AWAITING_EFFECTIVE)
        return { id: Number(changeId), status: change.status };
      const approval = await tx.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.SALARY_CHANGE, subjectId: changeId },
      } });
      if (approval?.status === HrApprovalStatus.PENDING)
        return { id: Number(changeId), status: change.status };
      if (approval?.status === HrApprovalStatus.REJECTED) {
        await tx.hrSalaryChangeRequest.update({ where: { id: changeId },
          data: { status: HrSalaryChangeStatus.REJECTED } });
        return { id: Number(changeId), status: HrSalaryChangeStatus.REJECTED };
      }
      if (approval?.status !== HrApprovalStatus.APPROVED)
        throw new ConflictException('Hourly rate approval is missing');
      if (dateOnly(change.effectiveDate) > todayShanghai()) {
        if (change.status !== HrSalaryChangeStatus.APPROVED_AWAITING_EFFECTIVE)
          await tx.hrSalaryChangeRequest.update({ where: { id: changeId },
            data: { status: HrSalaryChangeStatus.APPROVED_AWAITING_EFFECTIVE } });
        return { id: Number(changeId), status: HrSalaryChangeStatus.APPROVED_AWAITING_EFFECTIVE };
      }
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${change.employeeId} FOR UPDATE`;
      const employee = await tx.hrEmployee.findUnique({ where: { id: change.employeeId }, select: { status: true } });
      const appointment = await tx.hrPrimaryAppointment.findFirst({ where: {
        employeeId: change.employeeId, storeId: change.storeId,
        effectiveFrom: { lte: change.effectiveDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: change.effectiveDate } }],
      } });
      const source = await tx.hrSalaryRate.findFirst({ where: { employeeId: change.employeeId,
        effectiveFrom: { lte: change.effectiveDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: change.effectiveDate } }],
      } });
      const anyRate = source ? null : await tx.hrSalaryRate.findFirst({ where: { employeeId: change.employeeId },
        select: { id: true } });
      const conflict = employee?.status !== HrEmployeeStatus.ACTIVE || !appointment ||
        (source?.id ?? null) !== change.expectedRateId ||
        (source != null && source.effectiveFrom >= change.effectiveDate) || Boolean(anyRate);
      if (conflict) {
        await tx.hrSalaryChangeRequest.update({ where: { id: changeId }, data: {
          status: HrSalaryChangeStatus.EFFECTIVE_FAILED, failureCode: 'SOURCE_CHANGED',
        } });
        return { id: Number(changeId), status: HrSalaryChangeStatus.EFFECTIVE_FAILED };
      }
      const nextBoundary = source?.effectiveToExclusive ?? null;
      if (source) await tx.hrSalaryRate.update({ where: { id: source.id },
        data: { effectiveToExclusive: change.effectiveDate } });
      await tx.hrSalaryRate.create({ data: { employeeId: change.employeeId,
        hourlyRate: change.proposedRate, effectiveFrom: change.effectiveDate,
        effectiveToExclusive: nextBoundary, sourceChangeId: changeId } });
      const affectedMonth = new Date(`${dateOnly(change.effectiveDate).slice(0, 7)}-01T00:00:00.000Z`);
      const appointments = await tx.hrPrimaryAppointment.findMany({ where: { employeeId: change.employeeId },
        select: { storeId: true } });
      const storeIds = [...new Set(appointments.map((item) => item.storeId))];
      await tx.hrMonthlyReview.updateMany({ where: { storeId: { in: storeIds },
        month: { gte: affectedMonth }, status: 'APPROVED', invalidatedAt: null },
      data: { invalidatedAt: new Date(), invalidationReason: `SALARY_CHANGE:${changeId}` } });
      await tx.hrSalaryChangeRequest.update({ where: { id: changeId }, data: {
        status: HrSalaryChangeStatus.EFFECTIVE, appliedAt: new Date(), failureCode: null,
      } });
      await tx.auditLog.create({ data: { entityType: 'HR_SALARY_CHANGE', entityId: changeId,
        action: 'EFFECTIVE', afterData: { employeeId: String(change.employeeId),
          effectiveDate: dateOnly(change.effectiveDate), hourlyRate: change.proposedRate.toFixed(2) } } });
      return { id: Number(changeId), status: HrSalaryChangeStatus.EFFECTIVE };
    });
  }
}
