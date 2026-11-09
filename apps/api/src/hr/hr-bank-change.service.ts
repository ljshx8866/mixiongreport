import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HrApprovalKind, HrApprovalStatus, HrBankChangeStatus, HrEmployeeStatus,
  HrSensitiveDraftKind, HrTransferDecisionType, Prisma } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrApprovalService } from './hr-approval.service';
import { parseBankInput } from './hr-sensitive-draft.service';
import { HrSealedValue, loadHrSensitiveCryptoFromEnv, maskBankCard } from './hr-sensitive-crypto';

function positiveId(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

function todayShanghai(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
}

function enabled() {
  if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.HR_BANK_CHANGE_ENABLED !== 'true' ||
      process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database')
    throw new ServiceUnavailableException('HR bank change is not enabled');
}

@Injectable()
export class HrBankChangeService {
  private readonly logger = new Logger(HrBankChangeService.name);
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly approvals: HrApprovalService) {}

  async submit(user: AuthContext | undefined, employeeIdInput: unknown, input: Record<string, unknown>) {
    enabled();
    const employeeId = positiveId(employeeIdInput);
    if (input.confirmedOriginals !== true)
      throw new BadRequestException('Store must verify the new bank account in person');
    const bank = parseBankInput(input);
    const actorId = positiveId(user?.id);
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    const today = todayShanghai();

    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
        const employee = await tx.hrEmployee.findUnique({ where: { id: employeeId },
          select: { status: true, displayName: true } });
        if (!employee || employee.status !== HrEmployeeStatus.ACTIVE)
          throw new ConflictException('Only an active employee can change the bank account');
        if (bank.accountName !== employee.displayName)
          throw new ConflictException('Bank account holder must match the employee name');
        const appointment = await tx.hrPrimaryAppointment.findFirst({ where: { employeeId,
          effectiveFrom: { lte: today }, OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }] },
          orderBy: { effectiveFrom: 'desc' }, select: { storeId: true } });
        if (!appointment) throw new ConflictException('Employee has no active primary store');
        await this.access.assertStorePermission(user, 'HR_BANK_CHANGE_SUBMIT', appointment.storeId);
        await this.access.assertStorePermission(user, 'HR_BANK_CHANGE_VERIFY', appointment.storeId);
        const pending = await tx.hrBankChangeRequest.findFirst({ where: { employeeId,
          status: HrBankChangeStatus.SUBMITTED }, select: { id: true } });
        if (pending) throw new ConflictException('A bank change is already awaiting approval');

        const latest = await tx.hrSensitiveDraftRevision.findFirst({ where: { employeeId,
          kind: HrSensitiveDraftKind.BANK }, orderBy: { version: 'desc' }, select: { version: true } });
        const revision = await tx.hrSensitiveDraftRevision.create({ data: {
          employeeId, kind: HrSensitiveDraftKind.BANK, version: (latest?.version ?? 0) + 1,
          sealedPayload: crypto.seal(employeeId, 'BANK', bank) as unknown as Prisma.InputJsonValue,
          maskedValue: maskBankCard(bank.cardNumber), source: 'MANUAL_CHANGE', createdBy: actorId,
        } });
        const previous = await tx.hrBankChangeRequest.findFirst({ where: { employeeId },
          orderBy: { revision: 'desc' }, select: { revision: true } });
        const request = await tx.hrBankChangeRequest.create({ data: {
          employeeId, storeId: appointment.storeId, revision: (previous?.revision ?? 0) + 1,
          sourceRevisionId: revision.id, verifiedBy: actorId,
        } });
        await this.approvals.createForSubject(tx, HrApprovalKind.BANK_CHANGE,
          request.id, appointment.storeId, actorId);
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_BANK_CHANGE',
          entityId: request.id, action: 'STORE_VERIFY_AND_SUBMIT', afterData: {
            employeeId: String(employeeId), storeId: String(appointment.storeId),
            revision: request.revision, sourceRevisionId: String(revision.id),
          } } });
        return { id: Number(request.id), employeeId: Number(employeeId), status: request.status,
          revision: request.revision, bankMask: revision.maskedValue };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('A bank change is already being processed; reload the employee');
      throw error;
    }
  }

  async list(user: AuthContext | undefined, storeIdInput?: unknown) {
    enabled();
    const access = await this.access.currentAccess(user);
    const permitted = access.stores.filter((store) => store.permissionCodes.includes('HR_BANK_CHANGE_LIST_READ') ||
      store.permissionCodes.includes('HR_BANK_CHANGE_VERIFY') || store.permissionCodes.includes('HR_BANK_CHANGE_APPROVE'));
    const selectedId = storeIdInput == null || storeIdInput === '' ? null : positiveId(storeIdInput);
    if (selectedId && !permitted.some((store) => BigInt(store.id) === selectedId)) throw new ForbiddenException('HR access denied');
    const storeIds = selectedId ? [selectedId] : permitted.map((store) => BigInt(store.id));
    if (!storeIds.length) return [];
    const requests = await this.db.hrBankChangeRequest.findMany({ where: { storeId: { in: storeIds } },
      include: { employee: { select: { displayName: true } },
        sourceRevision: { select: { maskedValue: true, sealedPayload: true } } },
      orderBy: { id: 'desc' } });
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    const fullCardStores = new Set(access.stores.filter((store) => store.permissionCodes.includes('HR_BANK_CHANGE_FULL_READ'))
      .map((store) => String(store.id)));
    await this.db.auditLog.create({ data: { userId: positiveId(user?.id),
      entityType: 'HR_BANK_CHANGE', entityId: selectedId ?? storeIds[0], action: 'VIEW_FULL_LIST',
      afterData: { requestIds: requests.map((item) => String(item.id)), count: requests.length } } });
    return requests.map((item) => {
      const bank = crypto.open(item.employeeId, 'BANK',
        item.sourceRevision.sealedPayload as unknown as HrSealedValue);
      return { id: Number(item.id), employeeId: Number(item.employeeId),
        employeeName: item.employee.displayName, status: item.status, revision: item.revision,
        accountName: typeof bank.accountName === 'string' ? bank.accountName : item.employee.displayName,
        bankName: typeof bank.bankName === 'string' ? bank.bankName : '',
        branchName: typeof bank.branchName === 'string' ? bank.branchName : '',
        cardNumber: fullCardStores.has(String(item.storeId)) && typeof bank.cardNumber === 'string'
          ? bank.cardNumber : item.sourceRevision.maskedValue,
        createdAt: item.createdAt, appliedAt: item.appliedAt, failureCode: item.failureCode };
    });
  }

  async decide(user: AuthContext | undefined, requestIdInput: unknown, input: Record<string, unknown>) {
    enabled();
    const requestId = positiveId(requestIdInput);
    const decision = input.decision;
    if (decision !== HrTransferDecisionType.APPROVE && decision !== HrTransferDecisionType.REJECT)
      throw new BadRequestException('Invalid bank change decision');
    const request = await this.db.hrBankChangeRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== HrBankChangeStatus.SUBMITTED)
      throw new ConflictException('Bank change request is not pending');
    const approval = await this.db.hrApprovalInstance.findUnique({ where: {
      kind_subjectId: { kind: HrApprovalKind.BANK_CHANGE, subjectId: requestId },
    } });
    if (!approval) throw new ConflictException('Bank change approval is missing');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (/\d{12,}/.test(reason)) throw new BadRequestException('Do not enter bank or identity numbers in the decision reason');
    const progress = await this.approvals.decide(user, approval.id, decision, reason);
    if (progress.status === HrApprovalStatus.PENDING)
      return { id: Number(requestId), status: HrBankChangeStatus.SUBMITTED,
        nextApprovalPosition: progress.nextPosition };
    return this.finalize(requestId);
  }

  @Cron('0 */5 * * * *', { timeZone: 'Asia/Shanghai' })
  async reconcile() {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.HR_BANK_CHANGE_ENABLED !== 'true' ||
        process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database') return;
    const items = await this.db.hrBankChangeRequest.findMany({ where: { status: HrBankChangeStatus.SUBMITTED },
      select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
    for (const item of items) {
      try { await this.finalize(item.id); }
      catch (error) { this.logger.error(`Bank change ${item.id} reconcile failed`,
        error instanceof Error ? error.stack : String(error)); }
    }
  }

  private async finalize(requestId: bigint) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_bank_change_requests WHERE id = ${requestId} FOR UPDATE`;
      const request = await tx.hrBankChangeRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new ConflictException('Bank change request is missing');
      if (request.status !== HrBankChangeStatus.SUBMITTED)
        return { id: Number(requestId), status: request.status };
      const approval = await tx.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.BANK_CHANGE, subjectId: requestId },
      } });
      if (approval?.status === HrApprovalStatus.PENDING)
        return { id: Number(requestId), status: request.status };
      if (approval?.status === HrApprovalStatus.REJECTED) {
        await tx.hrBankChangeRequest.update({ where: { id: requestId }, data: { status: HrBankChangeStatus.REJECTED } });
        return { id: Number(requestId), status: HrBankChangeStatus.REJECTED };
      }
      if (approval?.status !== HrApprovalStatus.APPROVED)
        throw new ConflictException('Bank change approval state is missing');

      const today = todayShanghai();
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${request.employeeId} FOR UPDATE`;
      const [employee, appointment, currentVersions] = await Promise.all([
        tx.hrEmployee.findUnique({ where: { id: request.employeeId }, select: { status: true } }),
        tx.hrPrimaryAppointment.findFirst({ where: { employeeId: request.employeeId,
          storeId: request.storeId, effectiveFrom: { lte: today },
          OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }] }, select: { id: true } }),
        tx.hrBankAccountVersion.findMany({ where: { employeeId: request.employeeId, effectiveToExclusive: null },
          orderBy: { effectiveFrom: 'desc' }, select: { id: true, effectiveFrom: true } }),
      ]);
      let failureCode: string | null = null;
      if (employee?.status !== HrEmployeeStatus.ACTIVE || !appointment) failureCode = 'EMPLOYMENT_CHANGED';
      else if (currentVersions.length > 1 || (currentVersions[0] && currentVersions[0].effectiveFrom >= today))
        failureCode = 'BANK_VERSION_CONFLICT';
      if (failureCode) {
        await tx.hrBankChangeRequest.update({ where: { id: requestId }, data: {
          status: HrBankChangeStatus.EFFECTIVE_FAILED, failureCode,
        } });
        await tx.auditLog.create({ data: { entityType: 'HR_BANK_CHANGE', entityId: requestId,
          action: 'EFFECTIVE_FAILED', afterData: { failureCode } } });
        return { id: Number(requestId), status: HrBankChangeStatus.EFFECTIVE_FAILED, failureCode };
      }
      if (currentVersions[0]) await tx.hrBankAccountVersion.update({ where: { id: currentVersions[0].id },
        data: { effectiveToExclusive: today } });
      await tx.hrBankAccountVersion.create({ data: { employeeId: request.employeeId,
        sourceRevisionId: request.sourceRevisionId, bankChangeRequestId: requestId, effectiveFrom: today } });
      await tx.hrBankChangeRequest.update({ where: { id: requestId }, data: {
        status: HrBankChangeStatus.EFFECTIVE, appliedAt: new Date(),
      } });
      await tx.auditLog.create({ data: { entityType: 'HR_BANK_CHANGE', entityId: requestId,
        action: 'EFFECTIVE', afterData: { employeeId: String(request.employeeId),
          storeId: String(request.storeId), effectiveDate: today.toISOString().slice(0, 10) } } });
      return { id: Number(requestId), status: HrBankChangeStatus.EFFECTIVE,
        effectiveDate: today.toISOString().slice(0, 10) };
    });
  }
}
