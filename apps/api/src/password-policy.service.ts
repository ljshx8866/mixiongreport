import { BadRequestException, Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from './prisma.service';

const SETTING_KEY = 'password-policy';
const INITIAL_PASSWORD = '66666666';

export type PasswordPolicy = { enabled: boolean; defaultPasswordHash: string };

@Injectable()
export class PasswordPolicyService {
  constructor(private readonly db: PrismaService) {}

  private parse(value: unknown): PasswordPolicy {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { enabled: false, defaultPasswordHash: '' };
    const data = value as Record<string, unknown>;
    return {
      enabled: data.enabled === true,
      defaultPasswordHash: typeof data.defaultPasswordHash === 'string' ? data.defaultPasswordHash : '',
    };
  }

  private async createDefault(): Promise<PasswordPolicy> {
    const policy: PasswordPolicy = { enabled: true, defaultPasswordHash: await hash(INITIAL_PASSWORD, 12) };
    try {
      await this.db.systemSetting.create({ data: { key: SETTING_KEY, value: policy } });
      return policy;
    } catch (error) {
      const existing = await this.db.systemSetting.findUnique({ where: { key: SETTING_KEY } });
      if (!existing) throw error;
      return this.parse(existing.value);
    }
  }

  async get(): Promise<PasswordPolicy> {
    const row = await this.db.systemSetting.findUnique({ where: { key: SETTING_KEY } });
    return row ? this.parse(row.value) : this.createDefault();
  }

  async requiresChange(password: string): Promise<boolean> {
    const policy = await this.get();
    return policy.enabled && Boolean(policy.defaultPasswordHash) && await compare(password, policy.defaultPasswordHash);
  }

  async update(enabled: boolean, defaultPassword?: string) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('请设置是否强制修改默认密码');
    const existing = await this.get();
    if (defaultPassword !== undefined && (typeof defaultPassword !== 'string' || defaultPassword.length < 8))
      throw new BadRequestException('默认密码至少需要 8 位');
    const policy: PasswordPolicy = {
      enabled,
      defaultPasswordHash: defaultPassword ? await hash(defaultPassword, 12) : existing.defaultPasswordHash,
    };
    if (enabled && !policy.defaultPasswordHash) throw new BadRequestException('请先设置默认密码');
    await this.db.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: policy },
      update: { value: policy },
    });
    return { enabled: policy.enabled, defaultPasswordConfigured: Boolean(policy.defaultPasswordHash) };
  }
}
