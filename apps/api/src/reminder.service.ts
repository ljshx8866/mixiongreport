import { BadRequestException, Body, Controller, Get, Injectable, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRole } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { Roles, authUser, type RequestWithUser } from './auth';
import { toDate } from './report.service';
import { isTemplateNotificationEnabled, TEMPLATE_NOTIFICATION_IDS, TEMPLATE_NOTIFICATION_KEYS } from './notification-template-catalog';
import { HrAccessService } from './hr/hr-access.service';

const TEMPLATE_ID = TEMPLATE_NOTIFICATION_IDS.dailyReport;
const id = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new BadRequestException('Invalid id');
  return BigInt(value);
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const currentTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

@Injectable()
export class ReminderService {
  private accessToken?: { value: string; expiresAt: number };

  constructor(private readonly db: PrismaService) {}

  async activeRecipients<T extends { userId: bigint }>(recipients: T[], storeId: bigint): Promise<T[]> {
    if (!recipients.length) return [];
    const activeIds = new Set((await this.db.user.findMany({ where: {
      id: { in: recipients.map((item) => item.userId) }, status: true,
      stores: { some: { storeId } },
      OR: [
        { role: UserRole.ADMIN },
        { hrRoleGrants: { some: { active: true, role: { enabled: true,
          permissions: { some: { permissionCode: 'HR_DAILY_INPUT_WRITE' } } } } } },
      ],
    }, select: { id: true } })).map((user) => user.id.toString()));
    return recipients.filter((recipient) => activeIds.has(recipient.userId.toString()));
  }

  private async token() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) return this.accessToken.value;
    const query = new URLSearchParams({
      grant_type: 'client_credential',
      appid: process.env.WECHAT_APP_ID ?? '',
      secret: process.env.WECHAT_APP_SECRET ?? '',
    });
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
    const result = await response.json() as { access_token?: string; expires_in?: number; errmsg?: string };
    if (!result.access_token) throw new Error(result.errmsg ?? 'Unable to obtain WeChat access token');
    this.accessToken = { value: result.access_token, expiresAt: Date.now() + ((result.expires_in ?? 7200) - 300) * 1000 };
    return result.access_token;
  }

  async dispatch(taskId: bigint, targetUserId: bigint, action: string, actorUserId?: bigint) {
    if (process.env.FILL_REMINDER_ENABLED === 'false') {
      return { status: 'DISABLED', errorMessage: 'REMINDER_DISABLED' };
    }
    const task = await this.db.fillReminderTask.findUniqueOrThrow({ where: { id: taskId } });
    const [user, store] = await Promise.all([
      this.db.user.findFirstOrThrow({ where: { id: targetUserId, status: true } }),
      this.db.store.findUniqueOrThrow({ where: { id: task.storeId } }),
    ]);
    let status = 'SENT';
    let errorMessage: string | null = null;
    try {
      if (!isTemplateNotificationEnabled(user.notificationPreferences, TEMPLATE_NOTIFICATION_KEYS.DAILY_REPORT)) {
        status = 'DISABLED';
        throw new Error('USER_DISABLED_TEMPLATE');
      }
      if (!user.openid) throw new Error('User has not bound WeChat');
      const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${await this.token()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: user.openid,
          template_id: TEMPLATE_ID,
          page: 'pages/input/index',
          data: {
            thing1: { value: store.storeName },
            time2: { value: `${today()} ${currentTime()}` },
            thing3: { value: '\u8bf7\u53ca\u65f6\u5b8c\u6210\u65e5\u62a5\u6216\u8f6c\u4ea4\u63d0\u9192' },
          },
        }),
      });
      const result = await response.json() as { errcode?: number; errmsg?: string };
      if (result.errcode) throw new Error(`${result.errcode}: ${result.errmsg ?? 'send failed'}`);
    } catch (error) {
      if (status !== 'DISABLED') {
        status = 'FAILED';
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    }
    const remindedAt = new Date();
    const actionSummary = action === 'DELEGATE' ? '提醒已转派给你，请完成门店日报填报'
      : action === 'NEXT' || action === 'AUTO_ESCALATE' ? '当前由你负责，请及时完成门店日报填报'
        : '请及时完成门店日报填报';
    await this.db.$transaction([
      this.db.fillReminderTask.update({
        where: { id: taskId },
        data: {
          currentUserId: targetUserId,
          lastRemindedAt: remindedAt,
          ...(action === 'NEXT' || action === 'DELEGATE' ? { status: 'OPEN' } : {}),
        },
      }),
      this.db.fillReminderLog.create({ data: { taskId, actorUserId, targetUserId, action, status, errorMessage } }),
      this.db.userNotification.createMany({
        data: [{
          userId: targetUserId,
          category: 'REMINDER',
          title: '门店日报填报提醒',
          summary: `${store.storeName} ${today()}：${actionSummary}`,
          page: 'pages/input/index',
          eventKey: `fill-reminder:${taskId}:${targetUserId}:${action}:${remindedAt.getTime()}`,
        }],
        skipDuplicates: true,
      }),
    ]);
    return { status, errorMessage };
  }

  @Cron('0 * * * * *')
  async schedule() {
    if (process.env.FILL_REMINDER_ENABLED === 'false' || process.env.REPORT_SOURCE !== 'database') return;
    const date = today();
    const time = currentTime();
    for (const config of await this.db.fillReminderConfig.findMany({
      where: { enabled: true, reminderTime: time },
      include: { recipients: { orderBy: { priority: 'asc' } } },
    })) {
      const recipients = await this.activeRecipients(config.recipients, config.storeId);
      if (!recipients.length) continue;
      const input = await this.db.storeDailyInput.findUnique({ where: { storeId_businessDate: { storeId: config.storeId, businessDate: toDate(date) } } });
      if (input && input.status !== 'DRAFT') {
        // Keep scheduled reminders self-healing if a report was submitted by
        // another channel or a prior task was left open.
        await this.db.fillReminderTask.updateMany({
          where: { configId: config.id, businessDate: toDate(date), status: { in: ['OPEN', 'EXHAUSTED'] } },
          data: { status: 'COMPLETED' },
        });
        continue;
      }
      const existing = await this.db.fillReminderTask.findUnique({ where: { configId_businessDate: { configId: config.id, businessDate: toDate(date) } } });
      if (existing) continue;
      const task = await this.db.fillReminderTask.create({
        data: { configId: config.id, storeId: config.storeId, businessDate: toDate(date), currentUserId: recipients[0].userId },
      });
      await this.dispatch(task.id, recipients[0].userId, 'INITIAL');
    }

    const openTasks = await this.db.fillReminderTask.findMany({
      where: { status: 'OPEN', lastRemindedAt: { not: null } },
      include: { config: { include: { recipients: { orderBy: { priority: 'asc' } } } } },
    });
    const now = Date.now();
    for (const task of openTasks) {
      if (!task.lastRemindedAt || now - task.lastRemindedAt.getTime() < task.config.escalationMinutes * 60_000) continue;
      const recipients = await this.activeRecipients(task.config.recipients, task.storeId);
      const index = recipients.findIndex((recipient) => recipient.userId === task.currentUserId);
      const nextRecipient = recipients[index + 1] ?? (index < 0 ? recipients[0] : undefined);
      if (nextRecipient) await this.dispatch(task.id, nextRecipient.userId, 'AUTO_ESCALATE');
      else await this.db.fillReminderTask.update({ where: { id: task.id }, data: { status: 'EXHAUSTED' } });
    }
  }
}

