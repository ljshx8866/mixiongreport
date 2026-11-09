import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { HrEmployeeStatus, HrScheduleStatus } from '@prisma/client';
import { calculateDailyWorkTime, splitWorkIntervalByShanghaiDay, sumDailyHourlyPay } from '@restaurant/hr-engine';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { calculateConfirmedWorkPay } from './hr-hourly-pay';

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const localDay = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

function id(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

function day(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Date must be YYYY-MM-DD');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || dateOnly(result) !== value)
    throw new BadRequestException('Invalid date');
  return result;
}

function minute(value: unknown): { date: Date; epoch: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new BadRequestException('Work timestamps must have a UTC offset and minute precision');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid work timestamp');
  return { date, epoch: date.getTime() / 60000 };
}

export function actualWork(input: Record<string, unknown>, defaultBreaks?: unknown) {
  const start = minute(input.actualStart);
  const end = minute(input.actualEnd);
  const breakInput = input.breaks === undefined ? defaultBreaks : input.breaks;
  if (!Array.isArray(breakInput) || breakInput.length > 20)
    throw new BadRequestException('Break periods must be an array of at most 20 intervals');
  const breaks = breakInput.map((item) => {
    if (!item || typeof item !== 'object') throw new BadRequestException('Invalid break interval');
    const period = item as Record<string, unknown>;
    return { startEpochMinutes: minute(period.start).epoch, endEpochMinutes: minute(period.end).epoch };
  });
  let segments;
  try { segments = splitWorkIntervalByShanghaiDay({
    startEpochMinutes: start.epoch, endEpochMinutes: end.epoch, breaks,
  }); }
  catch { throw new BadRequestException('Invalid work or break intervals'); }
  return { start, end, breaks, segments, rawMinutes: segments.reduce((sum, part) => sum + part.rawMinutes, 0) };
}

export function deductBreakMinutes<T extends { segments: Array<{ businessDate: string; elapsedMinutes: number;
  breakMinutes: number; rawMinutes: number }>; rawMinutes: number }>(work: T, minutes: number): T {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > work.rawMinutes)
    throw new BadRequestException('休息时间不能大于实际上班时长');
  let remaining = minutes;
  const segments = work.segments.map((segment) => {
    const deduction = Math.min(segment.rawMinutes, remaining);
    remaining -= deduction;
    return { ...segment, breakMinutes: segment.breakMinutes + deduction,
      rawMinutes: segment.rawMinutes - deduction };
  });
  if (remaining) throw new BadRequestException('休息时间不能大于实际上班时长');
  return { ...work, segments, rawMinutes: work.rawMinutes - minutes };
}

export function storedBreakMinutes(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return total;
    const period = raw as Record<string, unknown>;
    if (typeof period.start !== 'string' || typeof period.end !== 'string') return total;
    const start = Date.parse(period.start), end = Date.parse(period.end);
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? total + Math.floor((end - start) / 60000) : total;
  }, 0);
}

