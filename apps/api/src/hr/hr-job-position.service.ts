import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';

function positiveId(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

function parseRate(value: unknown): Prisma.Decimal {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw))
    throw new BadRequestException('Hourly wage must be a positive amount with at most two decimal places');
  const rate = new Prisma.Decimal(raw);
  if (!rate.gt(0)) throw new BadRequestException('Hourly wage must be greater than zero');
  return rate;
}

function storeIds(input: Record<string, unknown>, fallback?: bigint[]): bigint[] {
  const raw = input.storeIds ?? (input.storeId == null ? undefined : [input.storeId]);
  if (raw === undefined) return fallback ?? [];
  if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('Select at least one active store');
  const result = [...new Set(raw.map(positiveId))];
  if (result.length !== raw.length) throw new BadRequestException('Duplicate store selection');
  return result;
}

@Injectable()
export class HrJobPositionService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  private async administrator(user: AuthContext | undefined) {
    if (process.env.HR_FEATURES_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database')
      throw new ServiceUnavailableException('HR features are not enabled');
    if (!user || user.system || user.id == null || !Number.isSafeInteger(user.id) || user.id <= 0)
      throw new ForbiddenException('Administrator is required');
    const account = await this.db.user.findUnique({ where: { id: BigInt(user.id) },
      select: { id: true, role: true, status: true } });
    if (!account?.status || account.role !== UserRole.ADMIN)
      throw new ForbiddenException('Administrator is required');
    return account.id;
  }

