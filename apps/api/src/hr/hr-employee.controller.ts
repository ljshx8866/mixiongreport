import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { HrApprovalKind, HrEmployeeStatus, Prisma, UserRole } from '@prisma/client';
import { calculateDailyWorkTime } from '@restaurant/hr-engine';
import { HrSensitiveDraftKind } from '@prisma/client';
import { Roles, type RequestWithUser } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { snapshotHash } from './hr-snapshot-hash';
import { loadHrSensitiveCryptoFromEnv, type HrSealedValue } from './hr-sensitive-crypto';
import { deleteHrLinkedAccount } from './hr-user-account';
import { normalizeEmployeePhone } from './hr-sensitive-draft.service';
import { calculateConfirmedWorkPay } from './hr-hourly-pay';
import { roleAllowsScheduling } from './hr-scheduling-eligibility';

function positiveId(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function decimalCents(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^(-?\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const sign = match[1].startsWith('-') ? -1n : 1n;
  const integer = BigInt(match[1].replace('-', ''));
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
  return sign * (integer * 100n + fraction);
}

@Controller('api/hr/employees')
export class HrEmployeeController {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  @Get('trials') async listTrials(@Req() request: RequestWithUser,
    @Query('storeId') storeIdInput: string) {
    const storeId = positiveId(storeIdInput);
    await this.access.assertAnyStorePermission(request.user,
      ['HR_TRIAL_MANAGE', 'HR_ONBOARDING_CREATE'], storeId);
    const rows = await this.db.hrEmployee.findMany({ where: {
      status: HrEmployeeStatus.TRIAL, initialStoreId: storeId,
    }, select: { id: true, displayName: true, trialStartedAt: true }, orderBy: [
      { trialStartedAt: 'asc' }, { displayName: 'asc' },
    ] });
    return rows.map((row) => ({ id: Number(row.id), name: row.displayName,
      trialStartedAt: row.trialStartedAt?.toISOString().slice(0, 10) ?? null }));
  }

  @Get('trials/history') async listTrialHistory(@Req() request: RequestWithUser,
    @Query('storeId') storeIdInput: string) {
    const storeId = positiveId(storeIdInput);
    await this.access.assertStorePermission(request.user, 'HR_TRIAL_MANAGE', storeId);
    const rows = await this.db.hrEmployee.findMany({ where: {
      initialStoreId: storeId, trialStartedAt: { not: null },
      status: { in: [HrEmployeeStatus.TRIAL, HrEmployeeStatus.TRIAL_ENDED,
        HrEmployeeStatus.ACTIVE, HrEmployeeStatus.TERMINATED] },
    }, select: { id: true, displayName: true, status: true, trialStartedAt: true, trialEndedAt: true },
    orderBy: [{ trialStartedAt: 'desc' }, { id: 'desc' }] });
    return rows.map((row) => ({ id: Number(row.id), name: row.displayName, status: row.status,
      trialStartedAt: row.trialStartedAt?.toISOString().slice(0, 10) ?? null,
      trialEndedAt: row.trialEndedAt?.toISOString() ?? null }));
  }

  @Post('trials') async createTrial(@Req() request: RequestWithUser,
    @Body() body: Record<string, unknown>) {
    const storeId = positiveId(body.storeId);
    await this.access.assertStorePermission(request.user, 'HR_TRIAL_MANAGE', storeId);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) throw new BadRequestException('请输入有效的试岗人员姓名');
    const startDate = body.trialStartedAt;
    if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      throw new BadRequestException('请选择试岗开始日期');
    const trialStartedAt = new Date(`${startDate}T00:00:00.000Z`);
    if (Number.isNaN(trialStartedAt.getTime()) || trialStartedAt.toISOString().slice(0, 10) !== startDate)
      throw new BadRequestException('试岗开始日期无效');
    const store = await this.db.store.findUnique({ where: { id: storeId }, select: { status: true } });
    if (!store?.status) throw new ConflictException('门店不存在或已停用');
    const employee = await this.db.hrEmployee.create({ data: { displayName: name,
      status: HrEmployeeStatus.TRIAL, initialStoreId: storeId, trialStartedAt },
      select: { id: true, displayName: true, trialStartedAt: true } });
    return { id: Number(employee.id), name: employee.displayName,
      trialStartedAt: employee.trialStartedAt?.toISOString().slice(0, 10) ?? startDate };
  }

  @Get('account-candidates') async accountCandidates(@Req() request: RequestWithUser,
    @Query('employeeId') employeeIdInput: string, @Query('storeId') storeIdInput: string,
    @Query('q') queryInput = '') {
    const employeeId = positiveId(employeeIdInput);
    const storeId = positiveId(storeIdInput);
    const employee = await this.db.hrEmployee.findFirst({ where: { id: employeeId, OR: [
      { initialStoreId: storeId }, { primaryAppointments: { some: { storeId } } },
    ] }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found in the selected store');
    await this.access.assertStorePermission(request.user, 'HR_EMPLOYEE_ACCOUNT_LINK', storeId);
    const query = typeof queryInput === 'string' ? queryInput.trim().slice(0, 100) : '';
    if (query.length < 2) return [];
    const users = await this.db.user.findMany({ where: {
      status: true, stores: { some: { storeId } },
      OR: [{ name: { contains: query } }, { mobile: { contains: query } }],
    }, select: { id: true, name: true, mobile: true, hrEmployee: { select: { id: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100 });
    return users.filter((user) => user.hrEmployee == null || user.hrEmployee.id === employeeId)
      .slice(0, 50).map((user) => ({ id: Number(user.id), name: user.name,
        mobile: user.mobile, linked: user.hrEmployee?.id === employeeId }));
  }

  @Get('candidates') async candidates(@Req() request: RequestWithUser,
    @Query('storeId', ParseIntPipe) storeIdValue: number, @Query('date') dateInput?: string) {
    const storeId = positiveId(storeIdValue);
    await this.access.assertAnyStorePermission(request.user,
      ['HR_SCHEDULE_DRAFT_EDIT', 'HR_TRANSFER_REQUEST'], storeId);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    const date = dateInput ?? `${part('year')}-${part('month')}-${part('day')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Invalid candidate date');
    const today = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(today.getTime()) || today.toISOString().slice(0, 10) !== date)
      throw new BadRequestException('Invalid candidate date');
    const employees = await this.db.hrEmployee.findMany({
      where: { OR: [
        { status: HrEmployeeStatus.ACTIVE, primaryAppointments: { some: {
          storeId, effectiveFrom: { lte: today },
          OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }],
        } } },
        { status: HrEmployeeStatus.TRIAL, initialStoreId: storeId, trialStartedAt: { lte: today } },
      ] },
      select: { id: true, displayName: true, status: true, trialStartedAt: true, user: { select: { hrRoleGrants: {
        where: { active: true }, select: { role: { select: { enabled: true, participatesInScheduling: true } } },
      } } } }, orderBy: { displayName: 'asc' }, take: 200,
    });
    return employees.filter((employee) => employee.status === HrEmployeeStatus.TRIAL ||
      roleAllowsScheduling(employee.user?.hrRoleGrants))
      .map((employee) => ({ id: Number(employee.id), displayName: employee.displayName }));
  }

  @Get('me/schedules') async mySchedules(@Req() request: RequestWithUser) {
    await this.access.currentAccess(request.user);
    const employee = await this.db.hrEmployee.findUnique({
      where: { userId: BigInt(request.user!.id!) }, select: { id: true, status: true },
    });
    if (!employee || employee.status !== HrEmployeeStatus.ACTIVE) return [];
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    const today = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
    const until = new Date(today.getTime() + 14 * 86400000);
    const schedules = await this.db.hrSchedule.findMany({
      where: { employeeId: employee.id, status: 'PUBLISHED',
        businessDate: { gte: today, lt: until } },
      include: { versions: true, store: { select: { storeName: true } } },
      orderBy: { businessDate: 'asc' }, take: 50,
    });
    return schedules.flatMap((schedule) => {
      const version = schedule.versions.find((item) => item.version === schedule.currentVersion);
      return version ? [{ id: Number(schedule.id), storeName: schedule.store.storeName,
        date: schedule.businessDate.toISOString().slice(0, 10),
        start: version.plannedStart.toISOString(), end: version.plannedEnd.toISOString(),
        breakMinutes: version.breakMinutes }] : [];
    });
  }

  @Get('me/profile') async myProfile(@Req() request: RequestWithUser) {
    await this.access.currentAccess(request.user);
    const employee = await this.db.hrEmployee.findUnique({ where: { userId: BigInt(request.user!.id!) },
      select: { id: true, displayName: true, status: true, primaryAppointments: {
        orderBy: { effectiveFrom: 'desc' }, take: 1, include: { store: { select: { storeName: true } } },
      } } });
    if (!employee || employee.status !== HrEmployeeStatus.ACTIVE)
      throw new ConflictException('Active employee profile is unavailable');
    const identityRevision = await this.db.hrSensitiveDraftRevision.findFirst({ where: {
      employeeId: employee.id, kind: HrSensitiveDraftKind.IDENTITY,
    }, orderBy: { version: 'desc' }, select: { id: true, sealedPayload: true } });
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) + 'T00:00:00.000Z');
    const bankVersion = await this.db.hrBankAccountVersion.findFirst({ where: {
      employeeId: employee.id, effectiveFrom: { lte: today },
      OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }],
    }, orderBy: { effectiveFrom: 'desc' }, include: { sourceRevision: { select: { id: true, sealedPayload: true } } } });
    if (!identityRevision) throw new ConflictException('Employee identity profile is unavailable');
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    const identity = crypto.open(employee.id, 'IDENTITY', identityRevision.sealedPayload as unknown as HrSealedValue);
    const bank = bankVersion
      ? crypto.open(employee.id, 'BANK', bankVersion.sourceRevision.sealedPayload as unknown as HrSealedValue) : null;
    await this.db.auditLog.create({ data: { userId: BigInt(request.user!.id!),
      entityType: 'HR_EMPLOYEE', entityId: employee.id, action: 'VIEW_OWN_PROFILE',
      afterData: { identityRevisionId: String(identityRevision.id), bankRevisionId: bankVersion
        ? String(bankVersion.sourceRevision.id) : null } } });
    return {
      name: employee.displayName,
      phone: typeof identity.phone === 'string' ? identity.phone : null,
      idNumber: typeof identity.idNumber === 'string' ? identity.idNumber : null,
      sex: identity.sex ?? null, ethnicity: identity.ethnicity ?? null,
      birthDate: identity.birthDate ?? null, address: identity.address ?? null,
      bank: bank ? { bankName: bank.bankName ?? null, branchName: bank.branchName ?? null,
        cardNumber: typeof bank.cardNumber === 'string' ? bank.cardNumber : null } : null,
      status: employee.status,
      storeName: employee.primaryAppointments[0]?.store.storeName ?? null,
    };
  }

  @Get(':employeeId') async detail(@Req() request: RequestWithUser,
    @Param('employeeId', ParseIntPipe) employeeIdValue: number) {
    const access = await this.access.currentAccess(request.user);
    const storeIds = access.stores.filter((store) => store.permissionCodes.includes('HR_EMPLOYEE_DETAIL_READ'))
      .map((store) => BigInt(store.id));
    if (!storeIds.length) throw new ForbiddenException('HR access denied');
    const employeeId = positiveId(employeeIdValue);
    const employee = await this.db.hrEmployee.findFirst({ where: { id: employeeId, OR: [
      { initialStoreId: { in: storeIds } }, { primaryAppointments: { some: { storeId: { in: storeIds } } } },
    ] }, include: { primaryAppointments: { where: { storeId: { in: storeIds } },
      orderBy: { effectiveFrom: 'desc' }, include: { store: { select: { id: true, storeName: true } } } },
      jobPosition: { select: { id: true, name: true, scheduleOnly: true } } } });
    if (!employee) throw new NotFoundException('Employee not found in the authorized stores');
    const mayReadSensitive = access.stores.some((store) =>
      (employee.initialStoreId === BigInt(store.id) ||
        employee.primaryAppointments.some((appointment) => appointment.storeId === BigInt(store.id))) &&
      store.permissionCodes.includes('HR_EMPLOYEE_SENSITIVE_READ'));
    const identityRevision = mayReadSensitive ? await this.db.hrSensitiveDraftRevision.findFirst({ where: {
      employeeId, kind: HrSensitiveDraftKind.IDENTITY,
    }, orderBy: { version: 'desc' }, select: { id: true, sealedPayload: true } }) : null;
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) + 'T00:00:00.000Z');
    const bankVersion = mayReadSensitive ? await this.db.hrBankAccountVersion.findFirst({ where: {
      employeeId, effectiveFrom: { lte: today },
      OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }],
    }, orderBy: { effectiveFrom: 'desc' }, include: { sourceRevision: { select: { id: true, sealedPayload: true } } } }) : null;
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    const identity = identityRevision
      ? crypto.open(employeeId, 'IDENTITY', identityRevision.sealedPayload as unknown as HrSealedValue) : null;
    const bank = bankVersion
      ? crypto.open(employeeId, 'BANK', bankVersion.sourceRevision.sealedPayload as unknown as HrSealedValue) : null;
    await this.db.auditLog.create({ data: { userId: BigInt(request.user!.id!),
      entityType: 'HR_EMPLOYEE', entityId: employeeId, action: 'VIEW_FULL_EMPLOYEE_PROFILE',
      afterData: { identityRevisionId: identityRevision ? String(identityRevision.id) : null,
        bankRevisionId: bankVersion ? String(bankVersion.sourceRevision.id) : null,
        storeIds: employee.primaryAppointments.map((item) => String(item.storeId)) } } });
    return { id: Number(employee.id), displayName: employee.displayName, status: employee.status,
      userId: employee.userId == null ? null : Number(employee.userId),
      jobPosition: employee.jobPosition ? { id: Number(employee.jobPosition.id), name: employee.jobPosition.name,
        scheduleOnly: employee.jobPosition.scheduleOnly } : null,
      storeId: employee.primaryAppointments[0] ? Number(employee.primaryAppointments[0].storeId)
        : employee.initialStoreId == null ? null : Number(employee.initialStoreId),
      identity: identity ? { name: identity.name ?? employee.displayName, phone: identity.phone ?? null,
        idNumber: identity.idNumber ?? null, sex: identity.sex ?? null, ethnicity: identity.ethnicity ?? null,
        birthDate: identity.birthDate ?? null, address: identity.address ?? null } : null,
      bank: bank ? { accountName: bank.accountName ?? null, bankName: bank.bankName ?? null,
        branchName: bank.branchName ?? null, cardNumber: bank.cardNumber ?? null } : null,
      appointments: employee.primaryAppointments.map((item) => ({ storeId: Number(item.storeId),
        storeName: item.store.storeName, effectiveFrom: item.effectiveFrom.toISOString().slice(0, 10),
        effectiveToExclusive: item.effectiveToExclusive?.toISOString().slice(0, 10) ?? null })) };
  }

  @Patch(':employeeId') async updateProfile(@Req() request: RequestWithUser,
    @Param('employeeId', ParseIntPipe) employeeIdValue: number, @Body() body: Record<string, unknown>) {
    const employeeId = positiveId(employeeIdValue);
    const employee = await this.db.hrEmployee.findUnique({ where: { id: employeeId },
      select: { id: true, displayName: true, status: true, userId: true, jobPositionId: true,
        initialStoreId: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status === HrEmployeeStatus.DRAFT)
      throw new ConflictException('Pending onboarding records must be corrected from the onboarding workflow');
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) + 'T00:00:00.000Z');
    const appointment = employee.status === HrEmployeeStatus.ACTIVE
      ? await this.db.hrPrimaryAppointment.findFirst({ where: { employeeId,
        effectiveFrom: { lte: today }, OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }] },
        orderBy: { effectiveFrom: 'desc' }, select: { storeId: true } })
      : await this.db.hrPrimaryAppointment.findFirst({ where: { employeeId },
        orderBy: { effectiveFrom: 'desc' }, select: { storeId: true } });
    const storeId = appointment?.storeId ?? employee.initialStoreId;
    if (storeId == null) throw new ConflictException('Employee store is unavailable');
    await this.access.assertStorePermission(request.user, 'HR_EMPLOYEE_EDIT', storeId);

    const hasName = Object.prototype.hasOwnProperty.call(body, 'displayName');
    const hasPosition = Object.prototype.hasOwnProperty.call(body, 'jobPositionId');
    const hasPhone = Object.prototype.hasOwnProperty.call(body, 'phone');
    const hasAddress = Object.prototype.hasOwnProperty.call(body, 'address');
    if (!hasName && !hasPosition && !hasPhone && !hasAddress)
      throw new BadRequestException('No employee profile fields were supplied');
    if ((hasPhone || hasAddress) && !request.user?.system)
      await this.access.assertStorePermission(request.user, 'HR_EMPLOYEE_SENSITIVE_EDIT', storeId);
    const displayName = hasName ? typeof body.displayName === 'string' ? body.displayName.trim() : '' : employee.displayName;
    if (!displayName || displayName.length > 100) throw new BadRequestException('A valid employee name is required');
    const jobPositionId = !hasPosition || body.jobPositionId == null || body.jobPositionId === ''
      ? hasPosition ? null : employee.jobPositionId : positiveId(body.jobPositionId);
    const phone = hasPhone ? normalizeEmployeePhone(body.phone) : undefined;
    if (hasAddress && (typeof body.address !== 'string' || body.address.length > 300))
      throw new BadRequestException('Address is invalid');
    const address = hasAddress ? (body.address as string).trim() : undefined;
    if (jobPositionId != null) {
      const position = await this.db.hrJobPosition.findFirst({ where: { id: jobPositionId,
        stores: { some: { storeId, enabled: true } } }, select: { id: true } });
      if (!position) throw new BadRequestException('Select a position assigned to the employee store');
    }
    const actorId = BigInt(request.user!.id!);
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    try {
      const updated = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
        const current = await tx.hrEmployee.findUnique({ where: { id: employeeId },
          select: { id: true, displayName: true, status: true, userId: true, jobPositionId: true } });
        if (!current || current.status !== employee.status)
          throw new ConflictException('Employee profile changed; reload');
        let identityChanged = false;
        let phoneMask: string | null = null;
        if (hasName || hasPhone || hasAddress) {
          const latest = await tx.hrSensitiveDraftRevision.findFirst({ where: {
            employeeId, kind: HrSensitiveDraftKind.IDENTITY,
          }, orderBy: { version: 'desc' } });
          if (latest) {
            const identity = crypto.open(employeeId, 'IDENTITY', latest.sealedPayload as unknown as HrSealedValue);
            if (typeof identity.idNumber !== 'string')
              throw new ConflictException('Identity record is incomplete and cannot be edited');
            const nextIdentity = { ...identity, name: displayName,
              ...(hasPhone ? { phone } : {}), ...(hasAddress ? { address } : {}) };
            const nextPhone = typeof nextIdentity.phone === 'string' ? nextIdentity.phone : null;
            if (hasPhone && nextPhone && current.userId != null) {
              const duplicate = await tx.user.findFirst({ where: { mobile: nextPhone,
                id: { not: BigInt(current.userId) } }, select: { id: true } });
              if (duplicate) throw new ConflictException('This phone number is already used by another account');
            }
            const version = latest.version + 1;
            await tx.hrSensitiveDraftRevision.create({ data: { employeeId, kind: HrSensitiveDraftKind.IDENTITY,
              version, sealedPayload: crypto.seal(employeeId, 'IDENTITY', nextIdentity) as unknown as Prisma.InputJsonValue,
              maskedValue: latest.maskedValue, source: 'MANUAL', createdBy: actorId } });
            await tx.hrIdentityClaim.upsert({ where: { employeeId },
              create: { employeeId, fingerprint: crypto.identityFingerprint(identity.idNumber), version },
              update: { fingerprint: crypto.identityFingerprint(identity.idNumber), version } });
            if (current.userId != null && (hasName || hasPhone)) await tx.user.update({
              where: { id: BigInt(current.userId) }, data: {
                ...(hasName ? { name: displayName } : {}), ...(hasPhone ? { mobile: nextPhone } : {}),
              },
            });
            identityChanged = true;
            phoneMask = nextPhone ? `${nextPhone.slice(0, 3)}****${nextPhone.slice(-4)}` : null;
          } else if (hasPhone || hasAddress) {
            throw new ConflictException('Employee identity information is unavailable');
          }
        }
        const result = await tx.hrEmployee.update({ where: { id: employeeId }, data: {
          displayName, ...(hasPosition ? { jobPositionId } : {}),
        }, include: { jobPosition: { select: { id: true, name: true } } } });
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_EMPLOYEE',
          entityId: employeeId, action: 'UPDATE_PROFILE', afterData: {
            displayName, jobPositionId: result.jobPositionId == null ? null : String(result.jobPositionId),
            identityChanged, phoneMask,
          } } });
        return result;
      });
      return { id: Number(updated.id), displayName: updated.displayName,
        jobPosition: updated.jobPosition ? { id: Number(updated.jobPosition.id), name: updated.jobPosition.name } : null };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Phone number or identity is already linked to another account');
      throw error;
    }
  }

  @Post(':employeeId/link-account') async linkAccount(@Req() request: RequestWithUser,
    @Param('employeeId', ParseIntPipe) employeeIdValue: number, @Body() body: { userId?: unknown }) {
    const employeeId = positiveId(employeeIdValue);
    const employee = await this.db.hrEmployee.findUnique({ where: { id: employeeId }, select: {
      id: true, displayName: true, status: true, userId: true, initialStoreId: true,
    } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status === HrEmployeeStatus.DRAFT)
      throw new ConflictException('Pending onboarding records must be linked from the onboarding workflow');
    const appointment = await this.db.hrPrimaryAppointment.findFirst({ where: { employeeId },
      orderBy: { effectiveFrom: 'desc' }, select: { storeId: true } });
    const storeId = appointment?.storeId ?? employee.initialStoreId;
    if (storeId == null) throw new ConflictException('Employee store is unavailable');
    await this.access.assertStorePermission(request.user, 'HR_EMPLOYEE_ACCOUNT_LINK', storeId);
    const userId = body?.userId == null || body.userId === '' ? null : positiveId(body.userId);
    const actorId = BigInt(request.user!.id!);
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
        const current = await tx.hrEmployee.findUnique({ where: { id: employeeId }, select: {
          id: true, displayName: true, status: true, userId: true,
        } });
        if (!current || current.status !== employee.status)
          throw new ConflictException('Employee record changed; reload and retry');
        if (userId === current.userId) return { employeeId: Number(employeeId), userId: userId == null ? null : Number(userId), unchanged: true };
        if (userId != null) {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
          const account = await tx.user.findUnique({ where: { id: userId }, include: { stores: true } });
          if (!account?.status) throw new ConflictException('The selected account is unavailable');
          if (!account.stores.some((item) => item.storeId === storeId))
            throw new ConflictException('The selected account is not assigned to the employee store');
          const linkedEmployee = await tx.hrEmployee.findUnique({ where: { userId }, select: { id: true } });
          if (linkedEmployee && linkedEmployee.id !== employeeId)
            throw new ConflictException('This account is already linked to another employee');

          const identityRevision = await tx.hrSensitiveDraftRevision.findFirst({ where: {
            employeeId, kind: HrSensitiveDraftKind.IDENTITY,
          }, orderBy: { version: 'desc' }, select: { sealedPayload: true } });
          if (identityRevision && account.mobile) {
            const crypto = loadHrSensitiveCryptoFromEnv(process.env);
            const identity = crypto.open(employeeId, 'IDENTITY', identityRevision.sealedPayload as unknown as HrSealedValue);
            if (typeof identity.phone === 'string' && normalizeEmployeePhone(identity.phone) !== account.mobile)
              throw new ConflictException('The account phone number does not match the employee file');
          }
        }
        await tx.hrEmployee.update({ where: { id: employeeId }, data: { userId } });
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_EMPLOYEE', entityId: employeeId,
          action: userId == null ? 'UNLINK_ACCOUNT' : 'LINK_ACCOUNT',
          beforeData: { userId: current.userId == null ? null : String(current.userId) },
          afterData: { userId: userId == null ? null : String(userId),
            accountRoleAndStoreScopeChanged: false } } });
        return { employeeId: Number(employeeId), userId: userId == null ? null : Number(userId), unchanged: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('This account is already linked to another employee');
      throw error;
    }
  }

  @Get('me/work') async myWork(@Req() request: RequestWithUser, @Query('month') monthInput: string) {
    await this.access.currentAccess(request.user);
    if (typeof monthInput !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput))
      throw new BadRequestException('Month must be YYYY-MM');
    const start = new Date(`${monthInput}-01T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 7) !== monthInput)
      throw new BadRequestException('Invalid month');
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const employee = await this.db.hrEmployee.findUnique({
      where: { userId: BigInt(request.user!.id!) }, select: { id: true,
        jobPosition: { select: { scheduleOnly: true } } },
    });
    if (!employee) return { month: monthInput, days: [], totalScheduledMinutes: 0,
      totalStatisticalMinutes: 0, totalBasePayAmount: null, payStatus: 'WAITING_FOR_CONFIRMATION' as const };
    if (employee.jobPosition?.scheduleOnly) return { month: monthInput, days: [], totalScheduledMinutes: 0,
      totalStatisticalMinutes: 0, totalBasePayAmount: null, payStatus: 'WAITING_FOR_CONFIRMATION' as const };
    const [records, schedules] = await Promise.all([this.db.hrWorkRecord.findMany({
      where: { employeeId: employee.id, versions: { some: { daySegments: { some: {
        businessDate: { gte: start, lt: end },
      } } } } },
      include: { versions: { include: { daySegments: { where: {
        businessDate: { gte: start, lt: end },
      } } } } },
    }), this.db.hrSchedule.findMany({ where: { employeeId: employee.id, status: 'PUBLISHED',
      businessDate: { gte: start, lt: end } }, include: { versions: true } })]);
    const byDay = new Map<string, number[]>();
    for (const record of records) {
      const current = record.versions.find((item) => item.version === record.currentVersion);
      for (const part of current?.daySegments ?? []) {
        const date = part.businessDate.toISOString().slice(0, 10);
        byDay.set(date, [...(byDay.get(date) ?? []), part.rawMinutes]);
      }
    }
    const scheduledByDay = new Map<string, number>();
    for (const schedule of schedules) {
      const version = schedule.versions.find((item) => item.version === schedule.currentVersion);
      if (!version) continue;
      const date = schedule.businessDate.toISOString().slice(0, 10);
      const minutes = Math.max(0, Math.floor((version.plannedEnd.getTime() - version.plannedStart.getTime()) / 60000)
        - version.breakMinutes);
      scheduledByDay.set(date, (scheduledByDay.get(date) ?? 0) + minutes);
    }
    const dates = new Set([...byDay.keys(), ...scheduledByDay.keys()]);
    const workDays = [...dates].sort().map((date) => ({ date,
      scheduledMinutes: scheduledByDay.get(date) ?? 0,
      statisticalMinutes: calculateDailyWorkTime((byDay.get(date) ?? []).map((rawMinutes) => ({ rawMinutes }))).statisticalMinutes,
      confirmedShifts: byDay.get(date)?.length ?? 0,
    }));
    const salaryRates = workDays.some((day) => day.confirmedShifts > 0)
      ? await this.db.hrSalaryRate.findMany({ where: { employeeId: employee.id, effectiveFrom: { lt: end },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: start } }], } }) : [];
    const paid = calculateConfirmedWorkPay(workDays, salaryRates);
    return { month: monthInput, days: paid.days,
      totalScheduledMinutes: paid.days.reduce((sum, day) => sum + day.scheduledMinutes, 0),
      totalStatisticalMinutes: paid.days.reduce((sum, day) => sum + day.statisticalMinutes, 0),
      totalBasePayAmount: paid.totalBasePayAmount, payStatus: paid.payStatus };
  }

  @Get() async list(@Req() request: RequestWithUser, @Query('storeId') storeIdInput?: string,
    @Query('status') statusInput?: string, @Query('q') searchInput?: string) {
    const access = await this.access.currentAccess(request.user);
    const permittedStores = access.stores.filter((store) => store.permissionCodes.includes('HR_EMPLOYEE_LIST_READ'));
    const storeId = storeIdInput ? Number(storeIdInput) : null;
    if (storeIdInput && (!Number.isSafeInteger(storeId) || storeId! <= 0))
      throw new BadRequestException('Invalid store id');
    if (storeId != null && !permittedStores.some((store) => store.id === storeId))
      throw new ConflictException('HR access denied');
    const storeIds = (storeId == null ? permittedStores.map((store) => store.id) : [storeId]).map(BigInt);
    if (!storeIds.length) return [];
    const allowedStatuses = Object.values(HrEmployeeStatus);
    if (statusInput && statusInput !== 'ALL' && !allowedStatuses.includes(statusInput as HrEmployeeStatus))
      throw new BadRequestException('Invalid employee status');
    const search = typeof searchInput === 'string' ? searchInput.trim().slice(0, 100) : '';
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })
      .format(new Date()) + 'T00:00:00.000Z');
    const employees = await this.db.hrEmployee.findMany({
      where: { OR: [
        { status: HrEmployeeStatus.DRAFT, initialStoreId: { in: storeIds } },
        { status: HrEmployeeStatus.ACTIVE, primaryAppointments: { some: {
          storeId: { in: storeIds }, effectiveFrom: { lte: today },
          OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }],
        } } },
        // Terminated employees remain discoverable from their historical store;
        // active employees belong only to the store of their current appointment.
        { status: HrEmployeeStatus.TERMINATED, primaryAppointments: { some: { storeId: { in: storeIds } } } },
      ], ...(statusInput && statusInput !== 'ALL' ? { status: statusInput as HrEmployeeStatus } : {}),
        ...(search ? { displayName: { contains: search } } : {}) },
       include: { jobPosition: { select: { id: true, name: true, scheduleOnly: true } },
         primaryAppointments: { where: { storeId: { in: storeIds } }, orderBy: { effectiveFrom: 'desc' },
        include: { store: { select: { storeName: true } } } },
        onboardingRequests: { orderBy: { revision: 'desc' }, take: 1,
          select: { id: true, status: true, failureCode: true } } },
      orderBy: { id: 'desc' },
    });
    const onboardingRequestIds = employees.flatMap((employee) =>
      employee.onboardingRequests.map((request) => request.id));
    const approvalInstances = onboardingRequestIds.length ? await this.db.hrApprovalInstance.findMany({
      where: { kind: HrApprovalKind.ONBOARDING, subjectId: { in: onboardingRequestIds } },
      select: { subjectId: true, status: true },
    }) : [];
    const approvalStatusByRequest = new Map(approvalInstances.map((instance) =>
      [instance.subjectId.toString(), instance.status]));
    return employees.map((employee) => ({
      id: Number(employee.id), displayName: employee.displayName, status: employee.status,
      userId: employee.userId == null ? null : Number(employee.userId),
      jobPositionId: employee.jobPosition == null ? null : Number(employee.jobPosition.id),
      jobPositionName: employee.jobPosition?.name ?? null,
      jobPositionScheduleOnly: employee.jobPosition?.scheduleOnly ?? false,
      initialStoreId: employee.initialStoreId == null ? null : Number(employee.initialStoreId),
      onboardingStatus: employee.onboardingRequests[0]?.status ?? null,
      onboardingFailureCode: employee.onboardingRequests[0]?.failureCode ?? null,
      onboardingApprovalStatus: employee.onboardingRequests[0]
        ? approvalStatusByRequest.get(employee.onboardingRequests[0].id.toString()) ?? null : null,
      appointments: employee.primaryAppointments.map((item) => ({
        storeId: Number(item.storeId), storeName: item.store.storeName,
        effectiveFrom: item.effectiveFrom.toISOString().slice(0, 10),
        effectiveToExclusive: item.effectiveToExclusive?.toISOString().slice(0, 10) ?? null,
      })),
    }));
  }

  @Roles(UserRole.ADMIN)
  @Delete(':employeeId/permanent')
  async permanentlyDelete(@Req() request: RequestWithUser,
    @Param('employeeId', ParseIntPipe) employeeIdValue: number,
    @Body() body: Record<string, unknown>) {
    return this.deleteEmployeeData(request, employeeIdValue, body);
  }

  @Delete(':employeeId/trial')
  async endTrial(@Req() request: RequestWithUser,
    @Param('employeeId', ParseIntPipe) employeeIdValue: number) {
    const employeeId = positiveId(employeeIdValue);
    const actorId = BigInt(request.user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
      const employee = await tx.hrEmployee.findUnique({ where: { id: employeeId },
        select: { id: true, status: true, userId: true, initialStoreId: true, trialStartedAt: true } });
      if (!employee || employee.status !== HrEmployeeStatus.TRIAL || employee.initialStoreId == null)
        throw new ConflictException('该记录已转入职或已结束试岗，无法再次结束');
      await this.access.assertStorePermission(request.user, 'HR_TRIAL_MANAGE', employee.initialStoreId);
      if (employee.userId != null) throw new ConflictException('试岗人员已关联账号，请先核查人员状态');
      const endedAt = new Date();
      await tx.hrEmployee.update({ where: { id: employeeId }, data: {
        status: HrEmployeeStatus.TRIAL_ENDED, trialEndedAt: endedAt,
      } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_EMPLOYEE',
        entityId: employeeId, action: 'TRIAL_ENDED', reason: '结束试岗',
        beforeData: { status: employee.status, initialStoreId: String(employee.initialStoreId),
          trialStartedAt: employee.trialStartedAt?.toISOString().slice(0, 10) ?? null },
        afterData: { status: HrEmployeeStatus.TRIAL_ENDED, trialEndedAt: endedAt.toISOString(),
          historyRetained: true } } });
      return { ended: true, id: Number(employeeId), status: HrEmployeeStatus.TRIAL_ENDED,
        trialEndedAt: endedAt.toISOString(), historyRetained: true };
    }, { isolationLevel: 'Serializable' });
  }

  private async deleteEmployeeData(request: RequestWithUser, employeeIdValue: number,
    body: Record<string, unknown>) {
    const employeeId = positiveId(employeeIdValue);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (reason.length < 5) throw new BadRequestException('删除原因至少填写 5 个字');
    const deleteAccount = body.deleteAccount === undefined ? true : body.deleteAccount;
    if (typeof deleteAccount !== 'boolean') throw new BadRequestException('账号删除选项无效');
    const actorId = BigInt(request.user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
      const employee = await tx.hrEmployee.findUnique({ where: { id: employeeId },
        select: { id: true, status: true, userId: true, initialStoreId: true } });
      if (!employee) throw new ConflictException('员工记录不存在或已删除');
      if (request.user?.role !== UserRole.ADMIN && request.user?.system !== true)
        throw new ForbiddenException('Administrator is required');
      if (employee.status === HrEmployeeStatus.TRIAL)
        throw new ConflictException('试岗人员请使用“结束试岗”操作');
      if (deleteAccount && employee.userId === actorId)
        throw new ForbiddenException('不能在删除员工时同时删除当前登录账号，请取消删除账号选项');

      const [schedules, records, onboarding, offboarding, salaryChanges, bankChanges, transfers, corrections,
        appointments, bankVersions, sensitiveRevisions, scheduleDeliveries] = await Promise.all([
        tx.hrSchedule.findMany({ where: { employeeId }, select: { id: true, storeId: true } }),
        tx.hrWorkRecord.findMany({ where: { employeeId }, select: { id: true, storeId: true } }),
        tx.hrOnboardingRequest.findMany({ where: { employeeId }, select: { id: true, storeId: true } }),
        tx.hrOffboardingRequest.findMany({ where: { employeeId }, select: { id: true, storeId: true } }),
        tx.hrSalaryChangeRequest.findMany({ where: { employeeId }, select: { id: true, storeId: true } }),
        tx.hrBankChangeRequest.findMany({ where: { employeeId }, select: { id: true, storeId: true } }),
        tx.hrTransferRequest.findMany({ where: { employeeId }, select: { id: true, fromStoreId: true, toStoreId: true } }),
        tx.hrTimeCorrection.findMany({ where: { record: { employeeId } }, select: { id: true } }),
        tx.hrPrimaryAppointment.findMany({ where: { employeeId }, select: { id: true, storeId: true } }),
        tx.hrBankAccountVersion.findMany({ where: { employeeId }, select: { id: true, sourceRevisionId: true } }),
        tx.hrSensitiveDraftRevision.findMany({ where: { employeeId }, select: { id: true } }),
        tx.hrScheduleDelivery.findMany({ where: { schedule: { employeeId } }, select: { id: true } }),
      ]);
      const ids = (rows: { id: bigint }[]) => rows.map((row) => row.id);
      const approvalKeys = [
        ...onboarding.map((row) => ({ kind: HrApprovalKind.ONBOARDING, subjectId: row.id })),
        ...offboarding.map((row) => ({ kind: HrApprovalKind.OFFBOARDING, subjectId: row.id })),
        ...salaryChanges.map((row) => ({ kind: HrApprovalKind.SALARY_CHANGE, subjectId: row.id })),
        ...bankChanges.map((row) => ({ kind: HrApprovalKind.BANK_CHANGE, subjectId: row.id })),
        ...corrections.map((row) => ({ kind: HrApprovalKind.TIME_CORRECTION, subjectId: row.id })),
      ];
      const instances = approvalKeys.length ? await tx.hrApprovalInstance.findMany({
        where: { OR: approvalKeys }, select: { id: true },
      }) : [];
      const instanceIds = ids(instances);
      if (instanceIds.length) {
        await tx.hrApprovalNotification.deleteMany({ where: { subject: 'APPROVAL', subjectId: { in: instanceIds } } });
        await tx.hrApprovalInstanceStep.deleteMany({ where: { instanceId: { in: instanceIds } } });
        await tx.hrApprovalInstance.deleteMany({ where: { id: { in: instanceIds } } });
      }
      const scheduleIds = ids(schedules), recordIds = ids(records), transferIds = ids(transfers);
      const entityAuditIds = [...ids(onboarding), ...ids(offboarding), ...ids(salaryChanges), ...ids(bankChanges), ...ids(corrections)];
      // Monthly reviews are frozen JSON snapshots. Remove the employee's rows and
      // invalidate/re-hash affected snapshots before deleting their source records.
      const employeeStoreIds = [...new Set([
        ...(employee.initialStoreId == null ? [] : [employee.initialStoreId]),
        ...schedules.map((row) => row.storeId), ...records.map((row) => row.storeId),
        ...onboarding.map((row) => row.storeId), ...offboarding.map((row) => row.storeId),
        ...salaryChanges.map((row) => row.storeId), ...bankChanges.map((row) => row.storeId),
        ...transfers.flatMap((row) => [row.fromStoreId, row.toStoreId]),
        ...appointments.map((row) => row.storeId),
      ])];
      const monthlyReviews = employeeStoreIds.length ? await tx.hrMonthlyReview.findMany({
        where: { storeId: { in: employeeStoreIds } }, select: { id: true, snapshot: true },
      }) : [];
      let scrubbedMonthlyReviews = 0;
      for (const review of monthlyReviews) {
        const snapshot = asObject(review.snapshot);
        if (!snapshot || !Array.isArray(snapshot.rows)) continue;
        const rows = snapshot.rows.filter((value) => asObject(value)?.employeeId !== Number(employeeId));
        if (rows.length === snapshot.rows.length) continue;
        const unresolvedDays = Array.isArray(snapshot.unresolvedCrossStoreDays)
          ? snapshot.unresolvedCrossStoreDays.filter((value) => asObject(value)?.employeeId !== Number(employeeId)) : [];
        const cleaned: Record<string, unknown> = {
          ...snapshot,
          rows,
          unresolvedCrossStoreDays: unresolvedDays,
          totalRawMinutes: rows.reduce((sum, value) => sum + (Number(asObject(value)?.storeRawMinutes) || 0), 0),
          totalStatisticalMinutes: unresolvedDays.length || rows.some((value) =>
            typeof asObject(value)?.statisticalMinutes !== 'number') ? null :
            rows.reduce((sum, value) => sum + Number(asObject(value)?.statisticalMinutes), 0),
        };
        for (const key of ['corrections', 'salarySegments'] as const) {
          if (Array.isArray(cleaned[key])) cleaned[key] = (cleaned[key] as unknown[])
            .filter((value) => asObject(value)?.employeeId !== Number(employeeId));
        }
        if (Object.prototype.hasOwnProperty.call(snapshot, 'totalBasePayAmount')) {
          const cents = rows.map((value) => decimalCents(asObject(value)?.basePayAmount));
          const totalCents = cents.some((value) => value == null) ? null :
            cents.reduce<bigint>((sum, value) => sum + value!, 0n);
          cleaned.totalBasePayAmount = totalCents == null ? null :
            `${totalCents / 100n}.${String(totalCents % 100n).padStart(2, '0')}`;
        }
        await tx.hrMonthlyReview.update({ where: { id: review.id }, data: {
          snapshot: cleaned as unknown as Prisma.InputJsonValue,
          snapshotHash: snapshotHash(cleaned), invalidatedAt: new Date(),
          invalidationReason: 'EMPLOYEE_PERMANENTLY_DELETED',
        } });
        scrubbedMonthlyReviews += 1;
      }
      if (transferIds.length)
        await tx.hrApprovalNotification.deleteMany({ where: { subject: 'TRANSFER', subjectId: { in: transferIds } } });
      if (transferIds.length) await tx.hrTransferDecision.deleteMany({ where: { transferId: { in: transferIds } } });
      if (scheduleIds.length) {
        await tx.hrScheduleDelivery.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
      }
      if (recordIds.length) {
        await tx.hrTimeCorrection.deleteMany({ where: { recordId: { in: recordIds } } });
        await tx.hrWorkDaySegment.deleteMany({ where: { recordId: { in: recordIds } } });
        await tx.hrWorkRecordVersion.deleteMany({ where: { recordId: { in: recordIds } } });
        await tx.hrWorkRecord.deleteMany({ where: { id: { in: recordIds } } });
      }
      if (scheduleIds.length) {
        await tx.hrScheduleVersion.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
        await tx.hrSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
      }
      await tx.hrTransferRequest.deleteMany({ where: { id: { in: transferIds } } });
      await tx.hrBankAccountVersion.deleteMany({ where: { employeeId } });
      await tx.hrSalaryRate.deleteMany({ where: { employeeId } });
      await tx.hrBankChangeRequest.deleteMany({ where: { employeeId } });
      await tx.hrOnboardingRequest.deleteMany({ where: { employeeId } });
      await tx.hrOffboardingRequest.deleteMany({ where: { employeeId } });
      await tx.hrSalaryChangeRequest.deleteMany({ where: { employeeId } });
      await tx.hrPrimaryAppointment.deleteMany({ where: { employeeId } });
      await tx.hrIdentityClaim.deleteMany({ where: { employeeId } });
      await tx.hrSensitiveDraftRevision.deleteMany({ where: { employeeId } });
      const accountDeleted = deleteAccount && employee.userId != null
        ? await deleteHrLinkedAccount(tx, employee.userId) : false;
      await tx.auditLog.deleteMany({ where: { OR: [
        { entityType: 'HR_EMPLOYEE', entityId: employeeId },
        { entityType: 'HR_SENSITIVE_DRAFT', entityId: employeeId },
        ...(scheduleIds.length ? [{ entityType: 'HR_SCHEDULE', entityId: { in: scheduleIds } }] : []),
        ...(ids(scheduleDeliveries).length ? [{ entityType: 'HR_SCHEDULE_DELIVERY', entityId: { in: ids(scheduleDeliveries) } }] : []),
        ...(recordIds.length ? [{ entityType: 'HR_WORK_RECORD', entityId: { in: recordIds } }] : []),
        ...(transferIds.length ? [{ entityType: 'HR_TRANSFER', entityId: { in: transferIds } }] : []),
        ...(instanceIds.length ? [{ entityType: 'HR_APPROVAL', entityId: { in: instanceIds } }] : []),
        ...(ids(sensitiveRevisions).length ? [{ entityType: { in: ['HR_IDENTITY_DRAFT', 'HR_BANK_DRAFT'] }, entityId: { in: ids(sensitiveRevisions) } }] : []),
        ...(entityAuditIds.length ? [{ entityType: { in: ['HR_ONBOARDING', 'HR_OFFBOARDING', 'HR_SALARY_CHANGE', 'HR_BANK_CHANGE', 'HR_TIME_CORRECTION'] }, entityId: { in: entityAuditIds } }] : []),
      ] } });
      await tx.hrEmployee.delete({ where: { id: employeeId } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_EMPLOYEE_PURGED',
        entityId: employeeId, action: 'PERMANENT_DELETE', reason,
        beforeData: { status: employee.status, hasLinkedAccount: employee.userId != null,
          deleteAccountRequested: deleteAccount, accountDeleted,
          initialStoreId: employee.initialStoreId == null ? null : String(employee.initialStoreId) },
        afterData: { deleted: true, related: { schedules: scheduleIds.length, workRecords: recordIds.length,
          approvals: approvalKeys.length, appointments: appointments.length, bankVersions: bankVersions.length,
          sensitiveRevisions: sensitiveRevisions.length, monthlyReviews: scrubbedMonthlyReviews } } } });
      return { deleted: true, id: Number(employeeId), accountDeleted };
    }, { isolationLevel: 'Serializable' });
  }

}
