import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { isTemplateNotificationEnabled, TEMPLATE_NOTIFICATION_KEYS } from '../notification-template-catalog';

type TemplateConfig = { id: string; fields: Record<string, string> };

// Field keys and values come from the dedicated schedule template, not the
// daily-input reminder template. Invalid or absent config keeps sending off.
export function scheduleTemplateConfig(): TemplateConfig | null {
  if (process.env.HR_SCHEDULE_NOTIFY_ENABLED !== 'true') return null;
  const id = process.env.HR_SCHEDULE_TEMPLATE_ID?.trim();
  const raw = process.env.HR_SCHEDULE_TEMPLATE_FIELDS_JSON;
  if (!id || !raw || !process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const fields = parsed as Record<string, unknown>;
    if (!Object.keys(fields).length || Object.keys(fields).length > 10) return null;
    for (const [key, value] of Object.entries(fields)) {
      if (!/^[a-z_]+\d+$/.test(key) || typeof value !== 'string' || !value.trim() || value.length > 80 ||
        /\{[^}]+\}/g.test(value.replace(/\{(?:store|date|start|end|shift)\}/g, ''))) return null;
    }
    return { id, fields: fields as Record<string, string> };
  } catch { return null; }
}

const clock = (value: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(value);
const localDay = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export function scheduleTemplateData(config: TemplateConfig,
  input: { store: string; date: string; shift: string; start: Date; end: Date }) {
  const date = new Date(`${input.date}T12:00:00+08:00`);
  const displayDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  const values = { store: input.store, date: displayDate, shift: input.shift,
    start: clock(input.start), end: clock(input.end) };
  return Object.fromEntries(Object.entries(config.fields).map(([key, pattern]) => {
    const value = pattern.replace(/\{(store|date|start|end|shift)\}/g,
      (_, field: keyof typeof values) => values[field]);
    // WeChat time fields accept a time range with an ASCII tilde only.
    return [key, { value: key.startsWith('time') ? value.replace(/～/g, '~') : value }];
  }));
}

@Injectable()
export class HrScheduleNotificationService {
  private readonly logger = new Logger(HrScheduleNotificationService.name);
  private accessToken?: { value: string; expiresAt: number };
  private dispatching = false;
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  async retry(user: AuthContext | undefined, scheduleIdInput: number) {
    if (!Number.isSafeInteger(scheduleIdInput) || scheduleIdInput <= 0)
      throw new BadRequestException('Invalid schedule id');
    const scheduleId = BigInt(scheduleIdInput);
    const schedule = await this.db.hrSchedule.findUnique({ where: { id: scheduleId },
      include: { employee: { select: { user: { select: { status: true, openid: true } } } },
        deliveries: true } });
    if (!schedule || schedule.status !== 'PUBLISHED') throw new ConflictException('Schedule is not published');
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_PUBLISH', schedule.storeId);
    if (schedule.businessDate.toISOString().slice(0, 10) < localDay())
      throw new ConflictException('Past schedule notification cannot be retried');
    const delivery = schedule.deliveries.find((item) => item.version === schedule.currentVersion);
    if (!delivery || !['FAILED', 'UNAVAILABLE'].includes(delivery.status) || delivery.attempts >= 3)
      throw new ConflictException('Notification cannot be retried');
    if (delivery.status === 'FAILED' && delivery.reasonCode !== 'RECIPIENT_NOT_BOUND' &&
      !/^WECHAT_\d+$/.test(delivery.reasonCode ?? ''))
      throw new ConflictException('Delivery receipt is uncertain; manual reconciliation is required');
    if (!scheduleTemplateConfig()) throw new ConflictException('Schedule notification template is not configured');
    if (!schedule.employee.user?.status || !schedule.employee.user.openid)
      throw new ConflictException('Employee has no active bound WeChat account');
    await this.db.$transaction(async (tx) => {
      const changed = await tx.hrScheduleDelivery.updateMany({
        where: { id: delivery.id, status: delivery.status, attempts: delivery.attempts },
        data: { status: 'QUEUED', reasonCode: null },
      });
      if (changed.count !== 1) throw new ConflictException('Notification changed; reload');
      await tx.auditLog.create({ data: {
        userId: BigInt(user!.id!), entityType: 'HR_SCHEDULE_DELIVERY', entityId: delivery.id,
        action: 'RETRY', beforeData: { status: delivery.status, reasonCode: delivery.reasonCode },
        afterData: { status: 'QUEUED', attempts: delivery.attempts },
      } });
    });
    return { scheduleId: Number(scheduleId), version: delivery.version, deliveryStatus: 'QUEUED' };
  }

  @Cron('0 * * * * *', { timeZone: 'Asia/Shanghai' })
  async dispatchQueued() {
    if (this.dispatching || process.env.HR_FEATURES_ENABLED !== 'true' ||
      process.env.REPORT_SOURCE !== 'database') return;
    const config = scheduleTemplateConfig();
    if (!config) return;
    this.dispatching = true;
    try {
      const queued = await this.db.hrScheduleDelivery.findMany({ where: { status: 'QUEUED' },
        select: { id: true, attempts: true }, orderBy: { id: 'asc' }, take: 20 });
      for (const item of queued) {
        try { await this.dispatchOne(item.id, config); }
        catch { this.logger.error(`Schedule notification delivery ${item.id} needs manual reconciliation`); }
      }
    } finally { this.dispatching = false; }
  }

  private async dispatchOne(deliveryId: bigint, config: TemplateConfig) {
    // Claim before the external call. A crash leaves FAILED for manual review,
    // avoiding an automatic duplicate subscription message on restart.
    const claimed = await this.db.hrScheduleDelivery.updateMany({ where: { id: deliveryId, status: 'QUEUED' },
      data: { status: 'FAILED', reasonCode: 'SEND_INTERRUPTED', attempts: { increment: 1 },
        lastAttemptAt: new Date() } });
    if (claimed.count !== 1) return;
    const delivery = await this.db.hrScheduleDelivery.findUnique({ where: { id: deliveryId },
      include: { schedule: { include: { employee: { include: { user: true } }, store: true,
        shiftTemplate: { select: { name: true } }, versions: true } } } });
    if (!delivery) return;
    const schedule = delivery.schedule;
    const version = schedule.versions.find((item) => item.version === delivery.version);
    if (schedule.status !== 'PUBLISHED' || schedule.currentVersion !== delivery.version || !version) {
      await this.fail(deliveryId, 'STALE_SCHEDULE_VERSION'); return;
    }
    if (schedule.businessDate.toISOString().slice(0, 10) < localDay()) {
      await this.fail(deliveryId, 'PAST_SCHEDULE'); return;
    }
    const recipient = schedule.employee.user;
    if (!recipient?.status || !recipient.openid) {
      await this.fail(deliveryId, 'RECIPIENT_NOT_BOUND'); return;
    }
    if (!isTemplateNotificationEnabled(recipient.notificationPreferences, TEMPLATE_NOTIFICATION_KEYS.SCHEDULE)) {
      await this.fail(deliveryId, 'USER_DISABLED'); return;
    }
    try {
      const token = await this.token();
      const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touser: recipient.openid, template_id: config.id,
          page: 'pages/hr/my-schedule', data: scheduleTemplateData(config, {
            store: schedule.store.storeName, date: schedule.businessDate.toISOString().slice(0, 10),
            shift: schedule.shiftTemplate?.name ?? '排班',
            start: version.plannedStart, end: version.plannedEnd,
          }) }), signal: AbortSignal.timeout(10000),
      });
      const result = await response.json() as { errcode?: number; msgid?: string | number };
      if (!response.ok || result.errcode) {
        await this.fail(deliveryId, result.errcode ? `WECHAT_${result.errcode}` : 'WECHAT_HTTP_ERROR');
        return;
      }
      await this.db.hrScheduleDelivery.update({ where: { id: deliveryId }, data: {
        status: 'SENT', reasonCode: null, providerMessageId: result.msgid == null ? null : String(result.msgid),
      } });
    } catch {
      this.logger.warn(`Schedule notification delivery ${deliveryId} failed without provider receipt`);
      await this.fail(deliveryId, 'NETWORK_OR_PROVIDER_ERROR');
    }
  }

  private fail(id: bigint, reasonCode: string) {
    return this.db.hrScheduleDelivery.update({ where: { id }, data: { status: 'FAILED', reasonCode } });
  }

  private async token() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) return this.accessToken.value;
    const query = new URLSearchParams({ grant_type: 'client_credential',
      appid: process.env.WECHAT_APP_ID!, secret: process.env.WECHAT_APP_SECRET! });
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`,
      { signal: AbortSignal.timeout(10000) });
    const result = await response.json() as { access_token?: string; expires_in?: number };
    if (!response.ok || !result.access_token) throw new Error('WeChat token request failed');
    this.accessToken = { value: result.access_token,
      expiresAt: Date.now() + Math.max(60, (result.expires_in ?? 7200) - 300) * 1000 };
    return result.access_token;
  }
}
