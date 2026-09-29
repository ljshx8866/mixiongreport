import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { toDate } from './report.service';
import { assertStoreAccess, authUser, type RequestWithUser } from './auth';

const decimalFields = ['kitchenPower', 'diningPower', 'fullDayPower', 'airConditionPower', 'totalPower', 'waterUsage', 'laborHours'] as const;
const countFields = ['addonCustomerCount', 'comboCustomerCount'] as const;

@Controller('api/daily-inputs')
export class DailyInputController {
  constructor(private readonly db: PrismaService) {}

  @Get() async get(@Req() request: RequestWithUser, @Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    assertStoreAccess(request.user, storeId);
    const input = await this.db.storeDailyInput.findUnique({ where: { storeId_businessDate: { storeId: BigInt(storeId), businessDate: toDate(date) } } });
    if (!input) return null;
    return { ...input, id: Number(input.id), storeId: Number(input.storeId), submittedBy: input.submittedBy && Number(input.submittedBy) };
  }

  @Post() async save(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    const storeId = Number(body.storeId), businessDate = toDate(String(body.date));
    if (!Number.isSafeInteger(storeId) || storeId <= 0) throw new BadRequestException('Invalid storeId');
    assertStoreAccess(request.user, storeId);
    const existing = await this.db.storeDailyInput.findUnique({ where: { storeId_businessDate: { storeId: BigInt(storeId), businessDate } } });
    if (existing?.status && existing.status !== 'DRAFT') throw new BadRequestException('Only drafts can be edited');
    const data: Record<string, number | string | null> = {};
    for (const key of decimalFields) if (body[key] !== undefined) {
      const value = body[key] == null ? null : Number(body[key]);
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw new BadRequestException(`Invalid ${key}`);
      data[key] = value;
    }
    for (const key of countFields) if (body[key] !== undefined) {
      const value = body[key] == null ? null : Number(body[key]);
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new BadRequestException(`Invalid ${key}`);
      data[key] = value;
    }
    if (body.remark !== undefined) data.remark = body.remark == null ? null : String(body.remark);
    // Status transitions use the dedicated submit endpoint.
    const result = await this.db.storeDailyInput.upsert({
      where: { storeId_businessDate: { storeId: BigInt(storeId), businessDate } },
      create: { storeId: BigInt(storeId), businessDate, ...data }, update: data,
    });
    await this.db.auditLog.create({ data: {
      userId: authUser(request)?.id == null ? null : BigInt(authUser(request)!.id!),
      entityType: 'STORE_DAILY_INPUT', entityId: result.id, action: existing ? 'UPDATE' : 'CREATE',
      beforeData: existing ? JSON.parse(JSON.stringify(existing, (_k, v) => typeof v === 'bigint' ? v.toString() : v)) : undefined,
      afterData: JSON.parse(JSON.stringify(result, (_k, v) => typeof v === 'bigint' ? v.toString() : v)),
      reason: typeof body.reason === 'string' ? body.reason : null,
    } });
    return { id: Number(result.id), status: result.status };
  }

  @Post(':id/submit') async submit(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) inputId: number) {
    const input = await this.db.storeDailyInput.findUniqueOrThrow({ where: { id: BigInt(inputId) } });
    assertStoreAccess(request.user, Number(input.storeId));
    if (input.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    if ([input.kitchenPower, input.diningPower, input.fullDayPower, input.airConditionPower, input.waterUsage, input.laborHours, input.addonCustomerCount].some((x) => x == null))
      throw new BadRequestException('Required manual fields are missing');
    await this.db.$transaction([
      this.db.storeDailyInput.update({ where: { id: input.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedBy: authUser(request)?.id == null ? null : BigInt(authUser(request)!.id!) } }),
      this.db.dailyReportState.upsert({ where: { storeId_businessDate: { storeId: input.storeId, businessDate: input.businessDate } }, create: { storeId: input.storeId, businessDate: input.businessDate, status: 'SUBMITTED' }, update: { status: 'SUBMITTED' } }),
    ]);
    return { status: 'SUBMITTED' };
  }
}
