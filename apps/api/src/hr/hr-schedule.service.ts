import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { HrEmployeeStatus, HrScheduleStatus, Prisma } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { scheduleTemplateConfig } from './hr-schedule-notification.service';
import { roleAllowsScheduling } from './hr-scheduling-eligibility';

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const scheduleClock = (value: Date) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(value);
const localDay = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

function businessDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Business date must be YYYY-MM-DD');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || dateOnly(result) !== value)
    throw new BadRequestException('Invalid business date');
  return result;
}

function clockValue(value: unknown): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new BadRequestException('Shift times must use HH:mm in the store time zone');
  return value;
}

function templateInterval(day: Date, input: { startTime: string; endTime: string; breakMinutes: number }) {
  const businessDay = dateOnly(day);
  const startTime = clockValue(input.startTime);
  const endTime = clockValue(input.endTime);
  const start = new Date(`${businessDay}T${startTime}:00+08:00`);
  const end = new Date(`${businessDay}T${endTime}:00+08:00`);
  const duration = (end.getTime() - start.getTime()) / 60000;
  const breakMinutes = Number(input.breakMinutes);
  if (!Number.isInteger(duration) || duration <= 0 || duration > 1440 ||
    !Number.isSafeInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= duration)
    throw new BadRequestException('Shift end must be later than start; check the break duration');
  return { start, end, breakMinutes };
}