  async listForAdmin(user: AuthContext | undefined, storeIdInput?: unknown) {
    await this.administrator(user);
    const storeId = storeIdInput == null || storeIdInput === '' ? null : positiveId(storeIdInput);
    const rows = await this.db.hrJobPosition.findMany({
      where: storeId ? { stores: { some: { storeId } } } : {},
      include: { stores: { include: { store: { select: { id: true, storeName: true } } },
        orderBy: { storeId: 'asc' } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.adminView(row));
  }

  async selectable(user: AuthContext | undefined, storeIdInput: unknown) {
    const storeId = positiveId(storeIdInput);
    await this.access.assertAnyStorePermission(user, ['HR_EMPLOYEE_EDIT', 'HR_ONBOARDING_CREATE'], storeId);
    await this.access.assertAnyStorePermission(user, ['HR_JOB_POSITION_READ', 'HR_ONBOARDING_CREATE'], storeId);
    const rows = await this.db.hrJobPosition.findMany({ where: {
      stores: { some: { storeId, enabled: true } } },
      include: { stores: { where: { storeId, enabled: true }, select: { hourlyRate: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.flatMap((row) => row.stores[0] ? [{ id: Number(row.id), name: row.name,
      scheduleOnly: row.scheduleOnly, hourlyRate: row.stores[0].hourlyRate?.toFixed(2) ?? null }] : []);
  }

  private async assertActiveStores(ids: bigint[]) {
    const active = await this.db.store.findMany({ where: { id: { in: ids }, status: true }, select: { id: true } });
    if (active.length !== ids.length) throw new BadRequestException('All selected stores must be active');
  }

  async create(user: AuthContext | undefined, input: Record<string, unknown>) {
    const actorId = await this.administrator(user);
    const selectedStores = storeIds(input);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) throw new BadRequestException('A valid position name is required');
    const scheduleOnly = input.scheduleOnly === true;
    if (input.scheduleOnly !== undefined && typeof input.scheduleOnly !== 'boolean')
      throw new BadRequestException('Invalid schedule-only setting');
    await this.assertActiveStores(selectedStores);
    const requestedRates = new Map<bigint, Prisma.Decimal>();
    if (!scheduleOnly && input.storeRates !== undefined) {
      if (!Array.isArray(input.storeRates)) throw new BadRequestException('Invalid store wages');
      for (const raw of input.storeRates) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Invalid store wage');
        const item = raw as Record<string, unknown>;
        const storeId = positiveId(item.storeId);
        if (!selectedStores.includes(storeId) || requestedRates.has(storeId))
          throw new BadRequestException('Store wage does not match selected stores');
        requestedRates.set(storeId, parseRate(item.hourlyRate));
      }
      if (requestedRates.size !== selectedStores.length)
        throw new BadRequestException('Enter an hourly wage for each selected store');
    } else if (!scheduleOnly) {
      const hourlyRate = parseRate(input.hourlyRate);
      selectedStores.forEach((storeId) => requestedRates.set(storeId, hourlyRate));
    }
    try {
      return await this.db.$transaction(async (tx) => {
        const position = await tx.hrJobPosition.create({ data: { name, scheduleOnly,
          stores: { create: selectedStores.map((storeId) => ({
          storeId, hourlyRate: requestedRates.get(storeId) ?? null,
        })) } }, include: { stores: { include: { store: { select: { id: true, storeName: true } } },
          orderBy: { storeId: 'asc' } } } });
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_JOB_POSITION',
          entityId: position.id, action: 'CREATE', afterData: { name, scheduleOnly,
            stores: position.stores.map((link) => ({ id: String(link.storeId), name: link.store.storeName,
              hourlyRate: link.hourlyRate?.toFixed(2) ?? null })), enabled: true } } });
        return this.adminView(position);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('This position name already exists');
      throw error;
    }
  }

  async update(user: AuthContext | undefined, positionIdInput: unknown, input: Record<string, unknown>) {
    const actorId = await this.administrator(user);
    const positionId = positiveId(positionIdInput);
    const existing = await this.db.hrJobPosition.findUnique({ where: { id: positionId },
      include: { stores: true } });
    if (!existing) throw new BadRequestException('Position does not exist');
    const name = input.name === undefined ? existing.name : typeof input.name === 'string' ? input.name.trim() : '';
    const scheduleOnly = input.scheduleOnly === undefined ? existing.scheduleOnly : input.scheduleOnly;
    if (typeof scheduleOnly !== 'boolean') throw new BadRequestException('Invalid schedule-only setting');
    const defaultRate = scheduleOnly || input.hourlyRate === undefined ? null : parseRate(input.hourlyRate);
    const enabled = input.enabled;
    const selectedStores = input.storeIds === undefined && input.storeId === undefined
      ? existing.stores.map((link) => link.storeId) : storeIds(input);
    if (!name || name.length > 100 || (enabled !== undefined && typeof enabled !== 'boolean') || selectedStores.length === 0)
      throw new BadRequestException('Valid position name and active stores are required');
    await this.assertActiveStores(selectedStores);
    const requestedRates = new Map<bigint, Prisma.Decimal>();
    if (!scheduleOnly && input.storeRates !== undefined) {
      if (!Array.isArray(input.storeRates)) throw new BadRequestException('Invalid store wages');
      for (const raw of input.storeRates) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Invalid store wage');
        const item = raw as Record<string, unknown>;
        const storeId = positiveId(item.storeId);
        if (!selectedStores.includes(storeId) || requestedRates.has(storeId))
          throw new BadRequestException('Store wage does not match selected stores');
        requestedRates.set(storeId, parseRate(item.hourlyRate));
      }
      if (requestedRates.size !== selectedStores.length)
        throw new BadRequestException('Enter an hourly wage for each selected store');
    }
    for (const storeId of selectedStores) {
      if (scheduleOnly) continue;
      if (!requestedRates.has(storeId) && !defaultRate && !existing.stores.some((link) => link.storeId === storeId))
        throw new BadRequestException('Enter an hourly wage for each newly selected store');
      if (!requestedRates.has(storeId) && !defaultRate &&
        existing.stores.find((link) => link.storeId === storeId)?.hourlyRate == null)
        throw new BadRequestException('Enter an hourly wage before disabling schedule-only mode');
    }
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.hrJobPosition.update({ where: { id: positionId }, data: { name, scheduleOnly } });
        const keep = new Set(selectedStores.map(String));
        const removed = existing.stores.filter((link) => !keep.has(String(link.storeId)));
        if (removed.length) await tx.hrJobPositionStore.deleteMany({ where: { jobPositionId: positionId,
          storeId: { in: removed.map((link) => link.storeId) } } });
        for (const storeId of selectedStores) {
          const old = existing.stores.find((link) => link.storeId === storeId);
          const rate = scheduleOnly ? null : requestedRates.get(storeId) ?? defaultRate ?? old?.hourlyRate;
          if (!scheduleOnly && !rate) throw new BadRequestException('Hourly wage is required for each selected store');
          await tx.hrJobPositionStore.upsert({ where: { jobPositionId_storeId: { jobPositionId: positionId, storeId } },
            create: { jobPositionId: positionId, storeId, hourlyRate: rate, enabled: enabled ?? true },
            update: { ...(scheduleOnly || requestedRates.has(storeId) || defaultRate ? { hourlyRate: rate } : {}),
              ...(enabled === undefined ? {} : { enabled }) } });
        }
        const updated = await tx.hrJobPosition.findUnique({ where: { id: positionId },
          include: { stores: { include: { store: { select: { id: true, storeName: true } } },
            orderBy: { storeId: 'asc' } } } });
        if (!updated) throw new ConflictException('Position was removed');
        await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_JOB_POSITION',
          entityId: positionId, action: 'UPDATE', beforeData: { name: existing.name, scheduleOnly: existing.scheduleOnly,
            enabled: existing.stores.some((link) => link.enabled),
            storeIds: existing.stores.map((link) => String(link.storeId)) },
          afterData: { name, scheduleOnly, enabled: updated.stores.some((link) => link.enabled),
            storeIds: selectedStores.map(String), storeRates: selectedStores.map((storeId) => ({
            storeId: String(storeId), hourlyRate: (requestedRates.get(storeId) ?? defaultRate ??
              existing.stores.find((link) => link.storeId === storeId)?.hourlyRate)?.toFixed(2) ?? null,
          })) } } });
        return this.adminView(updated);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('This position name already exists');
      throw error;
    }
  }