@Injectable()
export class HrTimeService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  async confirm(user: AuthContext | undefined, scheduleIdInput: unknown, input: Record<string, unknown>) {
    const results = await this.confirmBatch(user, [{ ...input, scheduleId: scheduleIdInput }]);
    return results[0];
  }

  async confirmDay(user: AuthContext | undefined, input: Record<string, unknown>) {
    const employeeId = id(input.employeeId);
    const storeId = id(input.storeId);
    const businessDate = day(input.date);
    if (!Array.isArray(input.shifts) || input.shifts.length < 1 || input.shifts.length > 20)
      throw new BadRequestException('Select between 1 and 20 shifts to confirm');
    const shifts = input.shifts.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new BadRequestException('Invalid shift confirmation');
      return raw as Record<string, unknown>;
    });
    const results = await this.confirmBatch(user, shifts, { employeeId, storeId, businessDate });
    return { employeeId: Number(employeeId), storeId: Number(storeId), date: dateOnly(businessDate),
      confirmed: results };
  }

  async confirmStoreDay(user: AuthContext | undefined, input: Record<string, unknown>) {
    const storeId = id(input.storeId);
    const businessDate = day(input.date);
    if (!Array.isArray(input.shifts) || input.shifts.length < 1 || input.shifts.length > 500)
      throw new BadRequestException('Select between 1 and 500 shifts to confirm');
    const shifts = input.shifts.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new BadRequestException('Invalid shift confirmation');
      return raw as Record<string, unknown>;
    });
    const results = await this.confirmBatch(user, shifts, { storeId, businessDate });
    return { storeId: Number(storeId), date: dateOnly(businessDate), confirmed: results };
  }

  private async confirmBatch(user: AuthContext | undefined, inputs: Record<string, unknown>[],
    expectedGroup?: { employeeId?: bigint; storeId: bigint; businessDate: Date }) {
    if (new Set(inputs.map((item) => String(item.scheduleId))).size !== inputs.length)
      throw new BadRequestException('A shift can only be confirmed once per submission');
    const today = localDay(new Date());
    const prepared = await Promise.all(inputs.map(async (input) => {
      const scheduleId = id(input.scheduleId);
      const preview = await this.db.hrSchedule.findUnique({ where: { id: scheduleId },
        include: { versions: true,
          employee: { select: { jobPosition: { select: { scheduleOnly: true } } } } } });
      if (!preview || preview.status !== HrScheduleStatus.PUBLISHED)
        throw new ConflictException('Only a published shift can be confirmed');
      const confirmPermission = expectedGroup?.employeeId === undefined && expectedGroup
        ? 'HR_TIME_BULK_CONFIRM' : 'HR_TIME_CONFIRM_ONE';
      await this.access.assertStorePermission(user, confirmPermission, preview.storeId);
      if (preview.employee?.jobPosition?.scheduleOnly)
        throw new ConflictException('该岗位仅用于排班，无需确认工时');
      const actual = actualWork(input);
      const shiftDate = dateOnly(preview.businessDate);
      if (shiftDate !== today)
        throw new ConflictException('Only today\'s shifts can be confirmed');
      if (localDay(actual.start.date) !== shiftDate || localDay(actual.end.date) !== shiftDate)
        throw new BadRequestException('Actual work times must be on the shift date');
      const planned = preview.versions.find((item) => item.version === preview.currentVersion);
      if (!planned) throw new ConflictException('Current schedule version is missing');
      const usedPlannedTimes = actual.start.date.getTime() === planned.plannedStart.getTime() &&
        actual.end.date.getTime() === planned.plannedEnd.getTime();
      if (!usedPlannedTimes || actual.breaks.length > 0)
        await this.access.assertStorePermission(user, 'HR_TIME_ADJUST', preview.storeId);
      const confirmedWork = (input.useScheduledBreak === true || usedPlannedTimes) && actual.breaks.length === 0
        ? deductBreakMinutes(actual, planned.breakMinutes) : actual;
      if (actual.start.date.getTime() < planned.plannedStart.getTime() - 12 * 3600000 ||
        actual.start.date.getTime() > planned.plannedEnd.getTime() + 12 * 3600000)
        throw new BadRequestException('Actual start is too far from the scheduled shift');
      if (expectedGroup && (preview.storeId !== expectedGroup.storeId ||
        shiftDate !== dateOnly(expectedGroup.businessDate) ||
        (expectedGroup.employeeId !== undefined && preview.employeeId !== expectedGroup.employeeId)))
        throw new BadRequestException(expectedGroup.employeeId === undefined
          ? 'All shifts must belong to the same store and date'
          : 'All shifts must belong to the same employee, store and date');
      return { input, scheduleId, actual: confirmedWork, preview };
    }));
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      const lockIds = prepared.map((item) => item.scheduleId).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const scheduleId of lockIds)
        await tx.$queryRaw`SELECT id FROM hr_schedules WHERE id = ${scheduleId} FOR UPDATE`;
      const currentSchedules = await Promise.all(prepared.map(({ scheduleId, preview }) =>
        tx.hrSchedule.findUnique({ where: { id: scheduleId } }).then((schedule) => ({ schedule, preview, scheduleId }))));
      for (const { schedule, preview, scheduleId } of currentSchedules) {
        if (!schedule || schedule.status !== HrScheduleStatus.PUBLISHED ||
          schedule.currentVersion !== preview.currentVersion || schedule.employeeId !== preview.employeeId ||
          schedule.storeId !== preview.storeId || dateOnly(schedule.businessDate) !== dateOnly(preview.businessDate))
          throw new ConflictException('Schedule changed; reload');
        const existing = await tx.hrWorkRecord.findUnique({ where: { scheduleId } });
        if (existing) throw new ConflictException('This shift is already confirmed; use direct time correction');
      }
      const confirmed = [];
      for (const { input, scheduleId, actual, preview } of prepared) {
        const record = await tx.hrWorkRecord.create({ data: {
          scheduleId, employeeId: preview.employeeId, storeId: preview.storeId,
          versions: { create: { version: 1, actualStart: actual.start.date, actualEnd: actual.end.date,
            breaks: actual.breaks.map((item) => ({ start: new Date(item.startEpochMinutes * 60000).toISOString(),
              end: new Date(item.endEpochMinutes * 60000).toISOString() })),
            rawMinutes: actual.rawMinutes, confirmedBy: actorId,
            reason: typeof input.reason === 'string' ? input.reason.trim() || null : null,
            daySegments: { create: actual.segments.map((item) => ({ businessDate: day(item.businessDate),
              elapsedMinutes: item.elapsedMinutes, breakMinutes: item.breakMinutes, rawMinutes: item.rawMinutes })) },
          } },
        } });
        await tx.auditLog.create({ data: {
          userId: actorId, entityType: 'HR_WORK_RECORD', entityId: record.id,
          action: expectedGroup ? (expectedGroup.employeeId === undefined ? 'CONFIRM_STORE_DAY' : 'CONFIRM_DAY') : 'CONFIRM',
          afterData: { scheduleId: String(scheduleId), rawMinutes: actual.rawMinutes,
            dates: actual.segments.map((item) => item.businessDate),
            ...(expectedGroup ? { batchCount: prepared.length,
              ...(expectedGroup.employeeId === undefined ? {} : { employeeId: String(preview.employeeId) }) } : {}) },
        } });
        confirmed.push({ id: Number(record.id), scheduleId: Number(scheduleId), version: 1,
          rawMinutes: actual.rawMinutes, daySegments: actual.segments });
      }
      return confirmed;
    }, { isolationLevel: 'Serializable' });
  }

  async listDay(user: AuthContext | undefined, storeIdInput: unknown, dateInput: unknown) {
    const storeId = id(storeIdInput);
    const businessDate = day(dateInput);
    await this.access.assertAnyStorePermission(user,
      ['HR_SCHEDULE_LIST_READ', 'HR_TIME_LIST_READ', 'HR_TIME_ADJUST', 'HR_TIME_CONFIRM_ONE',
        'HR_TIME_BULK_CONFIRM', 'HR_TIME_CORRECTION_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE'], storeId);
    const selfEmployee = user?.id != null ? await this.db.hrEmployee.findUnique({
      where: { userId: BigInt(user.id) }, select: { id: true, status: true },
    }) : null;
    const isSelf = (employeeId: bigint) => selfEmployee?.status === 'ACTIVE' && selfEmployee.id === employeeId;
    const [records, pending] = await Promise.all([
      this.db.hrWorkRecord.findMany({ where: { storeId,
        versions: { some: { daySegments: { some: { businessDate } } } } },
        include: { employee: { select: { displayName: true, jobPosition: { select: { scheduleOnly: true } } } },
          schedule: { include: { versions: true } },
          versions: { include: { daySegments: { where: { businessDate } } } } },
      }),
      this.db.hrSchedule.findMany({ where: { storeId, businessDate,
        status: HrScheduleStatus.PUBLISHED, workRecord: null },
        include: { employee: { select: { displayName: true, jobPosition: { select: { scheduleOnly: true } } } }, versions: true },
      }),
    ]);
    return { date: dateOnly(businessDate), confirmed: records.filter((record) =>
      !record.employee.jobPosition?.scheduleOnly).flatMap((record) => {
      const current = record.versions.find((item) => item.version === record.currentVersion);
      const scheduleVersion = record.schedule.versions.find((item) =>
        item.version === record.schedule.currentVersion);
      return current?.daySegments.map((segment) => ({ recordId: Number(record.id),
        scheduleId: Number(record.scheduleId),
        employeeId: Number(record.employeeId), employeeName: record.employee.displayName,
        isSelf: isSelf(record.employeeId),
        version: current.version, actualStart: current.actualStart.toISOString(),
        actualEnd: current.actualEnd.toISOString(),
        breaks: Array.isArray(current.breaks) ? current.breaks : [],
        breakMinutes: segment.breakMinutes,
        scheduledMinutes: scheduleVersion ? Math.max(0, Math.floor((scheduleVersion.plannedEnd.getTime()
          - scheduleVersion.plannedStart.getTime()) / 60000) - scheduleVersion.breakMinutes) : 0,
        statisticalMinutes: calculateDailyWorkTime([{ rawMinutes: segment.rawMinutes }]).statisticalMinutes })) ?? [];
    }), pending: pending.filter((schedule) => !schedule.employee.jobPosition?.scheduleOnly).map((schedule) => {
      const version = schedule.versions.find((item) => item.version === schedule.currentVersion);
      return { scheduleId: Number(schedule.id), employeeId: Number(schedule.employeeId),
        employeeName: schedule.employee.displayName,
        isSelf: isSelf(schedule.employeeId),
        plannedStart: version?.plannedStart.toISOString() ?? null,
        plannedEnd: version?.plannedEnd.toISOString() ?? null,
        breakMinutes: version?.breakMinutes ?? 0 };
    }) };
  }

  async statistics(user: AuthContext | undefined, storeIdInput: unknown, startDateInput: unknown,
    endDateInput: unknown, employeeIdInput?: unknown) {
    const storeId = id(storeIdInput);
    const startDate = day(startDateInput);
    const endDate = day(endDateInput);
    if (endDate < startDate) throw new BadRequestException('End date must not be before start date');
    const dayCount = (endDate.getTime() - startDate.getTime()) / 86400000 + 1;
    if (dayCount > 366) throw new BadRequestException('Date range cannot exceed 366 days');
    const employeeId = employeeIdInput == null || employeeIdInput === '' ? undefined : id(employeeIdInput);
    const endExclusive = new Date(endDate.getTime() + 86400000);
    await this.access.assertStorePermission(user, 'HR_WORK_STATISTICS_READ', storeId);

    const employeeFilter = employeeId ? { employeeId } : {};
    const [schedules, records] = await Promise.all([
      this.db.hrSchedule.findMany({ where: { storeId, ...employeeFilter,
        businessDate: { gte: startDate, lt: endExclusive }, status: HrScheduleStatus.PUBLISHED,
      }, include: { employee: { select: { displayName: true, status: true,
        jobPosition: { select: { scheduleOnly: true } } } }, versions: true } }),
      this.db.hrWorkRecord.findMany({ where: { storeId, ...employeeFilter,
        versions: { some: { daySegments: { some: { businessDate: { gte: startDate, lt: endExclusive } } } } },
      }, include: { employee: { select: { displayName: true, status: true,
        jobPosition: { select: { scheduleOnly: true } } } },
        versions: { include: { daySegments: { where: { businessDate: { gte: startDate, lt: endExclusive } } } } },
      } }),
    ]);

    type DayValue = { scheduledMinutes: number; segments: number[] };
    type EmployeeValue = { employeeId: number; employeeName: string; isTrial: boolean; days: Map<string, DayValue> };
    const byEmployee = new Map<number, EmployeeValue>();
    const getEmployee = (employeeIdValue: bigint, employeeName: string, isTrial = false) => {
      const key = Number(employeeIdValue);
      let value = byEmployee.get(key);
      if (!value) {
        value = { employeeId: key, employeeName, isTrial, days: new Map() };
        byEmployee.set(key, value);
      } else if (!value.employeeName && employeeName) value.employeeName = employeeName;
      return value;
    };
    for (const schedule of schedules) {
      if (schedule.employee.jobPosition?.scheduleOnly) continue;
      const employee = getEmployee(schedule.employeeId, schedule.employee.displayName,
        schedule.employee.status === HrEmployeeStatus.TRIAL ||
          schedule.employee.status === HrEmployeeStatus.TRIAL_ENDED);
      const date = dateOnly(schedule.businessDate);
      const current = schedule.versions.find((item) => item.version === schedule.currentVersion);
      if (!current) continue;
      const plannedMinutes = Math.max(0, Math.floor((current.plannedEnd.getTime()
        - current.plannedStart.getTime()) / 60000) - current.breakMinutes);
      const value = employee.days.get(date) ?? { scheduledMinutes: 0, segments: [] };
      value.scheduledMinutes += plannedMinutes;
      employee.days.set(date, value);
    }
    for (const record of records) {
      if (record.employee.jobPosition?.scheduleOnly) continue;
      const employee = getEmployee(record.employeeId, record.employee.displayName,
        record.employee.status === HrEmployeeStatus.TRIAL ||
          record.employee.status === HrEmployeeStatus.TRIAL_ENDED);
      const current = record.versions.find((item) => item.version === record.currentVersion);
      for (const segment of current?.daySegments ?? []) {
        const date = dateOnly(segment.businessDate);
        const value = employee.days.get(date) ?? { scheduledMinutes: 0, segments: [] };
        value.segments.push(segment.rawMinutes);
        employee.days.set(date, value);
      }
    }

    const allEmployees = [...byEmployee.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'zh-CN'));
    const selectedEmployees = allEmployees.filter((employee) => employeeId == null || employee.employeeId === Number(employeeId));
    const salaryRates = selectedEmployees.some((employee) => [...employee.days.values()].some((value) => value.segments.length > 0))
      ? await this.db.hrSalaryRate.findMany({ where: { employeeId: { in: selectedEmployees.map((employee) => BigInt(employee.employeeId)) },
        effectiveFrom: { lt: endExclusive },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: startDate } }],
      } }) : [];
    const ratesByEmployee = new Map<number, typeof salaryRates>();
    for (const rate of salaryRates) {
      const key = Number(rate.employeeId);
      ratesByEmployee.set(key, [...(ratesByEmployee.get(key) ?? []), rate]);
    }
    const rows = selectedEmployees.map((employee) => {
      const rawDays = [...employee.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
        date,
        scheduledMinutes: value.scheduledMinutes,
        statisticalMinutes: calculateDailyWorkTime(value.segments.map((rawMinutes) => ({ rawMinutes }))).statisticalMinutes,
        confirmedShifts: value.segments.length,
      }));
      const paid = calculateConfirmedWorkPay(rawDays, ratesByEmployee.get(employee.employeeId) ?? []);
      const scheduledMinutes = rawDays.reduce((sum, item) => sum + item.scheduledMinutes, 0);
      const statisticalMinutes = rawDays.reduce((sum, item) => sum + item.statisticalMinutes, 0);
      return { employeeId: employee.employeeId, employeeName: employee.employeeName, isTrial: employee.isTrial, scheduledMinutes,
        statisticalMinutes, scheduledDays: rawDays.filter((item) => item.scheduledMinutes > 0).length,
        confirmedDays: rawDays.filter((item) => item.confirmedShifts > 0).length,
        basePayAmount: employee.isTrial ? null : paid.totalBasePayAmount,
        payStatus: employee.isTrial ? 'TRIAL_NOT_PAYABLE' as const : paid.payStatus,
        paidDays: paid.days };
    });
    const confirmedRows = rows.filter((item) => item.confirmedDays > 0 && item.payStatus !== 'TRIAL_NOT_PAYABLE');
    const payComplete = confirmedRows.length > 0 && confirmedRows.every((item) => item.payStatus === 'CALCULATED');
    const totalBasePayAmount = payComplete
      ? sumDailyHourlyPay(confirmedRows.flatMap((item) => item.paidDays
        .filter((day) => day.confirmedShifts > 0 && day.basePayAmount != null)
        .map((day) => day.basePayAmount!)))
      : null;
    const trialWorkOnly = rows.some((item) => item.payStatus === 'TRIAL_NOT_PAYABLE' && item.confirmedDays > 0) &&
      rows.every((item) => item.payStatus === 'TRIAL_NOT_PAYABLE');
    return { storeId: Number(storeId), startDate: dateOnly(startDate), endDate: dateOnly(endDate),
      employees: allEmployees.map(({ employeeId: value, employeeName }) => ({ id: value, name: employeeName })),
      totals: { employeeCount: rows.length,
        scheduledMinutes: rows.reduce((sum, item) => sum + item.scheduledMinutes, 0),
        statisticalMinutes: rows.reduce((sum, item) => sum + item.statisticalMinutes, 0),
        totalBasePayAmount,
        payStatus: trialWorkOnly ? 'TRIAL_NOT_PAYABLE' : confirmedRows.length === 0
          ? 'WAITING_FOR_CONFIRMATION' : payComplete ? 'CALCULATED' : 'MISSING_RATE' },
      rows: rows.map(({ paidDays, ...row }) => ({ ...row,
        ...(employeeId ? { days: paidDays } : {}) })) };
  }

  async dailySummary(user: AuthContext | undefined, employeeIdInput: unknown, dateInput: unknown) {
    const employeeId = id(employeeIdInput);
    const businessDate = day(dateInput);
    const employee = await this.db.hrEmployee.findUnique({ where: { id: employeeId },
      select: { userId: true, initialStoreId: true, primaryAppointments: { where: {
        effectiveFrom: { lte: businessDate },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: businessDate } }],
      }, select: { storeId: true } } },
    });
    if (!employee) throw new BadRequestException('Employee does not exist');
    const records = await this.db.hrWorkRecord.findMany({ where: { employeeId,
      versions: { some: { daySegments: { some: { businessDate } } } } },
      include: { versions: { include: { daySegments: { where: { businessDate } } } } },
    });
    const scopeStores = records.length ? records.map((item) => item.storeId)
      : employee.primaryAppointments.map((item) => item.storeId);
    if (!scopeStores.length && employee.initialStoreId) scopeStores.push(employee.initialStoreId);
    if (!scopeStores.length) throw new ConflictException('Employee has no store scope');
    for (const storeId of new Set(scopeStores))
      await this.access.assertStorePermission(user, employee.userId != null && user?.id === Number(employee.userId)
        ? 'HR_MY_WORK_READ' : 'HR_WORK_STATISTICS_READ', storeId);
    const schedules = await this.db.hrSchedule.findMany({ where: {
      employeeId, businessDate, status: HrScheduleStatus.PUBLISHED,
    }, include: { versions: true } });
    const scheduledMinutes = schedules.reduce((sum, schedule) => {
      const version = schedule.versions.find((item) => item.version === schedule.currentVersion);
      return sum + (version ? Math.max(0, Math.floor((version.plannedEnd.getTime()
        - version.plannedStart.getTime()) / 60000) - version.breakMinutes) : 0);
    }, 0);
    const segments = records.flatMap((record) => record.versions
      .filter((item) => item.version === record.currentVersion)
      .flatMap((item) => item.daySegments.map((part) => ({ rawMinutes: part.rawMinutes }))));
    return { employeeId: Number(employeeId), date: dateOnly(businessDate), scheduledMinutes,
      statisticalMinutes: calculateDailyWorkTime(segments).statisticalMinutes };
  }
}
