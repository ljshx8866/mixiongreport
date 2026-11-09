import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { addLegacyHrPermissionDisplayAliases, expandLegacyHrPermissionCodes, hasHrPermission, HR_PERMISSIONS } from '@restaurant/hr-engine';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';

/**
 * HR role grants define what a user may do. The report UserStore mapping is
 * the single source of truth for which stores they may do it in. Employee
 * self-service endpoints are authorized separately through the employee
 * account link and only return that employee's own records.
 */
@Injectable()
export class HrAccessService {
  constructor(private readonly db: PrismaService) {}

  async currentAccess(user: AuthContext | undefined) {
    if (process.env.REPORT_SOURCE !== 'database' || process.env.HR_FEATURES_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR features are not enabled');
    if (!user || user.system || user.id == null || !Number.isSafeInteger(user.id) || user.id <= 0)
      throw new ForbiddenException('HR access requires a user account');
    const todayValue = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const today = new Date(`${todayValue}T00:00:00.000Z`);
    const account = await this.db.user.findUnique({ where: { id: BigInt(user.id) }, select: {
      status: true, role: true,
      stores: { select: { storeId: true } },
      hrEmployee: { select: { id: true, status: true, primaryAppointments: { where: {
        effectiveFrom: { lte: today }, OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }],
      }, select: { storeId: true } } } },
      hrRoleGrants: { select: { active: true,
        role: { select: { enabled: true, name: true, showStoreSwitcher: true,
          permissions: { select: { permissionCode: true } } } } } },
    } });
    if (!account?.status) throw new ForbiddenException('HR access denied');
    const selfEmployee = account.hrEmployee?.status === 'ACTIVE' ? account.hrEmployee : null;
    const grants = account.hrRoleGrants.map((grant) => ({
      active: grant.active, roleEnabled: grant.role.enabled, roleName: grant.role.name,
      showStoreSwitcher: grant.role.showStoreSwitcher,
      permissionCodes: expandLegacyHrPermissionCodes(grant.role.permissions.map((item) => item.permissionCode)),
    }));
    const reportStoreIds = new Set(account.stores.map((item) => item.storeId.toString()));
    const stores = await this.db.store.findMany({ where: { status: true },
      select: { id: true, storeName: true }, orderBy: { id: 'asc' } });
    const roleNames = [...new Set(grants
      .filter((grant) => grant.active && grant.roleEnabled)
      .map((grant) => grant.roleName))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { canConfigure: account.role === UserRole.ADMIN, isEmployee: !!selfEmployee, roleNames,
      showStoreSwitcher: grants.some((grant) => grant.active && grant.roleEnabled && grant.showStoreSwitcher),
      stores: stores.flatMap((store) => {
      const permissionCodes = HR_PERMISSIONS.map(({ code }) => code).filter((code) =>
        reportStoreIds.has(store.id.toString()) && hasHrPermission(account.status, grants, code));
      if (selfEmployee?.primaryAppointments.some((item) => item.storeId === store.id) &&
          !permissionCodes.includes('HR_SCHEDULE_LIST_READ')) permissionCodes.push('HR_SCHEDULE_LIST_READ');
      if (selfEmployee?.primaryAppointments.some((item) => item.storeId === store.id))
        permissionCodes.push('HR_MY_PROFILE_READ', 'HR_MY_SCHEDULE_READ', 'HR_MY_WORK_READ');
      const compatiblePermissionCodes = addLegacyHrPermissionDisplayAliases(permissionCodes);
      return compatiblePermissionCodes.length ? [{ id: Number(store.id), storeName: store.storeName,
        permissionCodes: compatiblePermissionCodes }] : [];
    }) };
  }

  async assertStorePermission(user: AuthContext | undefined, permissionCode: string, storeId: bigint) {
    return this.assertPermission(user, permissionCode, storeId);
  }

  async assertAnyStorePermission(user: AuthContext | undefined, permissionCodes: readonly string[], storeId: bigint) {
    if (!permissionCodes.length) throw new BadRequestException('HR permission is required');
    for (const code of permissionCodes) {
      try { return await this.assertPermission(user, code, storeId); }
      catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
    }
    throw new ForbiddenException('HR access denied');
  }

  async assertWorkflowRolePermission(user: AuthContext | undefined, permissionCode: string, storeId: bigint, roleId: bigint) {
    if (roleId <= 0n) throw new BadRequestException('Invalid HR workflow role');
    return this.assertPermission(user, permissionCode, storeId, roleId);
  }

  private async assertPermission(user: AuthContext | undefined, permissionCode: string, storeId: bigint, requiredRoleId?: bigint) {
    if (process.env.REPORT_SOURCE !== 'database')
      throw new ServiceUnavailableException('HR access requires the database source');
    if (process.env.HR_FEATURES_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR features are not enabled');
    if (!user || user.system || user.id == null || !Number.isSafeInteger(user.id) || user.id <= 0)
      throw new ForbiddenException('HR access requires a user account');
    if (storeId <= 0n || !permissionCode) throw new BadRequestException('Invalid HR permission target');

    // Re-read both resources on every request: POS store mappings
    // must never grant HR access after an account or HR role is disabled.
    const [account, store] = await Promise.all([
      this.db.user.findUnique({
        where: { id: BigInt(user.id) },
        select: {
          status: true,
          stores: { select: { storeId: true } },
          hrRoleGrants: {
            select: {
              active: true, roleId: true,
              role: {
                select: {
                  enabled: true,
                  permissions: { select: { permissionCode: true } },
                },
              },
            },
          },
        },
      }),
      this.db.store.findUnique({ where: { id: storeId }, select: { id: true } }),
    ]);
    if (!account || !store) throw new ForbiddenException('HR access denied');

    if (!account.stores.some((item) => item.storeId === store.id))
      throw new ForbiddenException('HR access denied');

    const grants = account.hrRoleGrants.filter((grant) => requiredRoleId == null || grant.roleId === requiredRoleId).map((grant) => ({
      active: grant.active,
      roleEnabled: grant.role.enabled,
      permissionCodes: expandLegacyHrPermissionCodes(grant.role.permissions.map((item) => item.permissionCode)),
    }));
    if (!hasHrPermission(account.status, grants, permissionCode))
      throw new ForbiddenException('HR access denied');
    return store;
  }
}
