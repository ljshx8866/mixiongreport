import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HrApprovalKind, HrApprovalStatus, HrEmployeeStatus, HrOnboardingStatus,
  HrSensitiveDraftKind, HrTransferDecisionType, Prisma, UserRole, UserSource } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrApprovalService } from './hr-approval.service';
import { normalizeEmployeePhone, parseBankInput, parseIdentityInput } from './hr-sensitive-draft.service';
import { HrSensitiveCrypto, loadHrSensitiveCryptoFromEnv, maskBankCard, type HrSealedValue } from './hr-sensitive-crypto';

function id(value: unknown): bigint {
  if (typeof value === 'bigint') {
    if (value > 0n) return value;
    throw new BadRequestException('Invalid id');
  }
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

function dateOnly(value: Date): string { return value.toISOString().slice(0, 10); }
const accountRoleNames: Record<UserRole, string> = {
  [UserRole.ADMIN]: '总部管理员',
  [UserRole.REGION_MANAGER]: '区域经理',
  [UserRole.STORE_MANAGER]: '门店账号',
};
function parseDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Effective date must be YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateOnly(date) !== value)
    throw new BadRequestException('Invalid effective date');
  return date;
}

function todayShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

@Injectable()
export class HrOnboardingService {
  private readonly logger = new Logger(HrOnboardingService.name);
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly approvals: HrApprovalService) {}

  private enabled() {
    if (process.env.HR_ONBOARDING_ENABLED !== 'true' || process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR onboarding is not enabled');
  }

  private intakeDraftValues(input: Record<string, unknown>) {
    const stringField = (key: string, max: number) => {
      const value = input[key];
      if (value === undefined || value === null) return '';
      if (typeof value !== 'string' || value.length > max)
        throw new BadRequestException(`Invalid ${key}`);
      return value.trim();
    };
    const effectiveDate = stringField('effectiveDate', 10);
    if (effectiveDate) parseDate(effectiveDate);
    return {
      name: stringField('name', 100) || stringField('displayName', 100),
      phone: stringField('phone', 30),
      idNumber: stringField('idNumber', 30),
      sex: stringField('sex', 10),
      ethnicity: stringField('ethnicity', 30),
      birthDate: stringField('birthDate', 30),
      address: stringField('address', 300),
      cardNumber: stringField('cardNumber', 40),
      bankName: stringField('bankName', 100),
      branchName: stringField('branchName', 150),
      effectiveDate,
      accountHrRoleId: stringField('accountHrRoleId', 24),
      jobPositionId: stringField('jobPositionId', 24),
    };
  }

  async getIntakeDraft(user: AuthContext | undefined, storeIdInput: unknown) {
    this.enabled();
    const storeId = id(storeIdInput);
    await this.assertIntakeCreateAccess(user, storeId);
    const actorId = BigInt(user!.id!);
    const draft = await this.db.hrOnboardingIntakeDraft.findUnique({
      where: { actorId_storeId: { actorId, storeId } },
    });
    if (!draft) return null;
    if (draft.expiresAt <= new Date()) {
      await this.db.hrOnboardingIntakeDraft.delete({ where: { id: draft.id } });
      return null;
    }
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    const payload = crypto.openOnboardingIntake(actorId, storeId,
      draft.sealedPayload as unknown as HrSealedValue);
    return { ...payload, updatedAt: draft.updatedAt.toISOString() };
  }

  async saveIntakeDraft(user: AuthContext | undefined, input: Record<string, unknown>) {
    this.enabled();
    const storeId = id(input.initialStoreId);
    await this.assertIntakeCreateAccess(user, storeId);
    const actorId = BigInt(user!.id!);
    const payload = this.intakeDraftValues(input);
    if (!Object.values(payload).some(Boolean)) {
      await this.db.hrOnboardingIntakeDraft.deleteMany({ where: { actorId, storeId } });
      return { saved: false, cleared: true };
    }
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    const sealedPayload = crypto.sealOnboardingIntake(actorId, storeId, payload) as unknown as Prisma.InputJsonValue;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.db.hrOnboardingIntakeDraft.upsert({
      where: { actorId_storeId: { actorId, storeId } },
      create: { actorId, storeId, sealedPayload, expiresAt },
      update: { sealedPayload, expiresAt },
    });
    await this.db.auditLog.create({ data: { userId: actorId, entityType: 'HR_ONBOARDING_INTAKE',
      entityId: storeId, action: 'SAVE_TEMPORARY', afterData: {
        storeId: String(storeId), fields: Object.keys(payload).filter((key) => payload[key as keyof typeof payload] !== ''),
      } } });
    return { saved: true, expiresAt: expiresAt.toISOString() };
  }

  async clearIntakeDraft(user: AuthContext | undefined, storeIdInput: unknown) {
    this.enabled();
    const storeId = id(storeIdInput);
    await this.assertIntakeCreateAccess(user, storeId);
    const actorId = BigInt(user!.id!);
    await this.db.hrOnboardingIntakeDraft.deleteMany({ where: { actorId, storeId } });
    return { cleared: true };
  }

  private async assertIntakeCreateAccess(user: AuthContext | undefined, storeId: bigint) {
    // Intake has its own scoped grant for sensitive fields. General employee-profile
    // editing remains separately guarded by HR_EMPLOYEE_SENSITIVE_EDIT.
    await this.access.assertStorePermission(user, 'HR_ONBOARDING_CREATE', storeId);
  }

  private async assertIntakeSubmitAccess(user: AuthContext | undefined, storeId: bigint) {
    await this.assertIntakeCreateAccess(user, storeId);
    await this.access.assertStorePermission(user, 'HR_ONBOARDING_VERIFY', storeId);
  }

  @Cron('0 30 3 * * *')
  async purgeExpiredIntakeDrafts() {
    await this.db.hrOnboardingIntakeDraft.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }

  /** One-screen onboarding: create the employee, seal sensitive values and submit approval atomically. */
  async createAndSubmit(user: AuthContext | undefined, input: Record<string, unknown>) {
    this.enabled();
    const storeId = id(input.initialStoreId);
    const trialEmployeeId = input.trialEmployeeId == null || input.trialEmployeeId === ''
      ? null : id(input.trialEmployeeId);
    const effectiveDate = parseDate(input.effectiveDate);
    if (input.confirmedOriginals !== true)
      throw new BadRequestException('Store must confirm the original ID card and bank account in person');
    const identity = parseIdentityInput({ ...input, name: input.name ?? input.displayName });
    if (!identity.phone) throw new BadRequestException('phone is required');
    const bank = parseBankInput(input);
    if (identity.name !== bank.accountName) throw new BadRequestException('Bank account name must match employee name');
    const accountHrRoleId = id(input.accountHrRoleId);
    const jobPositionId = id(input.jobPositionId);
    await this.assertIntakeSubmitAccess(user, storeId);
    const crypto: HrSensitiveCrypto = loadHrSensitiveCryptoFromEnv(process.env);
    const actorId = BigInt(user!.id!);
    try {
      return await this.db.$transaction(async (tx) => {
        const [selectedRole, selectedPosition] = await Promise.all([
          tx.hrRole.findFirst({ where: { id: accountHrRoleId, enabled: true, onboardingAssignable: true },
            select: { id: true, code: true, name: true } }),
          tx.hrJobPosition.findFirst({ where: { id: jobPositionId,
            stores: { some: { storeId, enabled: true } } },
            include: { stores: { where: { storeId, enabled: true }, select: { hourlyRate: true } } } }),
        ]);
        if (!selectedRole) throw new BadRequestException('请选择允许在入职时分配的人事角色');
        if (!selectedPosition?.stores[0]) throw new BadRequestException('请选择该门店可用的岗位');
        if (trialEmployeeId != null && (selectedPosition.scheduleOnly || selectedPosition.stores[0].hourlyRate == null))
          throw new BadRequestException('试岗转入职需要选择已设置时薪的岗位，才能计算试岗期间工时工资');
        let employee: { id: bigint; trialStartedAt: Date | null };
        let revision = 1;
        if (trialEmployeeId != null) {
          const existing = await tx.hrEmployee.findUnique({ where: { id: trialEmployeeId },
            select: { id: true, status: true, initialStoreId: true, displayName: true, trialStartedAt: true } });
          if (!existing || existing.status !== HrEmployeeStatus.TRIAL || existing.initialStoreId !== storeId ||
              existing.trialStartedAt == null)
            throw new ConflictException('试岗人员已转入职或已结束，请刷新后重试');
          if (effectiveDate < existing.trialStartedAt)
            throw new BadRequestException('入职生效日期不能早于试岗开始日期');
          const previous = await tx.hrOnboardingRequest.findFirst({ where: { employeeId: trialEmployeeId },
            orderBy: { revision: 'desc' } });
          if (previous && previous.status !== HrOnboardingStatus.REJECTED)
            throw new ConflictException('该试岗人员已有入职申请，请从申请记录中继续处理');
          const [latestIdentity, latestBank] = await Promise.all([
            tx.hrSensitiveDraftRevision.findFirst({ where: { employeeId: trialEmployeeId,
              kind: HrSensitiveDraftKind.IDENTITY }, orderBy: { version: 'desc' }, select: { version: true } }),
            tx.hrSensitiveDraftRevision.findFirst({ where: { employeeId: trialEmployeeId,
              kind: HrSensitiveDraftKind.BANK }, orderBy: { version: 'desc' }, select: { version: true } }),
          ]);
          const identityVersion = (latestIdentity?.version ?? 0) + 1;
          const bankVersion = (latestBank?.version ?? 0) + 1;
          revision = (previous?.revision ?? 0) + 1;
          employee = await tx.hrEmployee.update({ where: { id: trialEmployeeId },
            data: { displayName: identity.name }, select: { id: true, trialStartedAt: true } });
          const identityRevision = await tx.hrSensitiveDraftRevision.create({ data: {
            employeeId: employee.id, kind: HrSensitiveDraftKind.IDENTITY, version: identityVersion,
            sealedPayload: crypto.seal(employee.id, 'IDENTITY', identity) as unknown as Prisma.InputJsonValue,
            maskedValue: `${'*'.repeat(14)}${identity.idNumber.slice(-4)}`,
            source: 'MANUAL', createdBy: actorId,
          } });
          const fingerprint = crypto.identityFingerprint(identity.idNumber);
          await tx.hrIdentityClaim.upsert({ where: { employeeId: employee.id },
            create: { employeeId: employee.id, fingerprint, version: identityVersion },
            update: { fingerprint, version: identityVersion } });
          const bankRevision = await tx.hrSensitiveDraftRevision.create({ data: {
            employeeId: employee.id, kind: HrSensitiveDraftKind.BANK, version: bankVersion,
            sealedPayload: crypto.seal(employee.id, 'BANK', bank) as unknown as Prisma.InputJsonValue,
            maskedValue: maskBankCard(bank.cardNumber), source: 'MANUAL', createdBy: actorId,
          } });
          const request = await tx.hrOnboardingRequest.create({ data: {
            employeeId: employee.id, storeId, revision, effectiveDate, identityVersion, bankVersion,
            storeVerifiedBy: actorId, accountHrRoleId, jobPositionId,
            jobPositionNameSnapshot: selectedPosition.name,
            hourlyRateSnapshot: selectedPosition.stores[0].hourlyRate,
            scheduleOnlySnapshot: selectedPosition.scheduleOnly,
          } });
          await this.approvals.createForSubject(tx, HrApprovalKind.ONBOARDING, request.id, storeId, actorId, request.revision);
          await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_ONBOARDING',
            entityId: request.id, action: 'TRIAL_CONVERTED_TO_ONBOARDING', afterData: {
              employeeId: String(employee.id), storeId: String(storeId), effectiveDate: dateOnly(effectiveDate),
              trialStartedAt: dateOnly(existing.trialStartedAt), identityVersion, bankVersion,
              identityRevisionId: String(identityRevision.id), bankRevisionId: String(bankRevision.id),
              accountHrRoleId: String(accountHrRoleId), jobPositionId: String(jobPositionId),
              jobPositionName: selectedPosition.name, hourlyRate: selectedPosition.stores[0].hourlyRate?.toFixed(2) ?? null,
            } } });
          await tx.hrOnboardingIntakeDraft.deleteMany({ where: { actorId, storeId } });
          return { id: Number(request.id), employeeId: Number(employee.id), status: request.status,
            effectiveDate: dateOnly(effectiveDate), identityMask: identityRevision.maskedValue,
            bankMask: bankRevision.maskedValue, convertedTrial: true };
        }
        employee = await tx.hrEmployee.create({ data: {
          displayName: identity.name, initialStoreId: storeId,
        }, select: { id: true, trialStartedAt: true } });
        const identityVersion = 1;
        const bankVersion = 1;
        const identityRevision = await tx.hrSensitiveDraftRevision.create({ data: {
          employeeId: employee.id, kind: HrSensitiveDraftKind.IDENTITY, version: identityVersion,
          sealedPayload: crypto.seal(employee.id, 'IDENTITY', identity) as unknown as Prisma.InputJsonValue,
          maskedValue: `${'*'.repeat(14)}${identity.idNumber.slice(-4)}`,
          source: 'MANUAL', createdBy: actorId,
        } });
        const fingerprint = crypto.identityFingerprint(identity.idNumber);
        await tx.hrIdentityClaim.create({ data: { employeeId: employee.id, fingerprint, version: identityVersion } });
        const bankRevision = await tx.hrSensitiveDraftRevision.create({ data: {
          employeeId: employee.id, kind: HrSensitiveDraftKind.BANK, version: bankVersion,
          sealedPayload: crypto.seal(employee.id, 'BANK', bank) as unknown as Prisma.InputJsonValue,
          maskedValue: maskBankCard(bank.cardNumber), source: 'MANUAL', createdBy: actorId,
        } });
        const request = await tx.hrOnboardingRequest.create({ data: {
          employeeId: employee.id, storeId, revision, effectiveDate, identityVersion, bankVersion,
          storeVerifiedBy: actorId, accountHrRoleId, jobPositionId,
          jobPositionNameSnapshot: selectedPosition.name,
          hourlyRateSnapshot: selectedPosition.stores[0].hourlyRate,
          scheduleOnlySnapshot: selectedPosition.scheduleOnly,
        } });
        await this.approvals.createForSubject(tx, HrApprovalKind.ONBOARDING, request.id, storeId, actorId, request.revision);
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_ONBOARDING',
          entityId: request.id, action: 'DIRECT_CREATE_AND_SUBMIT', afterData: {
            employeeId: String(employee.id), storeId: String(storeId), effectiveDate: dateOnly(effectiveDate),
            identityVersion, bankVersion, identityRevisionId: String(identityRevision.id),
            bankRevisionId: String(bankRevision.id), accountHrRoleId: String(accountHrRoleId),
            jobPositionId: String(jobPositionId), jobPositionName: selectedPosition.name,
            hourlyRate: selectedPosition.stores[0].hourlyRate?.toFixed(2) ?? null,
            scheduleOnly: selectedPosition.scheduleOnly,
          } } });
        await tx.hrOnboardingIntakeDraft.deleteMany({ where: { actorId, storeId } });
        return { id: Number(request.id), employeeId: Number(employee.id), status: request.status,
          effectiveDate: dateOnly(effectiveDate), identityMask: identityRevision.maskedValue,
          bankMask: bankRevision.maskedValue };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Identity number is already linked to another employee');
      throw error;
    }
  }

  async submit(user: AuthContext | undefined, employeeIdInput: unknown, input: Record<string, unknown>) {
    this.enabled();
    const employeeId = id(employeeIdInput);
    const effectiveDate = parseDate(input.effectiveDate);
    if (input.confirmedOriginals !== true)
      throw new BadRequestException('Store must confirm the original ID card and bank account in person');
    const employee = await this.db.hrEmployee.findUnique({ where: { id: employeeId },
      select: { status: true, initialStoreId: true } });
    if (!employee || employee.status !== HrEmployeeStatus.DRAFT || employee.initialStoreId == null)
      throw new ConflictException('Employee draft is unavailable');
    const storeId = employee.initialStoreId;
    await this.assertIntakeSubmitAccess(user, storeId);
    const accountHrRoleId = id(input.accountHrRoleId);
    const jobPositionId = id(input.jobPositionId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
      const current = await tx.hrEmployee.findUnique({ where: { id: employeeId },
        select: { status: true, initialStoreId: true } });
      if (current?.status !== HrEmployeeStatus.DRAFT || current.initialStoreId !== storeId)
        throw new ConflictException('Employee draft changed; reload');
      const store = await tx.store.findUnique({ where: { id: storeId }, select: { status: true } });
      if (!store?.status) throw new ConflictException('Store is unavailable');
      const latest = await Promise.all([HrSensitiveDraftKind.IDENTITY, HrSensitiveDraftKind.BANK].map((kind) =>
        tx.hrSensitiveDraftRevision.findFirst({ where: { employeeId, kind },
          orderBy: { version: 'desc' }, select: { version: true, maskedValue: true } })));
      if (!latest[0] || !latest[1]) throw new ConflictException('Identity and bank drafts are required');
      const claim = await tx.hrIdentityClaim.findUnique({ where: { employeeId }, select: { version: true } });
      if (claim?.version !== latest[0].version) throw new ConflictException('Identity draft claim is out of date');
      const [selectedRole, selectedPosition] = await Promise.all([
        tx.hrRole.findFirst({ where: { id: accountHrRoleId, enabled: true, onboardingAssignable: true },
          select: { id: true } }),
        tx.hrJobPosition.findFirst({ where: { id: jobPositionId,
          stores: { some: { storeId, enabled: true } } },
          include: { stores: { where: { storeId, enabled: true }, select: { hourlyRate: true } } } }),
      ]);
      if (!selectedRole || !selectedPosition?.stores[0])
        throw new BadRequestException('请选择有效的人事角色和该门店岗位');
      const previous = await tx.hrOnboardingRequest.findFirst({ where: { employeeId }, orderBy: { revision: 'desc' } });
      if (previous && previous.status !== HrOnboardingStatus.REJECTED)
        throw new ConflictException('An onboarding request already exists');
      const request = await tx.hrOnboardingRequest.create({ data: {
        employeeId, storeId, revision: (previous?.revision ?? 0) + 1,
        effectiveDate, identityVersion: latest[0].version, bankVersion: latest[1].version,
        storeVerifiedBy: actorId, accountHrRoleId, jobPositionId,
        jobPositionNameSnapshot: selectedPosition.name,
        hourlyRateSnapshot: selectedPosition.stores[0].hourlyRate,
        scheduleOnlySnapshot: selectedPosition.scheduleOnly,
      } });
      await this.approvals.createForSubject(tx, HrApprovalKind.ONBOARDING,
        request.id, storeId, actorId, request.revision);
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_ONBOARDING',
        entityId: request.id, action: 'STORE_VERIFY_AND_SUBMIT', afterData: {
          employeeId: String(employeeId), storeId: String(storeId),
          effectiveDate: dateOnly(effectiveDate), identityVersion: latest[0].version,
          bankVersion: latest[1].version, accountHrRoleId: String(accountHrRoleId),
          jobPositionId: String(jobPositionId), jobPositionName: selectedPosition.name,
        } } });
      return { id: Number(request.id), status: request.status, revision: request.revision,
        effectiveDate: dateOnly(effectiveDate), identityMask: latest[0].maskedValue,
        bankMask: latest[1].maskedValue };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async list(user: AuthContext | undefined, storeIdInput?: unknown) {
    this.enabled();
    const access = await this.access.currentAccess(user);
    const permitted = access.stores.filter((store) => store.permissionCodes.includes('HR_ONBOARDING_LIST_READ') ||
      store.permissionCodes.includes('HR_ONBOARDING_VERIFY') ||
      store.permissionCodes.includes('HR_ONBOARDING_APPROVE'));
    const selectedId = storeIdInput == null || storeIdInput === '' ? null : id(storeIdInput);
    if (selectedId && !permitted.some((store) => BigInt(store.id) === selectedId))
      throw new ForbiddenException('HR access denied');
    const storeIds = (selectedId ? [selectedId] : permitted.map((store) => BigInt(store.id)));
    if (!storeIds.length) return [];
    const requests = await this.db.hrOnboardingRequest.findMany({ where: { storeId: { in: storeIds } },
      include: { employee: { select: { displayName: true } },
        store: { select: { storeName: true } },
        accountHrRole: { select: { id: true, code: true, name: true } },
        jobPosition: { select: { id: true, name: true } } }, orderBy: { id: 'desc' } });
    const results = await Promise.all(requests.map(async (request) => {
      const [revisions, instance] = await Promise.all([
        this.db.hrSensitiveDraftRevision.findMany({ where: { employeeId: request.employeeId,
          OR: [{ kind: HrSensitiveDraftKind.IDENTITY, version: request.identityVersion },
            { kind: HrSensitiveDraftKind.BANK, version: request.bankVersion }] },
          select: { id: true, kind: true, maskedValue: true, sealedPayload: true } }),
        this.db.hrApprovalInstance.findUnique({ where: {
          kind_subjectId: { kind: HrApprovalKind.ONBOARDING, subjectId: request.id },
        }, include: { steps: { include: { role: { select: { name: true } } } } } }),
      ]);
      const step = instance?.status === HrApprovalStatus.PENDING && instance.currentPosition != null
        ? instance.steps.find((item) => item.position === instance.currentPosition) : undefined;
      const rejectionReason = instance?.steps.find((item) => item.decision === HrTransferDecisionType.REJECT)?.reason ?? null;
      const canReadDetails = access.stores.some((store) => store.id === Number(request.storeId) &&
        store.permissionCodes.includes('HR_ONBOARDING_DETAIL_READ'));
      const canReadSensitive = access.stores.some((store) => store.id === Number(request.storeId) &&
        store.permissionCodes.includes('HR_EMPLOYEE_SENSITIVE_READ'));
      const crypto = canReadDetails && canReadSensitive ? loadHrSensitiveCryptoFromEnv(process.env) : null;
      const identityRevision = revisions.find((item) => item.kind === HrSensitiveDraftKind.IDENTITY);
      const bankRevision = revisions.find((item) => item.kind === HrSensitiveDraftKind.BANK);
      const identityDetails = identityRevision && crypto
        ? crypto.open(request.employeeId, 'IDENTITY', identityRevision.sealedPayload as unknown as HrSealedValue) : null;
      const bankDetails = bankRevision && crypto
        ? crypto.open(request.employeeId, 'BANK', bankRevision.sealedPayload as unknown as HrSealedValue) : null;
      let canDecide = false;
      let blockedReason: string | null = null;
      if (request.status === HrOnboardingStatus.SUBMITTED && step && user?.id != null) {
        if (BigInt(user.id) === instance?.requestedBy) blockedReason = '申请人不能审批本人申请';
        else {
          try {
            await this.access.assertWorkflowRolePermission(user, 'HR_ONBOARDING_APPROVE',
              request.storeId, step.roleId);
            canDecide = true;
          } catch (error) {
            if (!(error instanceof ForbiddenException)) throw error;
            blockedReason = `当前步骤需要“${step.role.name}”角色，并授权该门店`;
          }
        }
      }
      let canCorrectPhone = false;
      if (request.status === HrOnboardingStatus.REJECTED ||
          (request.status === HrOnboardingStatus.EFFECTIVE_FAILED &&
            ['PHONE_REQUIRED', 'PHONE_ACCOUNT_LINKED', 'PHONE_ACCOUNT_DISABLED',
              'PHONE_ACCOUNT_AMBIGUOUS'].includes(request.failureCode ?? ''))) {
        try {
          await this.access.assertStorePermission(user, 'HR_ONBOARDING_CREATE', request.storeId);
          await this.access.assertStorePermission(user, 'HR_ONBOARDING_VERIFY', request.storeId);
          canCorrectPhone = true;
        } catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
      }
      return { id: Number(request.id), employeeId: Number(request.employeeId), storeId: Number(request.storeId),
        employeeName: request.employee.displayName, storeName: request.store.storeName, status: request.status,
        accountRole: request.accountRole ? { code: request.accountRole, name: accountRoleNames[request.accountRole] } : null,
        accountHrRole: request.accountHrRole ? { id: Number(request.accountHrRole.id),
          code: request.accountHrRole.code, name: request.accountHrRole.name } : null,
        jobPosition: request.jobPositionNameSnapshot ? {
          id: request.jobPosition == null ? null : Number(request.jobPosition.id),
          name: request.jobPositionNameSnapshot,
          scheduleOnly: request.scheduleOnlySnapshot,
          hourlyRate: request.hourlyRateSnapshot?.toFixed(2) ?? null,
        } : null,
        revision: request.revision, effectiveDate: dateOnly(request.effectiveDate),
        failureCode: request.failureCode, canCorrectPhone,
        rejectionReason,
        identityDetails: identityDetails ? { name: identityDetails.name ?? null,
          phone: identityDetails.phone ?? null, idNumber: identityDetails.idNumber ?? null,
          sex: identityDetails.sex ?? null, ethnicity: identityDetails.ethnicity ?? null,
          birthDate: identityDetails.birthDate ?? null, address: identityDetails.address ?? null } : null,
        bankDetails: bankDetails ? { accountName: bankDetails.accountName ?? null,
          bankName: bankDetails.bankName ?? null, branchName: bankDetails.branchName ?? null,
          cardNumber: bankDetails.cardNumber ?? null } : null,
        approval: instance ? { status: instance.status, position: instance.currentPosition,
          totalSteps: instance.steps.length, roleName: step?.role.name ?? null, canDecide, blockedReason } : null,
        identityMask: revisions.find((item) => item.kind === HrSensitiveDraftKind.IDENTITY)?.maskedValue ?? null,
        bankMask: revisions.find((item) => item.kind === HrSensitiveDraftKind.BANK)?.maskedValue ?? null };
    }));
    await this.db.auditLog.create({ data: { userId: BigInt(user!.id!),
      entityType: 'HR_ONBOARDING', entityId: selectedId ?? storeIds[0], action: 'VIEW_FULL_ONBOARDING_LIST',
      afterData: { requestIds: requests.map((item) => String(item.id)), count: requests.length } } });
    return results;
  }

  async accountRoles(user: AuthContext | undefined, storeIdInput: unknown) {
    this.enabled();
    const storeId = id(storeIdInput);
    const access = await this.access.currentAccess(user);
    const store = access.stores.find((item) => BigInt(item.id) === storeId);
    if (!store?.permissionCodes.includes('HR_ONBOARDING_CREATE'))
      throw new ForbiddenException('HR onboarding intake access denied');
    const actor = await this.db.user.findUnique({ where: { id: BigInt(user!.id!) },
      select: { status: true } });
    if (!actor?.status) throw new ForbiddenException('HR access denied');
    const roles = await this.db.hrRole.findMany({ where: { enabled: true, onboardingAssignable: true },
      select: { id: true, code: true, name: true }, orderBy: { id: 'asc' } });
    return roles.map((role) => ({ id: Number(role.id), code: role.code, name: role.name }));
  }

  async correctPhoneAndResubmit(user: AuthContext | undefined, requestIdInput: unknown,
    input: Record<string, unknown>) {
    this.enabled();
    const requestId = id(requestIdInput);
    const phoneInput = typeof input.phone === 'string' ? input.phone.trim() : '';
    const phone = phoneInput ? normalizeEmployeePhone(phoneInput) : null;
    const request = await this.db.hrOnboardingRequest.findUnique({ where: { id: requestId },
      select: { id: true, employeeId: true, storeId: true, revision: true, effectiveDate: true,
        identityVersion: true, bankVersion: true, status: true, failureCode: true,
        accountHrRoleId: true, jobPositionId: true } });
    const retryable = request && (request.status === HrOnboardingStatus.REJECTED ||
      (request.status === HrOnboardingStatus.EFFECTIVE_FAILED &&
        ['PHONE_REQUIRED', 'PHONE_ACCOUNT_LINKED', 'PHONE_ACCOUNT_DISABLED',
          'PHONE_ACCOUNT_AMBIGUOUS'].includes(request.failureCode ?? '')));
    if (!request || !retryable) throw new ConflictException('Only a rejected or phone-failed onboarding can be corrected');
    const targetStoreId = input.storeId == null || input.storeId === '' ? request.storeId : id(input.storeId);
    await this.access.assertStorePermission(user, 'HR_ONBOARDING_CREATE', request.storeId);
    await this.access.assertStorePermission(user, 'HR_ONBOARDING_VERIFY', request.storeId);
    if (targetStoreId !== request.storeId) {
      await this.access.assertStorePermission(user, 'HR_ONBOARDING_CREATE', targetStoreId);
      await this.access.assertStorePermission(user, 'HR_ONBOARDING_VERIFY', targetStoreId);
    }
    const actorId = BigInt(user!.id!);
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_onboarding_requests WHERE id = ${requestId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${request.employeeId} FOR UPDATE`;
      const current = await tx.hrOnboardingRequest.findUnique({ where: { id: requestId } });
      if (!current || current.status !== request.status || current.revision !== request.revision ||
          (current.status === HrOnboardingStatus.EFFECTIVE_FAILED && current.failureCode !== request.failureCode))
        throw new ConflictException('Onboarding request changed; reload');
      const employee = await tx.hrEmployee.findUnique({ where: { id: request.employeeId },
        select: { status: true, initialStoreId: true, displayName: true, trialStartedAt: true } });
      if ((employee?.status !== HrEmployeeStatus.DRAFT && employee?.status !== HrEmployeeStatus.TRIAL) ||
          employee.initialStoreId !== request.storeId)
        throw new ConflictException('Employee draft is no longer available for correction');
      if (employee.status === HrEmployeeStatus.TRIAL && targetStoreId !== request.storeId)
        throw new BadRequestException('试岗转入职需在原试岗门店办理；如需转店，请入职生效后申请转店');
      const latestIdentity = await tx.hrSensitiveDraftRevision.findFirst({ where: {
        employeeId: request.employeeId, kind: HrSensitiveDraftKind.IDENTITY,
      }, orderBy: { version: 'desc' }, select: { version: true, sealedPayload: true } });
      const latestBank = await tx.hrSensitiveDraftRevision.findFirst({ where: {
        employeeId: request.employeeId, kind: HrSensitiveDraftKind.BANK,
      }, orderBy: { version: 'desc' }, select: { version: true } });
      if (!latestIdentity || !latestBank || latestBank.version !== request.bankVersion)
        throw new ConflictException('Employee information changed after this request; review the latest draft');
      const roleInput = input.accountHrRoleId;
      const positionInput = input.jobPositionId;
      const accountHrRoleId = roleInput == null || roleInput === ''
        ? current.accountHrRoleId : id(roleInput);
      const jobPositionId = positionInput == null || positionInput === ''
        ? current.jobPositionId : id(positionInput);
      if (targetStoreId !== request.storeId && (roleInput == null || positionInput == null))
        throw new BadRequestException('更换入职门店后请重新选择账号权限和岗位');
      const selectedRole = accountHrRoleId == null ? null : await tx.hrRole.findFirst({ where: {
        id: accountHrRoleId, enabled: true, onboardingAssignable: true }, select: { id: true } });
      const selectedPosition = jobPositionId == null ? null : await tx.hrJobPosition.findFirst({ where: {
        id: jobPositionId, stores: { some: { storeId: targetStoreId, enabled: true } } },
        include: { stores: { where: { storeId: targetStoreId, enabled: true }, select: { hourlyRate: true } } } });
      if (!selectedRole || !selectedPosition?.stores[0])
        throw new BadRequestException('请在入职申请页选择有效的人事角色和岗位');
      if (employee.status === HrEmployeeStatus.TRIAL &&
          (selectedPosition.scheduleOnly || selectedPosition.stores[0].hourlyRate == null))
        throw new BadRequestException('试岗转入职需要选择已设置时薪的岗位，才能计算试岗期间工时工资');
      if (employee.status === HrEmployeeStatus.TRIAL && employee.trialStartedAt &&
          current.effectiveDate < employee.trialStartedAt)
        throw new BadRequestException('入职生效日期不能早于试岗开始日期');
      const identity = crypto.open(request.employeeId, 'IDENTITY',
        latestIdentity.sealedPayload as unknown as HrSealedValue);
      if (identity.name !== employee.displayName || typeof identity.idNumber !== 'string')
        throw new ConflictException('Employee identity details are unavailable; contact HR');
      let correctedVersion = latestIdentity.version;
      if (phone) {
        correctedVersion += 1;
        const correctedIdentity = { ...identity, phone };
        await tx.hrSensitiveDraftRevision.create({ data: {
          employeeId: request.employeeId, kind: HrSensitiveDraftKind.IDENTITY, version: correctedVersion,
          sealedPayload: crypto.seal(request.employeeId, 'IDENTITY', correctedIdentity) as unknown as Prisma.InputJsonValue,
          maskedValue: `${'*'.repeat(14)}${identity.idNumber.slice(-4)}`,
          source: 'PHONE_CORRECTION', createdBy: actorId,
        } });
        await tx.hrIdentityClaim.update({ where: { employeeId: request.employeeId }, data: { version: correctedVersion } });
      }
      const revision = request.revision + 1;
      const resubmitted = await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
        revision, identityVersion: correctedVersion, storeId: targetStoreId, status: HrOnboardingStatus.SUBMITTED,
        failureCode: null, appliedAt: null, storeVerifiedBy: actorId, storeVerifiedAt: new Date(),
        accountHrRoleId, jobPositionId, jobPositionNameSnapshot: selectedPosition.name,
        hourlyRateSnapshot: selectedPosition.stores[0].hourlyRate,
        scheduleOnlySnapshot: selectedPosition.scheduleOnly,
      } });
      if (targetStoreId !== request.storeId)
        await tx.hrEmployee.update({ where: { id: request.employeeId }, data: { initialStoreId: targetStoreId } });
      await this.approvals.restartForSubject(tx, HrApprovalKind.ONBOARDING,
        requestId, actorId, revision, targetStoreId);
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_ONBOARDING',
        entityId: requestId, action: phone && targetStoreId === request.storeId
          ? 'PHONE_CORRECTION_RESUBMIT' : 'CORRECTION_RESUBMIT',
        beforeData: { requestId: String(request.id), status: request.status,
          revision: request.revision, failureCode: request.failureCode, storeId: String(request.storeId) },
        afterData: { employeeId: String(request.employeeId), revision: resubmitted.revision,
          storeId: String(targetStoreId), identityVersion: correctedVersion,
          phoneMask: phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : null,
          accountHrRoleId: String(accountHrRoleId), jobPositionId: String(jobPositionId),
          jobPositionName: selectedPosition.name },
      } });
      return { id: Number(resubmitted.id), employeeId: Number(request.employeeId),
        status: resubmitted.status, revision: resubmitted.revision,
        effectiveDate: dateOnly(resubmitted.effectiveDate) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async history(user: AuthContext | undefined, requestIdInput: unknown) {
    this.enabled();
    const requestId = id(requestIdInput);
    const request = await this.db.hrOnboardingRequest.findUnique({ where: { id: requestId },
      select: { id: true, employeeId: true, storeId: true, revision: true, status: true } });
    if (!request) throw new ConflictException('Onboarding request not found');
    const access = await this.access.currentAccess(user);
    const permission = access.stores.find((store) => BigInt(store.id) === request.storeId &&
      store.permissionCodes.includes('HR_ONBOARDING_DETAIL_READ'));
    if (!permission) throw new ForbiddenException('HR access denied');

    // Resolve every revision belonging to this employee so existing resubmissions
    // remain visible in one history even before any legacy duplicate cleanup.
    const requests = await this.db.hrOnboardingRequest.findMany({ where: { employeeId: request.employeeId },
      select: { id: true, revision: true, status: true, failureCode: true, createdAt: true, updatedAt: true },
      orderBy: [{ revision: 'asc' }, { id: 'asc' }] });
    const requestIds = requests.map((item) => item.id);
    const instances = await this.db.hrApprovalInstance.findMany({ where: {
      kind: HrApprovalKind.ONBOARDING, subjectId: { in: requestIds },
    }, select: { id: true, subjectId: true } });
    const approvalIds = instances.map((item) => item.id);
    const audit = await this.db.auditLog.findMany({ where: { OR: [
      { entityType: 'HR_ONBOARDING', entityId: { in: requestIds } },
      ...(approvalIds.length ? [{ entityType: 'HR_APPROVAL', entityId: { in: approvalIds } }] : []),
    ] }, include: { user: { select: { name: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1000 });
    return {
      request: { id: Number(request.id), revision: request.revision, status: request.status },
      revisions: requests.map((item) => ({ id: Number(item.id), revision: item.revision,
        status: item.status, failureCode: item.failureCode,
        createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
      events: audit.map((item) => ({ id: Number(item.id), entityType: item.entityType,
        action: item.action, actorName: item.user?.name ?? '系统',
        createdAt: item.createdAt.toISOString(), reason: item.reason,
        beforeData: item.beforeData, afterData: item.afterData })),
    };
  }

  async decide(user: AuthContext | undefined, requestIdInput: unknown, input: Record<string, unknown>) {
    this.enabled();
    const requestId = id(requestIdInput);
    const decision = input.decision;
    if (decision !== HrTransferDecisionType.APPROVE && decision !== HrTransferDecisionType.REJECT)
      throw new BadRequestException('Invalid onboarding decision');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const request = await this.db.hrOnboardingRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== HrOnboardingStatus.SUBMITTED)
      throw new ConflictException('Onboarding request is not pending');
    const instance = await this.db.hrApprovalInstance.findUnique({ where: {
      kind_subjectId: { kind: HrApprovalKind.ONBOARDING, subjectId: requestId },
    }, include: { steps: { select: { position: true } } } });
    if (!instance) throw new ConflictException('Onboarding approval is missing');
    // Position and account capabilities are locked in at intake; approvers only
    // verify the submitted information and decide the approval step.
    const progress = await this.approvals.decide(user, instance.id, decision, reason);
    if (progress.status === HrApprovalStatus.PENDING)
      return { id: Number(requestId), status: HrOnboardingStatus.SUBMITTED,
        nextApprovalPosition: progress.nextPosition };
    return this.finalize(requestId);
  }

  @Cron('0 */5 * * * *', { timeZone: 'Asia/Shanghai' })
  async reconcile() {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.HR_ONBOARDING_ENABLED !== 'true' ||
        process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database') return;
    const rows = await this.db.hrOnboardingRequest.findMany({ where: { status: { in: [
      HrOnboardingStatus.SUBMITTED, HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE,
    ] } }, select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
    for (const row of rows) {
      try { await this.finalize(row.id); }
      catch (error) { this.logger.error(`Onboarding ${row.id} reconcile failed`,
        error instanceof Error ? error.stack : String(error)); }
    }
  }

  private async finalize(requestId: bigint) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_onboarding_requests WHERE id = ${requestId} FOR UPDATE`;
      const request = await tx.hrOnboardingRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new ConflictException('Onboarding request is missing');
      if (request.status !== HrOnboardingStatus.SUBMITTED &&
          request.status !== HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE)
        return { id: Number(requestId), status: request.status };
      const approval = await tx.hrApprovalInstance.findUnique({ where: {
        kind_subjectId: { kind: HrApprovalKind.ONBOARDING, subjectId: requestId },
      } });
      if (approval?.status === HrApprovalStatus.PENDING) return { id: Number(requestId), status: request.status };
      if (approval?.status === HrApprovalStatus.REJECTED) {
        await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: { status: HrOnboardingStatus.REJECTED } });
        return { id: Number(requestId), status: HrOnboardingStatus.REJECTED };
      }
      if (approval?.status !== HrApprovalStatus.APPROVED)
        throw new ConflictException('Onboarding approval state is missing');
      if (dateOnly(request.effectiveDate) > todayShanghai()) {
        if (request.status !== HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE)
          await tx.hrOnboardingRequest.update({ where: { id: requestId },
            data: { status: HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE } });
        return { id: Number(requestId), status: HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE };
      }
      // A selected role may be disabled or removed from onboarding assignment
      // between final approval and a scheduled effective date. Keep the
      // approved request pending until an administrator makes it assignable
      // again; never grant a role that is no longer explicitly allowed.
      if (request.accountHrRoleId != null) {
        const role = await tx.hrRole.findFirst({ where: { id: request.accountHrRoleId,
          enabled: true, onboardingAssignable: true }, select: { id: true } });
        if (!role) {
          await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
            status: HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE,
            failureCode: 'ACCOUNT_ROLE_UNAVAILABLE',
          } });
          return { id: Number(requestId), status: HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE };
        }
      }
      if (request.jobPositionId != null && !request.scheduleOnlySnapshot && request.hourlyRateSnapshot == null) {
        await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
          status: HrOnboardingStatus.EFFECTIVE_FAILED, failureCode: 'JOB_POSITION_UNAVAILABLE',
        } });
        return { id: Number(requestId), status: HrOnboardingStatus.EFFECTIVE_FAILED };
      }
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${request.employeeId} FOR UPDATE`;
      const [employee, store, claim, identity, bank, appointment] = await Promise.all([
        tx.hrEmployee.findUnique({ where: { id: request.employeeId },
          select: { status: true, initialStoreId: true, displayName: true, trialStartedAt: true } }),
        tx.store.findUnique({ where: { id: request.storeId }, select: { status: true } }),
        tx.hrIdentityClaim.findUnique({ where: { employeeId: request.employeeId }, select: { version: true } }),
        tx.hrSensitiveDraftRevision.findFirst({ where: { employeeId: request.employeeId,
          kind: HrSensitiveDraftKind.IDENTITY }, orderBy: { version: 'desc' },
          select: { id: true, version: true, sealedPayload: true } }),
        tx.hrSensitiveDraftRevision.findFirst({ where: { employeeId: request.employeeId,
          kind: HrSensitiveDraftKind.BANK }, orderBy: { version: 'desc' }, select: { id: true, version: true } }),
        tx.hrPrimaryAppointment.findFirst({ where: { employeeId: request.employeeId }, select: { id: true } }),
      ]);
      if ((employee?.status !== HrEmployeeStatus.DRAFT && employee?.status !== HrEmployeeStatus.TRIAL) ||
          employee.initialStoreId !== request.storeId ||
          !store?.status || appointment || claim?.version !== request.identityVersion ||
          identity?.version !== request.identityVersion || bank?.version !== request.bankVersion) {
        await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
          status: HrOnboardingStatus.EFFECTIVE_FAILED, failureCode: 'SOURCE_CHANGED',
        } });
        return { id: Number(requestId), status: HrOnboardingStatus.EFFECTIVE_FAILED };
      }
      if (request.hourlyRateSnapshot != null && await tx.hrSalaryRate.findFirst({ where: {
        employeeId: request.employeeId,
      }, select: { id: true } })) {
        await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
          status: HrOnboardingStatus.EFFECTIVE_FAILED, failureCode: 'SALARY_RATE_CONFLICT',
        } });
        return { id: Number(requestId), status: HrOnboardingStatus.EFFECTIVE_FAILED };
      }
      // Create or safely attach the employee's mini-program account only when
      // the approved employment actually takes effect. Do not create a
      // UserStore grant: employee self-service must not grant store reporting
      // or daily-input access by implication.
      const identityValue = loadHrSensitiveCryptoFromEnv(process.env).open(
        request.employeeId, 'IDENTITY', identity!.sealedPayload as unknown as import('./hr-sensitive-crypto').HrSealedValue,
      );
      const mobile = typeof identityValue.phone === 'string' ? identityValue.phone : '';
      if (!/^1\d{10}$/.test(mobile)) {
        await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
          status: HrOnboardingStatus.EFFECTIVE_FAILED, failureCode: 'PHONE_REQUIRED',
        } });
        return { id: Number(requestId), status: HrOnboardingStatus.EFFECTIVE_FAILED };
      }
      // POS may store the same phone with a country prefix. Match by the final
      // 11 digits and refuse ambiguous matches instead of creating a duplicate.
      const matchingAccounts = await tx.user.findMany({ where: { mobile: { endsWith: mobile } },
        select: { id: true, name: true, status: true, hrEmployee: { select: { id: true } } } });
      if (matchingAccounts.length > 1) {
        await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
          status: HrOnboardingStatus.EFFECTIVE_FAILED, failureCode: 'PHONE_ACCOUNT_AMBIGUOUS',
        } });
        return { id: Number(requestId), status: HrOnboardingStatus.EFFECTIVE_FAILED };
      }
      const existingAccount = matchingAccounts[0] ?? null;
      if (existingAccount && (!existingAccount.status ||
          (existingAccount.hrEmployee && existingAccount.hrEmployee.id !== request.employeeId))) {
        await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
          status: HrOnboardingStatus.EFFECTIVE_FAILED,
          failureCode: existingAccount.status ? 'PHONE_ACCOUNT_LINKED' : 'PHONE_ACCOUNT_DISABLED',
        } });
        return { id: Number(requestId), status: HrOnboardingStatus.EFFECTIVE_FAILED };
      }
      const account = existingAccount
        ? await tx.user.update({ where: { id: existingAccount.id }, data: {
          name: employee.displayName,
        }, select: { id: true } })
        : await tx.user.create({ data: {
          name: employee.displayName, mobile, role: UserRole.STORE_MANAGER,
          status: true, source: UserSource.LOCAL,
        }, select: { id: true } });
      if (existingAccount && existingAccount.name !== employee.displayName) {
        await tx.auditLog.create({ data: { entityType: 'USER', entityId: account.id,
          action: 'HR_ONBOARDING_NAME_SYNC', beforeData: { name: existingAccount.name },
          afterData: { name: employee.displayName, employeeId: String(request.employeeId),
            onboardingRequestId: String(requestId) } } });
      }
      // HR roles are account capabilities. Store access remains the shared
      // UserStore scope used by reporting and HR management; onboarding alone
      // must not grant reporting or daily-input access.
      const previousHrGrants = await tx.hrRoleGrant.findMany({ where: {
        userId: account.id, active: true,
      }, select: { roleId: true } });
      await tx.hrRoleGrant.updateMany({ where: { userId: account.id, active: true },
        data: { active: false } });
      if (request.accountHrRoleId != null) {
        await tx.hrRoleGrant.upsert({
          where: { userId_roleId: { userId: account.id, roleId: request.accountHrRoleId } },
          create: { userId: account.id, roleId: request.accountHrRoleId },
          update: { active: true },
        });
        const selectedHrRole = await tx.hrRole.findUnique({ where: { id: request.accountHrRoleId },
          select: { code: true, name: true } });
        await tx.auditLog.create({ data: { entityType: 'HR_ONBOARDING', entityId: requestId,
          action: 'HR_ACCOUNT_ROLE_APPLIED', beforeData: { userId: String(account.id),
            activeHrRoles: previousHrGrants.map((grant) => String(grant.roleId)) },
          afterData: { userId: String(account.id),
            hrRoleId: String(request.accountHrRoleId), role: selectedHrRole?.code ?? null,
            roleName: selectedHrRole?.name ?? null, roleScope: 'ACCOUNT' } } });
      } else if (previousHrGrants.length) {
        await tx.auditLog.create({ data: { entityType: 'HR_ONBOARDING', entityId: requestId,
          action: 'HR_ACCOUNT_ROLE_CLEARED', beforeData: { userId: String(account.id),
            activeHrRoles: previousHrGrants.map((grant) => String(grant.roleId)) },
          afterData: { userId: String(account.id), activeHrRoles: [] } } });
      }
      await tx.hrPrimaryAppointment.create({ data: { employeeId: request.employeeId,
        storeId: request.storeId, effectiveFrom: request.effectiveDate } });
      await tx.hrBankAccountVersion.create({ data: {
        employeeId: request.employeeId, sourceRevisionId: bank!.id,
        onboardingRequestId: requestId, effectiveFrom: request.effectiveDate,
      } });
      if (!request.scheduleOnlySnapshot && request.hourlyRateSnapshot != null) {
        const wageEffectiveFrom = employee.status === HrEmployeeStatus.TRIAL && employee.trialStartedAt &&
          employee.trialStartedAt < request.effectiveDate ? employee.trialStartedAt : request.effectiveDate;
        await tx.hrSalaryRate.create({ data: { employeeId: request.employeeId,
          hourlyRate: request.hourlyRateSnapshot, effectiveFrom: wageEffectiveFrom,
          sourceOnboardingRequestId: requestId } });
      }
      let invalidatedPayrollReviews = 0;
      if (employee.status === HrEmployeeStatus.TRIAL && employee.trialStartedAt &&
          process.env.HR_PAY_CALC_ENABLED === 'true') {
        const trialMonth = new Date(Date.UTC(employee.trialStartedAt.getUTCFullYear(),
          employee.trialStartedAt.getUTCMonth(), 1));
        const affectedReviews = await tx.hrMonthlyReview.findMany({ where: {
          storeId: request.storeId, month: { gte: trialMonth },
          status: { in: ['SUBMITTED', 'APPROVED'] }, invalidatedAt: null,
        }, select: { id: true } });
        const reviewIds = affectedReviews.map((item) => item.id);
        if (reviewIds.length) {
          await tx.hrMonthlyReview.updateMany({ where: { id: { in: reviewIds } }, data: {
            invalidatedAt: new Date(), invalidationReason: `TRIAL_ONBOARDING:${requestId}`,
          } });
          const pendingApprovals = await tx.hrApprovalInstance.findMany({ where: {
            kind: HrApprovalKind.MONTHLY_REVIEW, subjectId: { in: reviewIds }, status: HrApprovalStatus.PENDING,
          }, select: { id: true } });
          const approvalIds = pendingApprovals.map((item) => item.id);
          if (approvalIds.length) {
            await tx.hrApprovalInstance.updateMany({ where: { id: { in: approvalIds } },
              data: { status: HrApprovalStatus.REJECTED, currentPosition: null } });
            await tx.hrApprovalNotification.deleteMany({ where: {
              subject: 'APPROVAL', subjectId: { in: approvalIds },
            } });
          }
          invalidatedPayrollReviews = reviewIds.length;
        }
      }
      await tx.hrEmployee.update({ where: { id: request.employeeId }, data: {
        status: HrEmployeeStatus.ACTIVE, userId: account.id, jobPositionId: request.jobPositionId,
      } });
      await tx.hrOnboardingRequest.update({ where: { id: requestId }, data: {
        status: HrOnboardingStatus.EFFECTIVE, appliedAt: new Date(), failureCode: null,
      } });
      await tx.auditLog.create({ data: { entityType: 'HR_ONBOARDING', entityId: requestId,
        action: 'EFFECTIVE', afterData: { employeeId: String(request.employeeId),
          storeId: String(request.storeId), effectiveDate: dateOnly(request.effectiveDate),
          userId: String(account.id), accountCreated: existingAccount == null,
          accountHrRoleId: request.accountHrRoleId == null ? null : String(request.accountHrRoleId),
          jobPositionId: request.jobPositionId == null ? null : String(request.jobPositionId),
          hourlyRate: request.hourlyRateSnapshot?.toFixed(2) ?? null,
          wageEffectiveFrom: employee.trialStartedAt && employee.trialStartedAt < request.effectiveDate
            ? dateOnly(employee.trialStartedAt) : dateOnly(request.effectiveDate),
          invalidatedPayrollReviews } } });
      return { id: Number(requestId), status: HrOnboardingStatus.EFFECTIVE };
    });
  }
}
