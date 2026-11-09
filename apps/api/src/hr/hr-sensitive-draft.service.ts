import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HrEmployeeStatus, HrOnboardingStatus, HrSensitiveDraftKind, Prisma } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrSensitiveCrypto, loadHrSensitiveCryptoFromEnv, maskBankCard } from './hr-sensitive-crypto';

export type IdentityInput = { name: string; idNumber: string; phone?: string; sex?: string; ethnicity?: string;
  birthDate?: string; address?: string; issueAuthority?: string; validPeriod?: string };
export type BankInput = { accountName: string; cardNumber: string; bankName: string; branchName?: string };

function requiredText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit)
    throw new BadRequestException(`${field} is invalid`);
  return value.trim();
}

function optionalText(value: unknown, field: string, limit: number): string | undefined {
  if (value == null || value === '') return undefined;
  return requiredText(value, field, limit);
}

export function normalizeEmployeePhone(value: unknown): string {
  const supplied = requiredText(value, 'phone', 30).replace(/[\s()-]/g, '');
  const normalized = supplied.replace(/^\+?86(?=1\d{10}$)/, '');
  if (!/^1\d{10}$/.test(normalized)) throw new BadRequestException('phone is invalid');
  return normalized;
}

function identityNumber(value: unknown): string {
  const number = requiredText(value, 'idNumber', 18).toUpperCase();
  if (!/^\d{17}[\dX]$/.test(number)) throw new BadRequestException('idNumber is invalid');
  const birth = number.slice(6, 14);
  const date = new Date(`${birth.slice(0, 4)}-${birth.slice(4, 6)}-${birth.slice(6, 8)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10).replaceAll('-', '') !== birth)
    throw new BadRequestException('idNumber is invalid');
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = '10X98765432';
  const remainder = [...number.slice(0, 17)].reduce((sum, digit, i) => sum + Number(digit) * weights[i], 0) % 11;
  if (checks[remainder] !== number[17]) throw new BadRequestException('idNumber is invalid');
  return number;
}

export function parseIdentityInput(body: Record<string, unknown>): IdentityInput {
  const phone = body.phone == null || body.phone === '' ? undefined : normalizeEmployeePhone(body.phone);
  return {
    name: requiredText(body.name, 'name', 100), idNumber: identityNumber(body.idNumber),
    ...(phone ? { phone } : {}),
    sex: optionalText(body.sex, 'sex', 10), ethnicity: optionalText(body.ethnicity, 'ethnicity', 30),
    birthDate: optionalText(body.birthDate, 'birthDate', 30), address: optionalText(body.address, 'address', 300),
    issueAuthority: optionalText(body.issueAuthority, 'issueAuthority', 100),
    validPeriod: optionalText(body.validPeriod, 'validPeriod', 100),
  };
}

export function parseBankInput(body: Record<string, unknown>): BankInput {
  const cardNumber = requiredText(body.cardNumber, 'cardNumber', 40).replace(/\s/g, '');
  maskBankCard(cardNumber);
  return { accountName: requiredText(body.accountName, 'accountName', 100), cardNumber,
    bankName: requiredText(body.bankName, 'bankName', 100), branchName: optionalText(body.branchName, 'branchName', 150) };
}

@Injectable()
export class HrSensitiveDraftService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  private crypto(): HrSensitiveCrypto {
    if (process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR sensitive intake is not enabled');
    return loadHrSensitiveCryptoFromEnv(process.env);
  }

  private async scopedDraft(employeeId: bigint, user: AuthContext | undefined) {
    const employee = await this.db.hrEmployee.findUnique({ where: { id: employeeId },
      select: { status: true, initialStoreId: true, displayName: true } });
    if (!employee || employee.status !== HrEmployeeStatus.DRAFT || employee.initialStoreId == null)
      throw new ConflictException('Only a scoped employee draft accepts sensitive input');
    await this.access.assertStorePermission(user, 'HR_ONBOARDING_CREATE', employee.initialStoreId);
    await this.access.assertStorePermission(user, 'HR_EMPLOYEE_SENSITIVE_EDIT', employee.initialStoreId);
    return employee;
  }

  async masked(employeeId: bigint, user: AuthContext | undefined) {
    this.crypto();
    await this.scopedDraft(employeeId, user);
    const revisions = await Promise.all([HrSensitiveDraftKind.IDENTITY, HrSensitiveDraftKind.BANK].map((kind) =>
      this.db.hrSensitiveDraftRevision.findFirst({ where: { employeeId, kind },
        orderBy: { version: 'desc' }, select: { kind: true, version: true, maskedValue: true, createdAt: true } })));
    await this.db.auditLog.create({ data: { userId: BigInt(user!.id!),
      entityType: 'HR_SENSITIVE_DRAFT', entityId: employeeId, action: 'VIEW_MASKED',
      afterData: { versions: revisions.filter((item) => item != null).map((item) => ({
        kind: item.kind, version: item.version,
      })) } } });
    return revisions.filter((item) => item != null).map((item) => ({ kind: item.kind, version: item.version,
      maskedValue: item.maskedValue, updatedAt: item.createdAt }));
  }

  async saveIdentity(employeeId: bigint, user: AuthContext | undefined, body: Record<string, unknown>) {
    const crypto = this.crypto();
    const employee = await this.scopedDraft(employeeId, user);
    const value = parseIdentityInput(body);
    if (value.name !== employee.displayName) throw new ConflictException('Identity name must match employee draft');
    const fingerprint = crypto.identityFingerprint(value.idNumber);
    const actorId = BigInt(user!.id!);
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
        const current = await tx.hrEmployee.findUnique({ where: { id: employeeId },
          select: { status: true, initialStoreId: true, displayName: true } });
        if (!current || current.status !== HrEmployeeStatus.DRAFT ||
          current.initialStoreId !== employee.initialStoreId || current.displayName !== value.name)
          throw new ConflictException('Employee draft changed; reload');
        if (await tx.hrOnboardingRequest.findFirst({ where: { employeeId, status: { in: [
          HrOnboardingStatus.SUBMITTED, HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE,
        ] } }, select: { id: true } }))
          throw new ConflictException('Onboarding approval has locked the sensitive drafts');
        const previous = await tx.hrSensitiveDraftRevision.findFirst({
          where: { employeeId, kind: HrSensitiveDraftKind.IDENTITY }, orderBy: { version: 'desc' }, select: { version: true },
        });
        const version = (previous?.version ?? 0) + 1;
        await tx.hrIdentityClaim.upsert({ where: { employeeId },
          create: { employeeId, fingerprint, version }, update: { fingerprint, version } });
        const revision = await tx.hrSensitiveDraftRevision.create({ data: {
          employeeId, kind: HrSensitiveDraftKind.IDENTITY, version,
          sealedPayload: crypto.seal(employeeId, 'IDENTITY', value) as unknown as Prisma.InputJsonValue,
          maskedValue: `${'*'.repeat(14)}${value.idNumber.slice(-4)}`,
          source: 'MANUAL', createdBy: actorId,
        } });
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_IDENTITY_DRAFT',
          entityId: revision.id, action: 'SAVE_VERSION', afterData: { employeeId: String(employeeId), version } } });
        return { kind: 'IDENTITY', version, maskedValue: revision.maskedValue };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Identity number is already linked to another employee');
      throw error;
    }
  }

  async saveBank(employeeId: bigint, user: AuthContext | undefined, body: Record<string, unknown>) {
    const crypto = this.crypto();
    const employee = await this.scopedDraft(employeeId, user);
    const value = parseBankInput(body);
    if (value.accountName !== employee.displayName) throw new ConflictException('Bank account name must match employee draft');
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
      const current = await tx.hrEmployee.findUnique({ where: { id: employeeId },
        select: { status: true, initialStoreId: true, displayName: true } });
      if (!current || current.status !== HrEmployeeStatus.DRAFT ||
        current.initialStoreId !== employee.initialStoreId || current.displayName !== value.accountName)
        throw new ConflictException('Employee draft changed; reload');
      if (await tx.hrOnboardingRequest.findFirst({ where: { employeeId, status: { in: [
        HrOnboardingStatus.SUBMITTED, HrOnboardingStatus.APPROVED_AWAITING_EFFECTIVE,
      ] } }, select: { id: true } }))
        throw new ConflictException('Onboarding approval has locked the sensitive drafts');
      const previous = await tx.hrSensitiveDraftRevision.findFirst({
        where: { employeeId, kind: HrSensitiveDraftKind.BANK }, orderBy: { version: 'desc' }, select: { version: true },
      });
      const version = (previous?.version ?? 0) + 1;
      const revision = await tx.hrSensitiveDraftRevision.create({ data: {
        employeeId, kind: HrSensitiveDraftKind.BANK, version,
        sealedPayload: crypto.seal(employeeId, 'BANK', value) as unknown as Prisma.InputJsonValue,
        maskedValue: maskBankCard(value.cardNumber), source: 'MANUAL', createdBy: actorId,
      } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_BANK_DRAFT',
        entityId: revision.id, action: 'SAVE_VERSION', afterData: { employeeId: String(employeeId), version } } });
      return { kind: 'BANK', version, maskedValue: revision.maskedValue };
    });
  }
}
