import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
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

  @Get('users') async users() {
    return (await this.db.user.findMany({ include: { stores: true }, orderBy: { id: 'asc' } })).map((u) => ({
      id: Number(u.id), name: u.name, mobile: u.mobile, openid: u.openid, role: u.role,
      status: u.status, storeIds: u.stores.map((s) => Number(s.storeId)),
    }));
  }
  @Post('users') async createUser(@Body() body: Record<string, unknown>) {
    if (typeof body.name !== 'string' || !body.name.trim() || !Object.values(UserRole).includes(body.role as UserRole))
      throw new BadRequestException('Valid name and role are required');
    if (typeof body.password !== 'string' || body.password.length < 8) throw new BadRequestException('Password must contain at least 8 characters');
    const user = await this.db.user.create({ data: {
      name: body.name.trim(), role: body.role as UserRole,
      mobile: typeof body.mobile === 'string' ? body.mobile : null,
      openid: typeof body.openid === 'string' ? body.openid : null,
      passwordHash: await passwordHash(body.password),
    } });
    return { id: Number(user.id) };
  }
  @Patch('users/:id') async updateUser(@Param('id', ParseIntPipe) userId: number, @Body() body: Record<string, unknown>) {
    const user = await this.db.user.update({ where: { id: positiveId(userId) }, data: {
      ...(typeof body.name === 'string' && { name: body.name.trim() }),
      ...(body.role !== undefined && { role: body.role as UserRole }),
      ...(body.mobile !== undefined && { mobile: body.mobile as string | null }),
      ...(body.openid !== undefined && { openid: body.openid as string | null }),
      ...(body.status !== undefined && { status: Boolean(body.status) }),
      ...(body.password !== undefined && { passwordHash: await passwordHash(String(body.password)) }),
    } });
    return { id: Number(user.id) };
  }
  @Post('users/:id/stores') async assignStore(@Param('id', ParseIntPipe) userId: number, @Body() body: { storeId: number }) {
    const userStore = await this.db.userStore.upsert({ where: { userId_storeId: { userId: positiveId(userId), storeId: positiveId(Number(body.storeId)) } },
      create: { userId: positiveId(userId), storeId: positiveId(Number(body.storeId)) }, update: {} });
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