function templateCode(): string {
  return `SHIFT_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function shanghaiDate(offsetDays = 0): string {
  const today = businessDate(localDay(new Date()));
  return dateOnly(new Date(today.getTime() + offsetDays * 86400000));
}

function tomorrow(): string {
  return shanghaiDate(1);
}

function positiveId(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

@Injectable()
export class HrScheduleService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  async list(user: AuthContext | undefined, storeIdInput: unknown, dateInput: unknown) {
    const storeId = positiveId(storeIdInput);
    const day = businessDate(dateInput);
    await this.access.assertAnyStorePermission(user,
      ['HR_SCHEDULE_LIST_READ', 'HR_SCHEDULE_DRAFT_EDIT', 'HR_SCHEDULE_DRAFT_DELETE', 'HR_SCHEDULE_PUBLISH', 'HR_SCHEDULE_REVISE'], storeId);
    const rows = await this.db.hrSchedule.findMany({
      where: { storeId, businessDate: day, status: { not: HrScheduleStatus.CANCELED } },
      include: { employee: { select: { displayName: true, jobPosition: { select: { scheduleOnly: true } } } }, versions: true,
        shiftTemplate: { select: { id: true, name: true } },
        point: { select: { name: true } },
        deliveries: { select: { version: true, status: true, reasonCode: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => {
      const version = row.versions.find((item) => item.version === row.currentVersion);
      const delivery = row.deliveries.find((item) => item.version === row.currentVersion);
      return { id: Number(row.id), employeeId: Number(row.employeeId), employeeName: row.employee.displayName,
        businessDate: dateOnly(row.businessDate), status: row.status, version: row.currentVersion,
        shiftTemplateId: row.shiftTemplate ? Number(row.shiftTemplate.id) : null,
        shiftTemplateName: row.shiftTemplate?.name ?? null,
        pointId: row.pointId == null ? null : Number(row.pointId),
        pointName: row.pointName ?? row.point?.name ?? null,
        plannedStart: version?.plannedStart.toISOString() ?? null,
        plannedEnd: version?.plannedEnd.toISOString() ?? null, breakMinutes: version?.breakMinutes ?? null,
        scheduleOnly: row.employee.jobPosition?.scheduleOnly ?? false,
        deliveryStatus: delivery?.status ?? null, deliveryReasonCode: delivery?.reasonCode ?? null };
    });
  }

  async listShiftTemplates(user: AuthContext | undefined, storeIdInput: unknown) {
    const storeId = positiveId(storeIdInput);
    await this.access.assertAnyStorePermission(user,
      ['HR_SHIFT_TEMPLATE_READ', 'HR_SHIFT_TEMPLATE_EDIT', 'HR_SHIFT_TEMPLATE_DELETE', 'HR_SCHEDULE_DRAFT_EDIT'], storeId);
    const rows = await this.db.hrShiftTemplate.findMany({ where: { storeId }, orderBy: [
      { sortOrder: 'asc' }, { id: 'asc' },
    ] });
    return rows.map((row) => ({ id: Number(row.id), code: row.code, name: row.name,
      startTime: row.startTime, endTime: row.endTime, breakMinutes: row.breakMinutes,
      sortOrder: row.sortOrder, enabled: row.enabled }));
  }

  async listPoints(user: AuthContext | undefined, storeIdInput: unknown) {
    const storeId = positiveId(storeIdInput);
    await this.access.assertAnyStorePermission(user,
      ['HR_SCHEDULE_POINT_READ', 'HR_SCHEDULE_POINT_EDIT', 'HR_SCHEDULE_POINT_DELETE', 'HR_SCHEDULE_DRAFT_EDIT'], storeId);
    const rows = await this.db.hrSchedulePoint.findMany({ where: { storeId }, orderBy: [
      { sortOrder: 'asc' }, { id: 'asc' },
    ] });
    return rows.map((row) => ({ id: Number(row.id), storeId: Number(row.storeId), name: row.name,
      sortOrder: row.sortOrder, enabled: row.enabled }));
  }

  async createPoint(user: AuthContext | undefined, input: Record<string, unknown>) {
    const storeId = positiveId(input.storeId);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const sortOrder = input.sortOrder === undefined ? 0 : Number(input.sortOrder);
    if (!name || name.length > 80 || !Number.isSafeInteger(sortOrder))
      throw new BadRequestException('Point name is required (max 80 characters)');
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_POINT_EDIT', storeId);
    const actorId = BigInt(user!.id!);
    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.hrSchedulePoint.create({ data: {
        storeId, name, sortOrder, enabled: true, createdBy: actorId,
      } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SCHEDULE_POINT',
        entityId: created.id, action: 'CREATE', afterData: { storeId: String(storeId), name, sortOrder } } });
      return created;
    });
    return { id: Number(row.id), storeId: Number(row.storeId), name: row.name,
      sortOrder: row.sortOrder, enabled: row.enabled };
  }

  async updatePoint(user: AuthContext | undefined, pointIdInput: unknown,
    input: Record<string, unknown>) {
    const pointId = positiveId(pointIdInput);
    const preview = await this.db.hrSchedulePoint.findUnique({ where: { id: pointId } });
    if (!preview) throw new ConflictException('Schedule point is unavailable');
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_POINT_EDIT', preview.storeId);
    const name = input.name === undefined ? preview.name : typeof input.name === 'string' ? input.name.trim() : '';
    const enabled = input.enabled === undefined ? preview.enabled : input.enabled;
    const sortOrder = input.sortOrder === undefined ? preview.sortOrder : Number(input.sortOrder);
    if (!name || name.length > 80 || typeof enabled !== 'boolean' || !Number.isSafeInteger(sortOrder))
      throw new BadRequestException('Invalid schedule point settings');
    const actorId = BigInt(user!.id!);
    const row = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_schedule_points WHERE id = ${pointId} FOR UPDATE`;
      const updated = await tx.hrSchedulePoint.update({ where: { id: pointId }, data: { name, enabled, sortOrder } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SCHEDULE_POINT',
        entityId: pointId, action: 'UPDATE',
        beforeData: { name: preview.name, enabled: preview.enabled, sortOrder: preview.sortOrder },
        afterData: { name, enabled, sortOrder } } });
      return updated;
    });
    return { id: Number(row.id), storeId: Number(row.storeId), name: row.name,
      sortOrder: row.sortOrder, enabled: row.enabled };
  }

  async deletePoint(user: AuthContext | undefined, pointIdInput: unknown) {
    const pointId = positiveId(pointIdInput);
    const preview = await this.db.hrSchedulePoint.findUnique({ where: { id: pointId } });
    if (!preview) throw new ConflictException('Schedule point is unavailable');
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_POINT_DELETE', preview.storeId);
    const actorId = BigInt(user!.id!);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_schedule_points WHERE id = ${pointId} FOR UPDATE`;
      const current = await tx.hrSchedulePoint.findUnique({ where: { id: pointId } });
      if (!current) throw new ConflictException('Schedule point is unavailable');
      await tx.hrSchedulePoint.delete({ where: { id: pointId } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SCHEDULE_POINT',
        entityId: pointId, action: 'DELETE', beforeData: { storeId: String(current.storeId),
          name: current.name, sortOrder: current.sortOrder, enabled: current.enabled } } });
    });
    return { id: Number(pointId), deleted: true };
  }

  async createShiftTemplate(user: AuthContext | undefined, input: Record<string, unknown>) {
    const storeId = positiveId(input.storeId);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const startTime = clockValue(input.startTime);
    const endTime = clockValue(input.endTime);
    const breakMinutes = Number(input.breakMinutes ?? 0);
    const planned = templateInterval(businessDate('2026-01-01'), { startTime, endTime, breakMinutes });
    if (!name || name.length > 80) throw new BadRequestException('Shift name is required (max 80 characters)');
    await this.access.assertStorePermission(user, 'HR_SHIFT_TEMPLATE_EDIT', storeId);
    const actorId = BigInt(user!.id!);
    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.hrShiftTemplate.create({ data: {
        storeId, code: templateCode(), name, startTime, endTime, breakMinutes,
        sortOrder: Number.isSafeInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
        enabled: true, createdBy: actorId,
      } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SHIFT_TEMPLATE',
        entityId: created.id, action: 'CREATE', afterData: { storeId: String(storeId), name,
          startTime, endTime, breakMinutes } } });
      return created;
    });
    return { id: Number(row.id), code: row.code, name: row.name, startTime: row.startTime,
      endTime: row.endTime, breakMinutes: row.breakMinutes, sortOrder: row.sortOrder,
      enabled: row.enabled, durationMinutes: (planned.end.getTime() - planned.start.getTime()) / 60000 };
  }

  async updateShiftTemplate(user: AuthContext | undefined, templateIdInput: unknown,
    input: Record<string, unknown>) {
    const templateId = positiveId(templateIdInput);
    const preview = await this.db.hrShiftTemplate.findUnique({ where: { id: templateId } });
    if (!preview) throw new ConflictException('Shift template is unavailable');
    await this.access.assertStorePermission(user, 'HR_SHIFT_TEMPLATE_EDIT', preview.storeId);
    const name = input.name === undefined ? preview.name : typeof input.name === 'string' ? input.name.trim() : '';
    const startTime = input.startTime === undefined ? preview.startTime : clockValue(input.startTime);
    const endTime = input.endTime === undefined ? preview.endTime : clockValue(input.endTime);
    const breakMinutes = input.breakMinutes === undefined ? preview.breakMinutes : Number(input.breakMinutes);
    const enabled = input.enabled === undefined ? preview.enabled : input.enabled;
    const sortOrder = input.sortOrder === undefined ? preview.sortOrder : Number(input.sortOrder);
    if (!name || name.length > 80 || typeof enabled !== 'boolean' || !Number.isSafeInteger(sortOrder))
      throw new BadRequestException('Invalid shift template settings');
    templateInterval(businessDate('2026-01-01'), { startTime, endTime, breakMinutes });
    const actorId = BigInt(user!.id!);
    const row = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_shift_templates WHERE id = ${templateId} FOR UPDATE`;
      const updated = await tx.hrShiftTemplate.update({ where: { id: templateId }, data: {
        name, startTime, endTime, breakMinutes, enabled, sortOrder,
      } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SHIFT_TEMPLATE',
        entityId: templateId, action: 'UPDATE',
        beforeData: { name: preview.name, startTime: preview.startTime, endTime: preview.endTime,
          breakMinutes: preview.breakMinutes, enabled: preview.enabled, sortOrder: preview.sortOrder },
        afterData: { name, startTime, endTime, breakMinutes, enabled, sortOrder } } });
      return updated;
    });
    return { id: Number(row.id), code: row.code, name: row.name, startTime: row.startTime,
      endTime: row.endTime, breakMinutes: row.breakMinutes, enabled: row.enabled, sortOrder: row.sortOrder };
  }

  async deleteShiftTemplate(user: AuthContext | undefined, templateIdInput: unknown) {
    const templateId = positiveId(templateIdInput);
    const preview = await this.db.hrShiftTemplate.findUnique({ where: { id: templateId } });
    if (!preview) throw new ConflictException('班次不存在或已删除，请刷新后重试。');
    await this.access.assertStorePermission(user, 'HR_SHIFT_TEMPLATE_DELETE', preview.storeId);
    const actorId = BigInt(user!.id!);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_shift_templates WHERE id = ${templateId} FOR UPDATE`;
      const current = await tx.hrShiftTemplate.findUnique({ where: { id: templateId } });
      if (!current) throw new ConflictException('班次不存在或已删除，请刷新后重试。');
      const usageCount = await tx.hrSchedule.count({ where: { shiftTemplateId: templateId } });
      if (usageCount > 0)
        throw new ConflictException('该班次已用于历史排班，不能删除；如不再使用，请停用班次。');
      await tx.hrShiftTemplate.delete({ where: { id: templateId } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SHIFT_TEMPLATE',
        entityId: templateId, action: 'DELETE', beforeData: { storeId: String(current.storeId),
          code: current.code, name: current.name, startTime: current.startTime,
          endTime: current.endTime, breakMinutes: current.breakMinutes,
          enabled: current.enabled, sortOrder: current.sortOrder } } });
    });
    return { id: Number(templateId), deleted: true };
  }

  async notificationFailures(user: AuthContext | undefined, storeIdInput: unknown, dateInput: unknown) {
    const storeId = positiveId(storeIdInput);
    const day = businessDate(dateInput);
    await this.access.assertAnyStorePermission(user,
      ['HR_SCHEDULE_LIST_READ', 'HR_SCHEDULE_PUBLISH', 'HR_SCHEDULE_REVISE'], storeId);
    const rows = await this.db.hrSchedule.findMany({
      where: { storeId, businessDate: day, status: HrScheduleStatus.PUBLISHED,
        deliveries: { some: { status: { in: ['UNAVAILABLE', 'FAILED'] } } } },
      include: { employee: { select: { displayName: true } }, deliveries: true },
      orderBy: { id: 'asc' },
    });
    return rows.flatMap((row) => row.deliveries
      .filter((delivery) => delivery.version === row.currentVersion &&
        (delivery.status === 'UNAVAILABLE' || delivery.status === 'FAILED'))
      .map((delivery) => ({ scheduleId: Number(row.id), version: row.currentVersion,
        employeeId: Number(row.employeeId), employeeName: row.employee.displayName,
        status: delivery.status, reasonCode: delivery.reasonCode,
        lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null })));
  }

  async create(user: AuthContext | undefined, input: Record<string, unknown>) {
    const employeeId = positiveId(input.employeeId);
    const storeId = positiveId(input.storeId);
    const day = businessDate(input.businessDate);
    const shiftTemplateId = positiveId(input.shiftTemplateId);
    const pointId = input.pointId === undefined || input.pointId === null || input.pointId === ''
      ? null : positiveId(input.pointId);
    if (dateOnly(day) < shanghaiDate()) throw new BadRequestException('Schedules cannot be created for a past date');
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_DRAFT_EDIT', storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${employeeId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hr_shift_templates WHERE id = ${shiftTemplateId} FOR SHARE`;
      const template = await tx.hrShiftTemplate.findFirst({ where: { id: shiftTemplateId, storeId, enabled: true } });
      if (!template) throw new ConflictException('Select an active shift template for this store');
      const point = pointId == null ? null : await tx.hrSchedulePoint.findFirst({
        where: { id: pointId, storeId, enabled: true },
      });
      if (pointId != null && !point) throw new ConflictException('Select an active point for this store');
      const planned = templateInterval(day, template);
      await this.assertEligible(tx, employeeId, storeId, day);
      await this.assertNoOverlap(tx, employeeId, day, planned.start, planned.end);
      const schedule = await tx.hrSchedule.create({ data: {
        employeeId, storeId, shiftTemplateId, businessDate: day,
        pointId: point?.id ?? null, pointName: point?.name ?? null,
        versions: { create: { version: 1, plannedStart: planned.start, plannedEnd: planned.end,
          breakMinutes: planned.breakMinutes, createdBy: actorId } },
      } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_SCHEDULE', entityId: schedule.id, action: 'CREATE_DRAFT',
        afterData: { employeeId: String(employeeId), storeId: String(storeId),
          shiftTemplateId: String(shiftTemplateId), shiftTemplateName: template.name, businessDate: dateOnly(day),
          pointId: point ? String(point.id) : null, pointName: point?.name ?? null,
          plannedStart: planned.start.toISOString(), plannedEnd: planned.end.toISOString() },
      } });
      return { id: Number(schedule.id), status: schedule.status, version: schedule.currentVersion,
        pointId: point ? Number(point.id) : null, pointName: point?.name ?? null };
    });
  }

  async createBatch(user: AuthContext | undefined, input: Record<string, unknown>) {
    const storeId = positiveId(input.storeId);
    const day = businessDate(input.businessDate);
    if (dateOnly(day) < shanghaiDate()) throw new BadRequestException('Schedules cannot be created for a past date');
    if (!Array.isArray(input.assignments) || input.assignments.length < 1 || input.assignments.length > 300)
      throw new BadRequestException('Select between 1 and 300 employee shifts');
    const assignments = input.assignments.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Invalid schedule assignment');
      const item = raw as Record<string, unknown>;
      return { employeeId: positiveId(item.employeeId), shiftTemplateId: positiveId(item.shiftTemplateId),
        pointId: positiveId(item.pointId) };
    });
    const employeePoints = new Map<string, string>();
    for (const assignment of assignments) {
      const employeeId = assignment.employeeId.toString();
      const pointId = assignment.pointId.toString();
      const previous = employeePoints.get(employeeId);
      if (previous && previous !== pointId)
        throw new BadRequestException('Each employee must use one schedule point for the day');
      employeePoints.set(employeeId, pointId);
    }
    const employeeIds = [...new Set(assignments.map((item) => item.employeeId.toString()))]
      .map((value) => BigInt(value)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const templateIds = [...new Set(assignments.map((item) => item.shiftTemplateId.toString()))]
      .map((value) => BigInt(value)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const pointIds = [...new Set(assignments.map((item) => item.pointId.toString()))]
      .map((value) => BigInt(value)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_DRAFT_EDIT', storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM hr_employees
        WHERE id IN (${Prisma.join(employeeIds)}) ORDER BY id FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM hr_shift_templates
        WHERE id IN (${Prisma.join(templateIds)}) ORDER BY id FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM hr_schedule_points
        WHERE id IN (${Prisma.join(pointIds)}) ORDER BY id FOR SHARE`);
      const templates = await tx.hrShiftTemplate.findMany({ where: {
        id: { in: templateIds }, storeId, enabled: true,
      } });
      if (templates.length !== templateIds.length)
        throw new ConflictException('A selected shift is disabled or belongs to another store');
      const points = await tx.hrSchedulePoint.findMany({ where: {
        id: { in: pointIds }, storeId, enabled: true,
      } });
      if (points.length !== pointIds.length)
        throw new ConflictException('A selected point is disabled or belongs to another store');
      const byId = new Map(templates.map((item) => [item.id.toString(), item]));
      const pointsById = new Map(points.map((item) => [item.id.toString(), item]));
      const created = [];
      for (const assignment of assignments) {
        const template = byId.get(assignment.shiftTemplateId.toString());
        const point = pointsById.get(assignment.pointId.toString());
        if (!template) throw new ConflictException('A selected shift is unavailable');
        if (!point) throw new ConflictException('A selected point is unavailable');
        const planned = templateInterval(day, template);
        await this.assertEligible(tx, assignment.employeeId, storeId, day);
        await this.assertNoOverlap(tx, assignment.employeeId, day, planned.start, planned.end);
        const schedule = await tx.hrSchedule.create({ data: {
          employeeId: assignment.employeeId, storeId, shiftTemplateId: template.id, businessDate: day,
          pointId: point.id, pointName: point.name,
          versions: { create: { version: 1, plannedStart: planned.start, plannedEnd: planned.end,
            breakMinutes: planned.breakMinutes, createdBy: actorId } },
        } });
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SCHEDULE',
          entityId: schedule.id, action: 'CREATE_DRAFT_BATCH', afterData: {
            employeeId: String(assignment.employeeId), storeId: String(storeId),
            shiftTemplateId: String(template.id), shiftTemplateName: template.name,
            pointId: String(point.id), pointName: point.name,
            businessDate: dateOnly(day), plannedStart: planned.start.toISOString(),
            plannedEnd: planned.end.toISOString(), batchSize: assignments.length,
          } } });
        created.push({ id: Number(schedule.id), employeeId: Number(assignment.employeeId),
          shiftTemplateId: Number(template.id), pointId: Number(point.id), pointName: point.name,
          status: schedule.status, version: schedule.currentVersion });
      }
      return { created, count: created.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async revise(user: AuthContext | undefined, scheduleIdInput: unknown, input: Record<string, unknown>) {
    const scheduleId = positiveId(scheduleIdInput);
    const expectedVersion = Number(input.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new BadRequestException('Expected version is required');
    const preview = await this.db.hrSchedule.findUnique({ where: { id: scheduleId } });
    if (!preview || preview.status === HrScheduleStatus.CANCELED) throw new ConflictException('Schedule is unavailable');
    const shiftTemplateId = positiveId(input.shiftTemplateId);
    const pointWasProvided = Object.prototype.hasOwnProperty.call(input, 'pointId');
    const pointId = !pointWasProvided || input.pointId === null || input.pointId === ''
      ? null : positiveId(input.pointId);
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_REVISE', preview.storeId);
    if (dateOnly(preview.businessDate) < shanghaiDate()) throw new BadRequestException('Past schedules cannot be revised');
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${preview.employeeId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hr_schedules WHERE id = ${scheduleId} FOR UPDATE`;
      const current = await tx.hrSchedule.findUnique({ where: { id: scheduleId } });
      if (!current || current.currentVersion !== expectedVersion || current.status === HrScheduleStatus.CANCELED)
        throw new ConflictException('Schedule changed; reload');
      await tx.$queryRaw`SELECT id FROM hr_shift_templates WHERE id = ${shiftTemplateId} FOR SHARE`;
      const template = await tx.hrShiftTemplate.findFirst({ where: {
        id: shiftTemplateId, storeId: current.storeId, enabled: true,
      } });
      if (!template) throw new ConflictException('Select an active shift template for this store');
      const point = pointId == null ? null : await tx.hrSchedulePoint.findFirst({ where: {
        id: pointId, storeId: current.storeId, enabled: true,
      } });
      if (pointId != null && !point) throw new ConflictException('Select an active point for this store');
      const planned = templateInterval(current.businessDate, template);
      await this.assertEligible(tx, current.employeeId, current.storeId, current.businessDate);
      await this.assertNoOverlap(tx, current.employeeId, current.businessDate, planned.start, planned.end, current.id);
      const version = current.currentVersion + 1;
      await tx.hrScheduleVersion.create({ data: { scheduleId, version,
        plannedStart: planned.start, plannedEnd: planned.end, breakMinutes: planned.breakMinutes, createdBy: actorId } });
      await tx.hrSchedule.update({ where: { id: scheduleId }, data: {
        currentVersion: version, status: HrScheduleStatus.DRAFT, shiftTemplateId,
        ...(pointWasProvided ? { pointId: point?.id ?? null, pointName: point?.name ?? null } : {}),
      } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_SCHEDULE', entityId: scheduleId, action: 'REVISE',
        afterData: { version, shiftTemplateId: String(shiftTemplateId), shiftTemplateName: template.name,
          ...(pointWasProvided ? { pointId: point ? String(point.id) : null, pointName: point?.name ?? null } : {}),
          plannedStart: planned.start.toISOString(), plannedEnd: planned.end.toISOString() },
      } });
      return { id: Number(scheduleId), version, status: HrScheduleStatus.DRAFT };
    });
  }

  async cancelDraft(user: AuthContext | undefined, scheduleIdInput: unknown, expectedVersionInput: unknown) {
    const scheduleId = positiveId(scheduleIdInput);
    const expectedVersion = Number(expectedVersionInput);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new BadRequestException('Expected version is required');
    const preview = await this.db.hrSchedule.findUnique({ where: { id: scheduleId } });
    if (!preview || (preview.status !== HrScheduleStatus.DRAFT && preview.status !== HrScheduleStatus.PUBLISHED))
      throw new ConflictException('Schedule is unavailable');
    await this.access.assertStorePermission(user,
      preview.status === HrScheduleStatus.PUBLISHED ? 'HR_SCHEDULE_REVISE' : 'HR_SCHEDULE_DRAFT_DELETE',
      preview.storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${preview.employeeId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hr_schedules WHERE id = ${scheduleId} FOR UPDATE`;
      const current = await tx.hrSchedule.findUnique({ where: { id: scheduleId } });
      if (!current || (current.status !== HrScheduleStatus.DRAFT && current.status !== HrScheduleStatus.PUBLISHED) ||
        current.currentVersion !== expectedVersion)
        throw new ConflictException('Schedule changed; reload and retry');
      const wasPublished = current.status === HrScheduleStatus.PUBLISHED;
      if (wasPublished) {
        const workRecord = await tx.hrWorkRecord.findUnique({ where: { scheduleId }, include: {
          versions: { orderBy: { version: 'desc' }, take: 1, include: { daySegments: true } },
        } });
        const latestWork = workRecord?.versions?.[0];
        const alreadyRemoved = Boolean(latestWork && latestWork.version === workRecord?.currentVersion &&
          latestWork.rawMinutes === 0 && latestWork.daySegments.length === 0);
        if (workRecord && !alreadyRemoved)
          throw new ConflictException('Confirmed work hours exist; submit a time correction before removing this shift');
        await tx.hrScheduleDelivery.updateMany({
          where: { scheduleId, version: current.currentVersion, status: 'QUEUED' },
          data: { status: 'FAILED', reasonCode: 'SCHEDULE_CANCELED' },
        });
      }
      await tx.hrSchedule.update({ where: { id: scheduleId }, data: { status: HrScheduleStatus.CANCELED } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_SCHEDULE', entityId: scheduleId,
        action: wasPublished ? 'CANCEL_PUBLISHED' : 'CANCEL_DRAFT',
        beforeData: { employeeId: String(current.employeeId), storeId: String(current.storeId),
          businessDate: dateOnly(current.businessDate), status: current.status,
          version: current.currentVersion, shiftTemplateId: current.shiftTemplateId == null ? null : String(current.shiftTemplateId) },
        afterData: { status: HrScheduleStatus.CANCELED, wasPublished },
      } });
      return { id: Number(scheduleId), status: HrScheduleStatus.CANCELED, wasPublished };
    });
  }

  async publish(user: AuthContext | undefined, scheduleIdInput: unknown) {
    const scheduleId = positiveId(scheduleIdInput);
    const preview = await this.db.hrSchedule.findUnique({ where: { id: scheduleId } });
    if (!preview || preview.status === HrScheduleStatus.CANCELED) throw new ConflictException('Schedule is unavailable');
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_PUBLISH', preview.storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_employees WHERE id = ${preview.employeeId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hr_schedules WHERE id = ${scheduleId} FOR UPDATE`;
      const current = await tx.hrSchedule.findUnique({
        where: { id: scheduleId }, include: { versions: true },
      });
      if (!current || current.status !== HrScheduleStatus.DRAFT || current.currentVersion !== preview.currentVersion)
        throw new ConflictException('Schedule changed; reload');
      const currentVersion = current.versions.find((item) => item.version === current.currentVersion);
      if (!currentVersion) throw new ConflictException('Schedule version is missing');
      await this.assertEligible(tx, current.employeeId, current.storeId, current.businessDate);
      await this.assertNoOverlap(tx, current.employeeId, current.businessDate, currentVersion.plannedStart, currentVersion.plannedEnd, scheduleId);
      await tx.hrScheduleVersion.update({ where: { scheduleId_version: { scheduleId, version: current.currentVersion } },
        data: { publishedAt: new Date() } });
      await tx.hrSchedule.update({ where: { id: scheduleId }, data: { status: HrScheduleStatus.PUBLISHED } });
      const employee = await tx.hrEmployee.findUnique({ where: { id: current.employeeId },
        select: { user: { select: { id: true, status: true, openid: true } } } });
      const configured = Boolean(scheduleTemplateConfig());
      const bound = Boolean(employee?.user?.status && employee.user.openid);
      const deliveryStatus = configured && bound ? 'QUEUED' : 'UNAVAILABLE';
      const wasPreviouslyPublished = current.versions.some((item) => item.version < current.currentVersion && item.publishedAt != null);
      if (employee?.user?.status) await tx.userNotification.createMany({
        data: [{
          userId: employee.user.id,
          category: 'SCHEDULE',
          title: wasPreviouslyPublished ? '排班调整通知' : '新排班已发布',
          summary: `${dateOnly(current.businessDate)} ${scheduleClock(currentVersion.plannedStart)}–${scheduleClock(currentVersion.plannedEnd)}`,
          page: 'pages/hr/my-schedule',
          eventKey: `hr:schedule:${current.id}:version:${current.currentVersion}`,
        }],
        skipDuplicates: true,
      });
      await tx.hrScheduleDelivery.create({ data: { scheduleId, version: current.currentVersion,
        status: deliveryStatus,
        reasonCode: configured ? bound ? null : 'RECIPIENT_NOT_BOUND' : 'SCHEDULE_TEMPLATE_NOT_CONFIGURED' } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_SCHEDULE', entityId: scheduleId, action: 'PUBLISH',
        afterData: { version: current.currentVersion, notification: deliveryStatus },
      } });
      return { id: Number(scheduleId), status: HrScheduleStatus.PUBLISHED,
        version: current.currentVersion, deliveryStatus };
    });
  }

  async publishBatch(user: AuthContext | undefined, input: Record<string, unknown>) {
    if (!Array.isArray(input.scheduleIds) || input.scheduleIds.length < 1 || input.scheduleIds.length > 300)
      throw new BadRequestException('Select between 1 and 300 draft shifts to publish');
    const scheduleIds = input.scheduleIds.map(positiveId);
    if (new Set(scheduleIds.map(String)).size !== scheduleIds.length)
      throw new BadRequestException('Duplicate schedule IDs are not allowed');
    const preview = await this.db.hrSchedule.findMany({ where: { id: { in: scheduleIds } },
      select: { id: true, employeeId: true, storeId: true, businessDate: true } });
    if (preview.length !== scheduleIds.length) throw new ConflictException('Some draft shifts are unavailable; refresh and retry');
    const storeId = positiveId(input.storeId ?? preview[0].storeId);
    const day = input.businessDate == null ? preview[0].businessDate : businessDate(input.businessDate);
    if (preview.some((row) => row.storeId !== storeId || dateOnly(row.businessDate) !== dateOnly(day)))
      throw new BadRequestException('Publish one store and one date at a time');
    await this.access.assertStorePermission(user, 'HR_SCHEDULE_PUBLISH', storeId);
    const actorId = BigInt(user!.id!);
    return this.db.$transaction(async (tx) => {
      const employeeIds = [...new Set(preview.map((item) => item.employeeId.toString()))]
        .map((value) => BigInt(value)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      const sortedScheduleIds = [...scheduleIds].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM hr_employees
        WHERE id IN (${Prisma.join(employeeIds)}) ORDER BY id FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM hr_schedules
        WHERE id IN (${Prisma.join(sortedScheduleIds)}) ORDER BY id FOR UPDATE`);
      const rows = await tx.hrSchedule.findMany({ where: { id: { in: scheduleIds } },
        include: { versions: true } });
      if (rows.length !== scheduleIds.length || rows.some((row) => row.status !== HrScheduleStatus.DRAFT))
        throw new ConflictException('Only current draft shifts can be published; refresh and retry');
      for (const row of rows) {
        const version = row.versions.find((item) => item.version === row.currentVersion);
        if (!version) throw new ConflictException('A schedule version is missing');
        await this.assertEligible(tx, row.employeeId, row.storeId, row.businessDate);
        await this.assertNoOverlap(tx, row.employeeId, row.businessDate,
          version.plannedStart, version.plannedEnd, row.id);
      }
      const configured = Boolean(scheduleTemplateConfig());
      const published = [];
      for (const row of rows) {
        const version = row.versions.find((item) => item.version === row.currentVersion);
        if (!version) throw new ConflictException('A schedule version is missing');
        const wasPreviouslyPublished = row.versions.some((item) => item.version < row.currentVersion && item.publishedAt != null);
        await tx.hrScheduleVersion.update({
          where: { scheduleId_version: { scheduleId: row.id, version: row.currentVersion } },
          data: { publishedAt: new Date() },
        });
        await tx.hrSchedule.update({ where: { id: row.id }, data: { status: HrScheduleStatus.PUBLISHED } });
        const employee = await tx.hrEmployee.findUnique({ where: { id: row.employeeId },
          select: { user: { select: { id: true, status: true, openid: true } } } });
        const bound = Boolean(employee?.user?.status && employee.user.openid);
        const deliveryStatus = configured && bound ? 'QUEUED' : 'UNAVAILABLE';
        if (employee?.user?.status) await tx.userNotification.createMany({
          data: [{
            userId: employee.user.id,
            category: 'SCHEDULE',
            title: wasPreviouslyPublished ? '排班调整通知' : '新排班已发布',
            summary: `${dateOnly(row.businessDate)} ${scheduleClock(version.plannedStart)}–${scheduleClock(version.plannedEnd)}`,
            page: 'pages/hr/my-schedule',
            eventKey: `hr:schedule:${row.id}:version:${row.currentVersion}`,
          }],
          skipDuplicates: true,
        });
        await tx.hrScheduleDelivery.create({ data: { scheduleId: row.id, version: row.currentVersion,
          status: deliveryStatus, reasonCode: configured ? bound ? null : 'RECIPIENT_NOT_BOUND' : 'SCHEDULE_TEMPLATE_NOT_CONFIGURED' } });
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_SCHEDULE',
          entityId: row.id, action: 'PUBLISH_BATCH', afterData: {
            version: row.currentVersion, notification: deliveryStatus, batchSize: rows.length,
          } } });
        published.push({ id: Number(row.id), status: HrScheduleStatus.PUBLISHED,
          version: row.currentVersion, deliveryStatus });
      }
      return { published, count: published.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async assertEligible(tx: Prisma.TransactionClient, employeeId: bigint, storeId: bigint, day: Date) {
    const employee = await tx.hrEmployee.findUnique({ where: { id: employeeId }, select: {
      status: true, initialStoreId: true, trialStartedAt: true,
      user: { select: { hrRoleGrants: { where: { active: true },
        select: { role: { select: { enabled: true, participatesInScheduling: true } } } } } },
    } });
    const appointment = await tx.hrPrimaryAppointment.findFirst({ where: {
      employeeId, storeId, effectiveFrom: { lte: day },
      OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: day } }],
    } });
    const trialWorkDate = employee?.trialStartedAt != null && employee.initialStoreId === storeId &&
      employee.trialStartedAt <= day && (!appointment || appointment.effectiveFrom > day);
    const activeAssignment = employee?.status === HrEmployeeStatus.ACTIVE && appointment != null;
    if (!(activeAssignment || (employee?.status === HrEmployeeStatus.TRIAL && trialWorkDate) ||
        (employee?.status === HrEmployeeStatus.ACTIVE && trialWorkDate)))
      throw new ConflictException('Employee is not active in this store on the business date');
    if (!trialWorkDate && !roleAllowsScheduling(employee?.user?.hrRoleGrants))
      throw new ConflictException('Employee role is not enabled for scheduling');
    const departure = await tx.hrOffboardingRequest.findFirst({ where: {
      employeeId, effectiveDate: { lte: day },
      status: { in: ['SUBMITTED', 'APPROVED_AWAITING_EFFECTIVE', 'EFFECTIVE'] },
    }, select: { id: true } });
    if (departure) throw new ConflictException('Employee has an offboarding request for this date');
  }

  private async assertNoOverlap(tx: Prisma.TransactionClient, employeeId: bigint, day: Date,
    start: Date, end: Date, excludeScheduleId?: bigint) {
    const previousDay = new Date(day.getTime() - 86400000);
    const nextDay = new Date(day.getTime() + 86400000);
    const schedules = await tx.hrSchedule.findMany({ where: {
      employeeId, businessDate: { gte: previousDay, lte: nextDay },
      status: { not: HrScheduleStatus.CANCELED },
      ...(excludeScheduleId ? { id: { not: excludeScheduleId } } : {}),
    }, include: { versions: true } });
    for (const schedule of schedules) {
      const current = schedule.versions.find((item) => item.version === schedule.currentVersion);
      if (current && start < current.plannedEnd && current.plannedStart < end)
        throw new ConflictException('Employee has an overlapping schedule');
    }
  }
}
