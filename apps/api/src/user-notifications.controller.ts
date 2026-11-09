import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { authUser, type RequestWithUser } from './auth';
import { isTemplateNotificationEnabled, notificationPreferenceMap, templateNotificationCatalog,
  TEMPLATE_NOTIFICATION_KEYS, type TemplateNotificationKey } from './notification-template-catalog';
import { HrAccessService } from './hr/hr-access.service';

const parsePositiveInteger = (value: unknown, fallback: number, max: number) => {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max)
    throw new BadRequestException('分页参数无效');
  return parsed;
};

const safePage = (value: string) => {
  const allowed = [
    'pages/input/index', 'pages/reminders/index',
    'pages/hr/approvals', 'pages/hr/onboarding', 'pages/hr/offboarding',
    'pages/hr/correction', 'pages/hr/transfer', 'pages/hr/my-schedule',
    'pages/hr/index', 'pages/hr/my-work',
  ];
  const path = value.split('?')[0];
  return allowed.includes(path) ? `/${value}` : '';
};

@Controller('api/notifications')
export class UserNotificationsController {
  constructor(private readonly db: PrismaService, private readonly hrAccess: HrAccessService) {}

  private recipient(request: RequestWithUser) {
    const id = authUser(request)?.id;
    if (!id) throw new UnauthorizedException('请先登录后查看通知');
    return BigInt(id);
  }

  private async eligibleTemplateKeys(request: RequestWithUser): Promise<Set<TemplateNotificationKey>> {
    const access = await this.hrAccess.currentAccess(request.user);
    const permissions = new Set(access.stores.flatMap((store) => store.permissionCodes));
    const eligible = new Set<TemplateNotificationKey>();
    if (permissions.has('HR_DAILY_INPUT_WRITE')) eligible.add(TEMPLATE_NOTIFICATION_KEYS.DAILY_REPORT);

    const approvalPermissions = [...permissions].some((code) =>
      code.endsWith('_APPROVE') || code.endsWith('_VERIFY') || code.startsWith('HR_TRANSFER_APPROVE_'));
    if (approvalPermissions) eligible.add(TEMPLATE_NOTIFICATION_KEYS.APPROVAL);

    const employee = await this.db.hrEmployee.findUnique({ where: { userId: this.recipient(request) },
      select: { id: true, status: true } });
    if (employee?.status === 'ACTIVE') {
      const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) + 'T00:00:00.000Z');
      const hasFuturePublishedSchedule = await this.db.hrSchedule.findFirst({ where: {
        employeeId: employee.id, status: 'PUBLISHED', businessDate: { gte: today },
      }, select: { id: true } });
      if (hasFuturePublishedSchedule) eligible.add(TEMPLATE_NOTIFICATION_KEYS.SCHEDULE);
    }
    return eligible;
  }

  @Get('settings')
  async settings(@Req() request: RequestWithUser) {
    const userId = this.recipient(request);
    const user = await this.db.user.findFirst({ where: { id: userId, status: true },
      select: { notificationPreferences: true } });
    if (!user) throw new UnauthorizedException('当前账号已停用，请重新登录');
    const preferences = user.notificationPreferences;
    const eligible = await this.eligibleTemplateKeys(request);
    return { authorizationMode: 'ONE_TIME', items: templateNotificationCatalog().filter((item) => eligible.has(item.key)).map((item) => ({
      ...item, enabled: isTemplateNotificationEnabled(preferences, item.key),
    })) };
  }

  @Patch('settings')
  async updateSettings(@Req() request: RequestWithUser, @Body() body: { key?: unknown; enabled?: unknown }) {
    const userId = this.recipient(request);
    if (typeof body?.key !== 'string' || typeof body.enabled !== 'boolean')
      throw new BadRequestException('通知类型或开关状态无效');
    const setting = templateNotificationCatalog().find((item) => item.key === body.key);
    if (!setting) throw new BadRequestException('不支持的通知类型');
    if (!(await this.eligibleTemplateKeys(request)).has(setting.key))
      throw new ForbiddenException('当前账号无需接收此类通知');
    const user = await this.db.user.findFirst({ where: { id: userId, status: true },
      select: { notificationPreferences: true } });
    if (!user) throw new UnauthorizedException('当前账号已停用，请重新登录');
    const preferences = {
      ...notificationPreferenceMap(user.notificationPreferences),
      [setting.key]: body.enabled,
    };
    await this.db.user.update({ where: { id: userId },
      data: { notificationPreferences: preferences as Prisma.InputJsonValue } });
    return { key: setting.key, enabled: body.enabled };
  }

  @Get('unread-count')
  async unreadCount(@Req() request: RequestWithUser) {
    const userId = this.recipient(request);
    return { count: await this.db.userNotification.count({ where: { userId, readAt: null } }) };
  }

  @Get()
  async list(@Req() request: RequestWithUser, @Query('filter') filter = 'ALL',
    @Query('page') pageInput?: string, @Query('pageSize') pageSizeInput?: string) {
    const userId = this.recipient(request);
    if (filter !== 'ALL' && filter !== 'UNREAD') throw new BadRequestException('通知筛选条件无效');
    const page = parsePositiveInteger(pageInput, 1, 1000000);
    const pageSize = parsePositiveInteger(pageSizeInput, 20, 50);
    const where = { userId, ...(filter === 'UNREAD' ? { readAt: null } : {}) };
    const [items, total, unreadCount] = await Promise.all([
      this.db.userNotification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize }),
      this.db.userNotification.count({ where }),
      this.db.userNotification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: items.map((item) => ({ id: Number(item.id), category: item.category,
        title: item.title, summary: item.summary, page: safePage(item.page),
        createdAt: item.createdAt, readAt: item.readAt })),
      total, unreadCount, page, pageSize,
    };
  }

  @Patch(':id/read')
  async markRead(@Req() request: RequestWithUser, @Param('id') idInput: string) {
    const userId = this.recipient(request);
    const idNumber = Number(idInput);
    if (!Number.isSafeInteger(idNumber) || idNumber < 1) throw new BadRequestException('通知编号无效');
    const id = BigInt(idNumber);
    const existing = await this.db.userNotification.findFirst({ where: { id, userId }, select: { id: true, readAt: true } });
    if (!existing) throw new NotFoundException('通知不存在');
    if (!existing.readAt) await this.db.userNotification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    const updated = await this.db.userNotification.findFirst({ where: { id, userId }, select: { id: true, readAt: true } });
    return { id: Number(updated!.id), readAt: updated!.readAt };
  }

  @Post('read-all')
  async markAllRead(@Req() request: RequestWithUser) {
    const userId = this.recipient(request);
    const result = await this.db.userNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }
}
