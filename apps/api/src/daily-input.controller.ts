import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { HrEmployeeStatus, UserRole } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { toDate } from './report.service';
import { assertStoreAccess, authUser, type RequestWithUser } from './auth';
import { SyncService } from './sync.service';
import { HrAccessService } from './hr/hr-access.service';
import { calculateDailyWorkTime } from '@restaurant/hr-engine';

const decimalFields = ['kitchenPower', 'diningPower', 'fullDayPower', 'airConditionPower', 'totalPower', 'waterUsage', 'laborHours'] as const;
const countFields = ['addonCustomerCount', 'comboCustomerCount'] as const;

@Controller('api/daily-inputs')
export class DailyInputController {
  private readonly logger = new Logger(DailyInputController.name);
  constructor(private readonly db: PrismaService, private readonly syncService: SyncService,
    private readonly hrAccess: HrAccessService) {}

  private async assertInputAccess(request: RequestWithUser, storeId: number, businessDate: Date) {
    const user = request.user;
    if (!user || user.system || user.role === UserRole.ADMIN) {
      assertStoreAccess(user, storeId);
      return;
    }
    const employee = user.id == null ? null : await this.db.hrEmployee.findUnique({
      where: { userId: BigInt(user.id) }, select: { id: true, status: true },
    });
    if (!employee) {
      assertStoreAccess(user, storeId);
      return;
    }
    if (employee.status !== HrEmployeeStatus.ACTIVE) throw new ForbiddenException('Active employee status is required');
    await this.hrAccess.assertStorePermission(user, 'HR_DAILY_INPUT_WRITE', BigInt(storeId));
    const date = businessDate.toISOString().slice(0, 10);
    const appointment = await this.db.hrPrimaryAppointment.findFirst({ where: {
      employeeId: employee.id, storeId: BigInt(storeId), effectiveFrom: { lte: businessDate },
      OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: businessDate } }],
    }, select: { id: true } });
    if (!appointment || Number.isNaN(Date.parse(date))) throw new ForbiddenException('No active employee assignment for this store and date');
  }

  @Get() async get(@Req() request: RequestWithUser, @Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    const businessDate = toDate(date);
    await this.assertInputAccess(request, storeId, businessDate);
    const input = await this.db.storeDailyInput.findUnique({ where: { storeId_businessDate: { storeId: BigInt(storeId), businessDate } } });
    if (!input) return null;
    return { ...input, id: Number(input.id), storeId: Number(input.storeId), submittedBy: input.submittedBy && Number(input.submittedBy) };
  }

  private async confirmedLaborHours(storeId: number, businessDate: Date) {
    const schedules = await this.db.hrSchedule.findMany({
      where: { storeId: BigInt(storeId), businessDate, status: 'PUBLISHED' },
      include: {
        employee: { select: { jobPosition: { select: { scheduleOnly: true } } } },
        workRecord: { include: { versions: { include: { daySegments: { where: { businessDate } } } } } },
      },
    });
    const includedSchedules = schedules.filter((schedule) => !schedule.employee.jobPosition?.scheduleOnly);
    const pendingShiftCount = includedSchedules.filter((schedule) => !schedule.workRecord).length;
    const statisticalMinutes = includedSchedules.reduce((total, schedule) => {
      const record = schedule.workRecord;
      if (!record) return total;
      const current = record.versions.find((version) => version.version === record.currentVersion);
      return total + calculateDailyWorkTime((current?.daySegments ?? []).map((segment) => ({ rawMinutes: segment.rawMinutes }))).statisticalMinutes;
    }, 0);
    return {
      storeId,
      date: businessDate.toISOString().slice(0, 10),
      scheduledShiftCount: includedSchedules.length,
      confirmedShiftCount: includedSchedules.length - pendingShiftCount,
      pendingShiftCount,
      statisticalMinutes,
      laborHours: Number((statisticalMinutes / 60).toFixed(2)),
    };
  }

  @Get('labor-hours') async getLaborHours(@Req() request: RequestWithUser,
    @Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    const businessDate = toDate(date);
    await this.assertInputAccess(request, storeId, businessDate);
    return this.confirmedLaborHours(storeId, businessDate);
  }

  @Post() async save(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    const storeId = Number(body.storeId), businessDate = toDate(String(body.date));
    if (!Number.isSafeInteger(storeId) || storeId <= 0) throw new BadRequestException('Invalid storeId');
    await this.assertInputAccess(request, storeId, businessDate);
    const existing = await this.db.storeDailyInput.findUnique({ where: { storeId_businessDate: { storeId: BigInt(storeId), businessDate } } });
    if (existing?.status && existing.status !== 'DRAFT') throw new BadRequestException('Only drafts can be edited');
    const data: Record<string, number | string | null> = {};
    for (const key of decimalFields) if (body[key] !== undefined) {
      const value = body[key] == null ? null : Number(body[key]);
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw new BadRequestException(`Invalid ${key}`);
      data[key] = value;
    }
    // Labor hours are derived from confirmed shift records and cannot be manually overridden.
    data.laborHours = (await this.confirmedLaborHours(storeId, businessDate)).laborHours;
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
    await this.assertInputAccess(request, Number(input.storeId), input.businessDate);
    if (input.status === 'SUBMITTED') return { status: 'SUBMITTED', posSync: { status: 'QUEUED' } };
    if (input.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    const labor = await this.confirmedLaborHours(Number(input.storeId), input.businessDate);
    if (process.env.HR_REQUIRE_CONFIRMED_LABOR_BEFORE_SUBMIT === 'true' && labor.pendingShiftCount > 0)
      throw new BadRequestException(`当日还有 ${labor.pendingShiftCount} 个班次未确认，请先完成工时确认后再提交日报`);
    if ([input.totalPower, input.kitchenPower, input.diningPower, input.waterUsage].some((x) => x == null))
      throw new BadRequestException('Required manual fields are missing');
    await this.db.$transaction(async (tx) => {
      const updated = await tx.storeDailyInput.updateMany({
        where: { id: input.id, status: 'DRAFT' },
        data: { status: 'SUBMITTED', laborHours: labor.laborHours, submittedAt: new Date(), submittedBy: authUser(request)?.id == null ? null : BigInt(authUser(request)!.id!) },
      });
      if (updated.count !== 1) throw new BadRequestException('Only drafts can be submitted');
      await tx.dailyReportState.upsert({ where: { storeId_businessDate: { storeId: input.storeId, businessDate: input.businessDate } }, create: { storeId: input.storeId, businessDate: input.businessDate, status: 'SUBMITTED' }, update: { status: 'SUBMITTED' } });
      await tx.fillReminderTask.updateMany({ where: { storeId: input.storeId, businessDate: input.businessDate, status: { in: ['OPEN', 'EXHAUSTED'] } }, data: { status: 'COMPLETED' } });
    });
    let posSync: Awaited<ReturnType<SyncService['sync']>> | { status: 'PENDING'; message: string };
    try {
      posSync = await this.syncService.sync(Number(input.storeId), input.businessDate.toISOString().slice(0, 10));
    } catch (error) {
      this.logger.warn(`POS sync deferred after report submit for store ${input.storeId}: ${error instanceof Error ? error.message : String(error)}`);
      posSync = { status: 'PENDING', message: '填报已提交，经营数据同步暂未完成，系统会自动重试。' };
    }
    return { status: 'SUBMITTED', posSync };
  }
}
