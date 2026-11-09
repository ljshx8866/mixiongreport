import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { toDate } from './report.service';
import { UserRole } from '@prisma/client';
import { Roles, passwordHash, authUser, type RequestWithUser } from './auth';

const positiveId = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new BadRequestException('Invalid id');
  return BigInt(value);
};

@Controller('api')
@Roles(UserRole.ADMIN)
export class AdministrationController {
  constructor(private readonly db: PrismaService) {}

  private mobile(value: unknown) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new BadRequestException('Mobile must be a string');
    return value.trim() || null;
  }

  private async ensureMobileAvailable(mobile: string | null, excludingId?: bigint) {
    if (!mobile) return;
    const user = await this.db.user.findUnique({ where: { mobile }, select: { id: true } });
    if (user && user.id !== excludingId) throw new ConflictException('This mobile number is already used by another account');
  }

  private async validStoreIds(value: unknown) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new BadRequestException('storeIds must be an array');
    const ids = [...new Set(value.map((item) => Number(item)))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new BadRequestException('Invalid store id');
    const stores = await this.db.store.findMany({ where: { id: { in: ids.map(positiveId) } }, select: { id: true } });
    if (stores.length !== ids.length) throw new BadRequestException('One or more stores do not exist');
    return ids;
  }

  @Get('users') async users() {
    return (await this.db.user.findMany({ include: { stores: true }, orderBy: { id: 'asc' } })).map((u) => ({
      id: Number(u.id), name: u.name, mobile: u.mobile, wechatBound: Boolean(u.openid), role: u.role,
      status: u.status, storeIds: u.stores.map((s) => Number(s.storeId)), source: u.source,
      externalUserCode: u.externalUserCode, lastSyncedAt: u.lastSyncedAt,
    }));
  }
  @Post('users') async createUser(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    if (typeof body.name !== 'string' || !body.name.trim() || !Object.values(UserRole).includes(body.role as UserRole))
      throw new BadRequestException('Valid name and role are required');
    if (typeof body.password !== 'string' || body.password.length < 8) throw new BadRequestException('Password must contain at least 8 characters');
    const name = body.name;
    const password = body.password;
    const mobile = this.mobile(body.mobile);
    const storeIds = await this.validStoreIds(body.storeIds);
    await this.ensureMobileAvailable(mobile);
    if (body.openid !== undefined) throw new BadRequestException('小程序绑定只能通过微信授权建立');
    const actorId = authUser(request)?.id == null ? null : positiveId(authUser(request)!.id!);
    const user = await this.db.$transaction(async (tx) => {
      const created = await tx.user.create({ data: {
        name: name.trim(), role: body.role as UserRole, mobile,
        passwordHash: await passwordHash(password),
      } });
      if (storeIds.length) await tx.userStore.createMany({ data: storeIds.map((storeId) => ({ userId: created.id, storeId: positiveId(storeId) })) });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'USER', entityId: created.id, action: 'CREATE_LOCAL', afterData: { name: created.name, mobile, role: created.role, storeIds } } });
      return created;
    });
    return { id: Number(user.id) };
  }
  @Patch('users/:id') async updateUser(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) userId: number, @Body() body: Record<string, unknown>) {
    const id = positiveId(userId);
    const actor = authUser(request);
    if (body.openid !== undefined) throw new BadRequestException('小程序绑定请使用重置绑定功能');
    if (actor?.id === userId && (body.role !== undefined || body.status !== undefined)) throw new ForbiddenException('Your own role and status cannot be changed');
    if (body.role !== undefined && !Object.values(UserRole).includes(body.role as UserRole)) throw new BadRequestException('Invalid role');
    const target = await this.db.user.findUniqueOrThrow({ where: { id } });
    if (target.source === 'POS') throw new BadRequestException('POS-managed users can only be changed by synchronizing POS data');
    const mobile = body.mobile === undefined ? target.mobile : this.mobile(body.mobile);
    await this.ensureMobileAvailable(mobile, id);
    const user = await this.db.user.update({ where: { id: positiveId(userId) }, data: {
      ...(typeof body.name === 'string' && body.name.trim() && { name: body.name.trim() }),
      ...(body.role !== undefined && { role: body.role as UserRole }),
      ...(body.mobile !== undefined && { mobile }),
      ...(body.status !== undefined && { status: Boolean(body.status) }),
      ...(body.password !== undefined && { passwordHash: await passwordHash(String(body.password)) }),
    } });
    return { id: Number(user.id) };
  }
  @Delete('users/:id/wechat-binding') async resetWechatBinding(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) userId: number) {
    const id = positiveId(userId);
    const actorId = authUser(request)?.id == null ? null : positiveId(authUser(request)!.id!);
    return this.db.$transaction(async (tx) => {
      const target = await tx.user.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, openid: true } });
      if (!target.openid) return { id: userId, reset: false };
      await tx.user.update({ where: { id }, data: { openid: null } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'USER', entityId: id, action: 'RESET_WECHAT_BINDING',
        beforeData: { name: target.name, wechatBound: true },
        afterData: { name: target.name, wechatBound: false },
      } });
      return { id: userId, reset: true };
    });
  }
  @Put('users/:id/stores') async replaceStores(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) userId: number, @Body() body: { storeIds?: unknown }) {
    if (!Array.isArray(body.storeIds)) throw new BadRequestException('storeIds must be an array');
    const storeIds = await this.validStoreIds(body.storeIds);
    const id = positiveId(userId);
    const target = await this.db.user.findUniqueOrThrow({ where: { id } });
    if (target.source === 'POS') throw new BadRequestException('POS-managed store permissions can only be changed by synchronizing POS data');
    const before = await this.db.userStore.findMany({ where: { userId: id }, select: { storeId: true } });
    const actorId = authUser(request)?.id == null ? null : positiveId(authUser(request)!.id!);
    await this.db.$transaction([
      this.db.userStore.deleteMany({ where: { userId: id } }),
      ...storeIds.map((storeId) => this.db.userStore.create({ data: { userId: id, storeId: positiveId(storeId) } })),
      this.db.auditLog.create({ data: { userId: actorId, entityType: 'USER', entityId: id, action: 'REPLACE_STORE_PERMISSIONS', beforeData: { storeIds: before.map((item) => Number(item.storeId)) }, afterData: { storeIds } } }),
    ]);
    return { userId, storeIds };
  }
  @Delete('users/:id') async deleteUser(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) userId: number) {
    const actor = authUser(request);
    if (actor?.id === userId) throw new ForbiddenException('Your own account cannot be deleted');
    const id = positiveId(userId);
    const target = await this.db.user.findUniqueOrThrow({ where: { id } });
    if (target.source === 'POS' && target.status) throw new BadRequestException('Active POS users can only be disabled by synchronizing POS data');
    if (target.role === UserRole.ADMIN && await this.db.user.count({ where: { role: UserRole.ADMIN, status: true } }) <= 1)
      throw new ConflictException('At least one active administrator is required');
    const actorId = actor?.id == null ? null : positiveId(actor.id);
    await this.db.$transaction([
      this.db.userStore.deleteMany({ where: { userId: id } }),
      this.db.storeDailyInput.updateMany({ where: { submittedBy: id }, data: { submittedBy: null } }),
      this.db.auditLog.updateMany({ where: { userId: id }, data: { userId: null } }),
      this.db.user.delete({ where: { id } }),
      this.db.auditLog.create({ data: { userId: actorId, entityType: 'USER', entityId: id, action: 'DELETE', beforeData: { name: target.name, mobile: target.mobile, role: target.role } } }),
    ]);
    return { id: userId };
  }
  @Post('users/:id/stores') async assignStore(@Param('id', ParseIntPipe) userId: number, @Body() body: { storeId: number }) {
    const id = positiveId(userId);
    const target = await this.db.user.findUniqueOrThrow({ where: { id } });
    if (target.source === 'POS') throw new BadRequestException('POS-managed store permissions can only be changed by synchronizing POS data');
    const userStore = await this.db.userStore.upsert({ where: { userId_storeId: { userId: id, storeId: positiveId(Number(body.storeId)) } },
      create: { userId: id, storeId: positiveId(Number(body.storeId)) }, update: {} });
    return { id: Number(userStore.id) };
  }
  @Get('power-config') async powerConfig(@Query('storeId', ParseIntPipe) storeId: number) {
    const config = await this.db.powerCalculationConfig.findUnique({ where: { storeId: positiveId(storeId) } });
    return { storeId, mode: config?.mode ?? 'SUM_COMPONENTS' };
  }
  @Post('power-config') async setPowerConfig(@Body() body: { storeId: number; mode: 'SUM_COMPONENTS' | 'MANUAL_TOTAL' }) {
    if (!['SUM_COMPONENTS', 'MANUAL_TOTAL'].includes(body.mode)) throw new BadRequestException('Invalid power mode');
    await this.db.powerCalculationConfig.upsert({ where: { storeId: positiveId(Number(body.storeId)) },
      create: { storeId: positiveId(Number(body.storeId)), mode: body.mode }, update: { mode: body.mode } });
    return { storeId: body.storeId, mode: body.mode };
  }
  @Get('report-states') async reportState(@Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    const state = await this.db.dailyReportState.findUnique({ where: { storeId_businessDate: { storeId: positiveId(storeId), businessDate: toDate(date) } } });
    return { storeId, date, status: state?.status ?? 'OPEN', verifiedAt: state?.verifiedAt ?? null, lockedAt: state?.lockedAt ?? null };
  }
  @Post('report-states/verify') async verify(@Req() request: RequestWithUser, @Body() body: { storeId: number; date: string }) {
    const storeId = positiveId(Number(body.storeId)), businessDate = toDate(body.date);
    const userId = authUser(request)?.id == null ? null : positiveId(authUser(request)!.id!);
    const state = await this.db.dailyReportState.findUniqueOrThrow({ where: { storeId_businessDate: { storeId, businessDate } } });
    if (state.status !== 'SUBMITTED') throw new BadRequestException('Only submitted reports can be verified');
    await this.db.$transaction([
      this.db.dailyReportState.update({ where: { id: state.id }, data: { status: 'VERIFIED', verifiedBy: userId, verifiedAt: new Date() } }),
      this.db.auditLog.create({ data: { userId, entityType: 'DAILY_REPORT_STATE', entityId: state.id, action: 'VERIFY', beforeData: { status: state.status }, afterData: { status: 'VERIFIED' } } }),
    ]);
    return { status: 'VERIFIED' };
  }
  @Post('report-states/lock') async lock(@Req() request: RequestWithUser, @Body() body: { storeId: number; date: string }) {
    const storeId = positiveId(Number(body.storeId)), businessDate = toDate(body.date);
    const userId = authUser(request)?.id == null ? null : positiveId(authUser(request)!.id!);
    const state = await this.db.dailyReportState.findUniqueOrThrow({ where: { storeId_businessDate: { storeId, businessDate } } });
    if (state.status !== 'VERIFIED') throw new BadRequestException('Only verified reports can be locked');
    await this.db.$transaction([
      this.db.dailyReportState.update({ where: { id: state.id }, data: { status: 'LOCKED', lockedAt: new Date() } }),
      this.db.storeDailyInput.update({ where: { storeId_businessDate: { storeId, businessDate } }, data: { status: 'LOCKED' } }),
      this.db.auditLog.create({ data: { userId, entityType: 'DAILY_REPORT_STATE', entityId: state.id, action: 'LOCK', beforeData: { status: state.status }, afterData: { status: 'LOCKED' } } }),
    ]);
    return { status: 'LOCKED' };
  }
}