  async remove(user: AuthContext | undefined, positionIdInput: unknown) {
    const actorId = await this.administrator(user);
    const positionId = positiveId(positionIdInput);
    return this.db.$transaction(async (tx) => {
      const existing = await tx.hrJobPosition.findUnique({ where: { id: positionId },
        include: { stores: { include: { store: { select: { storeName: true } } } } } });
      if (!existing) throw new BadRequestException('Position does not exist');
      if (tx.hrEmployee?.findFirst && await tx.hrEmployee.findFirst({ where: { jobPositionId: positionId,
        status: 'ACTIVE' }, select: { id: true } }))
        throw new ConflictException('Move active employees to another position before deleting this position');
      await tx.hrJobPosition.delete({ where: { id: positionId } });
      await tx.auditLog.create({ data: { userId: actorId, entityType: 'HR_JOB_POSITION',
        entityId: positionId, action: 'DELETE', beforeData: { name: existing.name,
          stores: existing.stores.map((link) => ({ name: link.store.storeName,
            hourlyRate: link.hourlyRate?.toFixed(2) ?? null })), scheduleOnly: existing.scheduleOnly }, afterData: { deleted: true,
          historicalRequestNamesPreserved: true } } });
      return { deleted: true, id: Number(positionId) };
    });
  }

  private adminView(row: { id: bigint; name: string; scheduleOnly: boolean; createdAt: Date; updatedAt: Date;
    stores: Array<{ storeId: bigint; hourlyRate: Prisma.Decimal | null; enabled: boolean; store: { id: bigint; storeName: string } }> }) {
    return { id: Number(row.id), name: row.name, scheduleOnly: row.scheduleOnly,
      enabled: row.stores.some((link) => link.enabled),
      stores: row.stores.map((link) => ({ id: Number(link.store.id), storeName: link.store.storeName,
        hourlyRate: link.hourlyRate?.toFixed(2) ?? null, enabled: link.enabled })),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
}
