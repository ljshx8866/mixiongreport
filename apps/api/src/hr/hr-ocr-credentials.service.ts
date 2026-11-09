import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { UserRole, Prisma } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { openAliyunOcrCredentials, sealAliyunOcrCredentials, type AliyunOcrCredentials } from './hr-ocr-credential-crypto';

function validCredentials(input: Record<string, unknown>): AliyunOcrCredentials {
  const accessKeyId = typeof input.accessKeyId === 'string' ? input.accessKeyId.trim() : '';
  const accessKeySecret = typeof input.accessKeySecret === 'string' ? input.accessKeySecret.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(accessKeyId) || accessKeySecret.length < 8 ||
      accessKeySecret.length > 256 || /[\u0000-\u001f\u007f]/.test(accessKeySecret))
    throw new BadRequestException('请输入有效的 AccessKey ID 和 AccessKey Secret');
  return { accessKeyId, accessKeySecret };
}

@Injectable()
export class HrOcrCredentialsService {
  constructor(private readonly db: PrismaService) {}

  private async administrator(user: AuthContext | undefined): Promise<bigint> {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database' ||
        user?.system || user?.id == null)
      throw new ForbiddenException('Administrator is required');
    const account = await this.db.user.findUnique({ where: { id: BigInt(user.id) },
      select: { id: true, role: true, status: true } });
    if (!account?.status || account.role !== UserRole.ADMIN)
      throw new ForbiddenException('Administrator is required');
    return account.id;
  }

  private statusValue(row: { enabled: boolean; updatedAt: Date } | null) {
    return { configured: row != null, enabled: row?.enabled ?? false,
      updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  async status(user: AuthContext | undefined) {
    await this.administrator(user);
    const row = await this.db.hrOcrCredential.findUnique({ where: { id: 1 },
      select: { enabled: true, updatedAt: true } });
    return this.statusValue(row);
  }

  async save(user: AuthContext | undefined, input: Record<string, unknown>) {
    const actorId = await this.administrator(user);
    const value = validCredentials(input);
    const credentialCipher = sealAliyunOcrCredentials(value, process.env) as unknown as Prisma.InputJsonValue;
    return this.db.$transaction(async (tx) => {
      const previous = await tx.hrOcrCredential.findUnique({ where: { id: 1 },
        select: { enabled: true } });
      const row = await tx.hrOcrCredential.upsert({
        where: { id: 1 },
        create: { id: 1, credentialCipher, enabled: false, updatedBy: actorId },
        update: { credentialCipher, enabled: false, updatedBy: actorId },
        select: { enabled: true, updatedAt: true },
      });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_OCR_CREDENTIAL',
        entityId: 1n, action: 'REPLACE', beforeData: { enabled: previous?.enabled ?? false },
        afterData: { configured: true, enabled: false } } });
      return this.statusValue(row);
    });
  }

  async setEnabled(user: AuthContext | undefined, enabledInput: unknown) {
    const actorId = await this.administrator(user);
    if (typeof enabledInput !== 'boolean') throw new BadRequestException('enabled must be a boolean');
    return this.db.$transaction(async (tx) => {
      const previous = await tx.hrOcrCredential.findUnique({ where: { id: 1 } });
      if (!previous) throw new ConflictException('请先配置阿里云 OCR AccessKey');
      if (enabledInput) openAliyunOcrCredentials(previous.credentialCipher, process.env);
      const row = await tx.hrOcrCredential.update({ where: { id: 1 },
        data: { enabled: enabledInput, updatedBy: actorId }, select: { enabled: true, updatedAt: true } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_OCR_CREDENTIAL',
        entityId: 1n, action: enabledInput ? 'ENABLE' : 'DISABLE',
        beforeData: { enabled: previous.enabled }, afterData: { enabled: row.enabled } } });
      return this.statusValue(row);
    });
  }

  async runtimeCredentials(): Promise<AliyunOcrCredentials> {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true' ||
        process.env.HR_OCR_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR ID card recognition is not enabled');
    const row = await this.db.hrOcrCredential.findUnique({ where: { id: 1 } });
    if (!row?.enabled) throw new ServiceUnavailableException('HR ID card recognition is not enabled');
    return openAliyunOcrCredentials(row.credentialCipher, process.env);
  }
}