@Controller('api/reminders')
export class ReminderController {
  constructor(private readonly db: PrismaService, private readonly reminders: ReminderService,
    private readonly access: HrAccessService) {}

  @Get('config')
  @Roles(UserRole.ADMIN)
  async configs() {
    const disabledIds = (await this.db.user.findMany({ where: { status: false }, select: { id: true } })).map((user) => user.id);
    if (disabledIds.length) await this.db.fillReminderRecipient.deleteMany({ where: { userId: { in: disabledIds } } });
    return (await this.db.fillReminderConfig.findMany({ include: { recipients: { orderBy: { priority: 'asc' } } } })).map((item) => ({
      id: Number(item.id), storeId: Number(item.storeId), reminderTime: item.reminderTime, enabled: item.enabled,
      escalationMinutes: item.escalationMinutes, templateId: item.templateId,
      recipients: item.recipients.map((recipient) => ({ userId: Number(recipient.userId), priority: recipient.priority })),
    }));
  }

  @Post('config')
  @Roles(UserRole.ADMIN)
  async saveConfig(@Body() body: { storeId: number; reminderTime: string; enabled?: boolean; escalationMinutes?: number; recipientUserIds?: number[] }) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.reminderTime)) throw new BadRequestException('Invalid reminder time');
    const storeId = id(Number(body.storeId));
    const escalationMinutes = Number(body.escalationMinutes ?? 15);
    if (!Number.isSafeInteger(escalationMinutes) || escalationMinutes < 1 || escalationMinutes > 1440) throw new BadRequestException('Invalid escalation minutes');
    const userIds = [...new Set((body.recipientUserIds ?? []).map(Number))];
    const allowed = await this.db.user.findMany({ where: {
      id: { in: userIds.map(id) }, status: true, stores: { some: { storeId } },
      OR: [
        { role: UserRole.ADMIN },
        { hrRoleGrants: { some: { active: true, role: { enabled: true,
          permissions: { some: { permissionCode: 'HR_DAILY_INPUT_WRITE' } } } } } },
      ],
    }, select: { id: true } });
    if (allowed.length !== userIds.length) throw new BadRequestException('Recipients must belong to the selected store');
    const config = await this.db.fillReminderConfig.upsert({
      where: { storeId },
      create: { storeId, reminderTime: body.reminderTime, templateId: TEMPLATE_ID, enabled: body.enabled ?? true, escalationMinutes },
      update: { reminderTime: body.reminderTime, enabled: body.enabled ?? true, escalationMinutes, templateId: TEMPLATE_ID },
    });
    await this.db.$transaction([
      this.db.fillReminderRecipient.deleteMany({ where: { configId: config.id } }),
      ...userIds.map((userId, index) => this.db.fillReminderRecipient.create({ data: { configId: config.id, userId: id(userId), priority: index + 1 } })),
    ]);
    return { id: Number(config.id) };
  }

  @Get('mine')
  async mine(@Req() request: RequestWithUser) {
    const user = authUser(request);
    if (!user?.id) return [];
    const access = await this.access.currentAccess(user);
    const storeIds = access.stores.filter((store) =>
      store.permissionCodes.includes('HR_REMINDER_READ') || store.permissionCodes.includes('HR_REMINDER_PROCESS'))
      .map((store) => id(store.id));
    if (!storeIds.length) return [];
    return (await this.db.fillReminderTask.findMany({
      where: { currentUserId: id(user.id), storeId: { in: storeIds }, status: { in: ['OPEN', 'EXHAUSTED'] }, businessDate: toDate(today()) },
      orderBy: { createdAt: 'desc' },
    })).map((task) => ({
      id: Number(task.id), storeId: Number(task.storeId), date: task.businessDate, status: task.status,
    }));
  }

  @Get(':taskId/users')
  async storeUsers(@Req() request: RequestWithUser, @Param('taskId', ParseIntPipe) taskId: number) {
    const task = await this.db.fillReminderTask.findUniqueOrThrow({ where: { id: id(taskId) } });
    await this.access.assertAnyStorePermission(authUser(request), ['HR_REMINDER_READ', 'HR_REMINDER_PROCESS'], task.storeId);
    return (await this.db.user.findMany({ where: { status: true, stores: { some: { storeId: task.storeId } },
      OR: [
        { role: UserRole.ADMIN },
        { hrRoleGrants: { some: { active: true, role: { enabled: true,
          permissions: { some: { permissionCode: 'HR_DAILY_INPUT_WRITE' } } } } } },
      ],
    }, orderBy: { name: 'asc' } })).map((user) => ({ id: Number(user.id), name: user.name }));
  }

  @Post(':taskId/next')
  async next(@Req() request: RequestWithUser, @Param('taskId', ParseIntPipe) taskId: number) {
    const user = authUser(request);
    if (!user?.id) throw new BadRequestException('User is required');
    const task = await this.db.fillReminderTask.findUniqueOrThrow({ where: { id: id(taskId) }, include: { config: { include: { recipients: { orderBy: { priority: 'asc' } } } } } });
    await this.access.assertStorePermission(user, 'HR_REMINDER_PROCESS', task.storeId);
    if (Number(task.currentUserId) !== user.id) throw new BadRequestException('Reminder is not assigned to this user');
    const recipients = await this.reminders.activeRecipients(task.config.recipients, task.storeId);
    const index = recipients.findIndex((item) => item.userId === task.currentUserId);
    const target = recipients[index + 1];
    if (!target) throw new BadRequestException('No next reminder recipient');
    return this.reminders.dispatch(task.id, target.userId, 'NEXT', id(user.id));
  }

  @Post(':taskId/delegate')
  async delegate(@Req() request: RequestWithUser, @Param('taskId', ParseIntPipe) taskId: number, @Body() body: { userId: number }) {
    const user = authUser(request);
    if (!user?.id) throw new BadRequestException('User is required');
    const task = await this.db.fillReminderTask.findUniqueOrThrow({ where: { id: id(taskId) } });
    await this.access.assertStorePermission(user, 'HR_REMINDER_PROCESS', task.storeId);
    if (Number(task.currentUserId) !== user.id) throw new BadRequestException('Reminder is not assigned to this user');
    const target = id(Number(body.userId));
    if (!(await this.reminders.activeRecipients([{ userId: target }], task.storeId)).length)
      throw new BadRequestException('接收人员必须是已启用并拥有该门店填报权限的账号');
    return this.reminders.dispatch(task.id, target, 'DELEGATE', id(user.id));
  }
}
