import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException,
  Get, Param, ParseIntPipe, Patch, Post, Put, Req, ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { HrApprovalKind, UserRole } from '@prisma/client';
import { ALL_HR_PERMISSION_CODES, expandLegacyHrPermissionCodes, hrPermissionSurfaceLabel, HR_PERMISSIONS, isConfigurableHrPermissionCode } from '@restaurant/hr-engine';
import { type RequestWithUser } from '../auth';
import { PrismaService } from '../prisma.service';

function id(value: unknown): bigint {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid id');
  return BigInt(parsed);
}

const workflowPermission: Record<HrApprovalKind, string> = {
  TIME_CORRECTION: 'HR_TIME_CORRECTION_EDIT',
  SALARY_CHANGE: 'HR_SALARY_CHANGE_APPROVE',
  MONTHLY_REVIEW: 'HR_MONTH_APPROVE',
  ONBOARDING: 'HR_ONBOARDING_APPROVE',
  OFFBOARDING: 'HR_OFFBOARDING_APPROVE',
  BANK_CHANGE: 'HR_BANK_CHANGE_APPROVE',
};
const workflowAuditId: Record<HrApprovalKind, bigint> = {
  TIME_CORRECTION: 1n, SALARY_CHANGE: 2n, MONTHLY_REVIEW: 3n,
  ONBOARDING: 4n,
  OFFBOARDING: 5n,
  BANK_CHANGE: 6n,
};

@Controller('api/hr/access')
export class HrRoleAdminController {
  constructor(private readonly db: PrismaService) {}

  private async administrator(request: RequestWithUser) {
    if (process.env.HR_FEATURES_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR features are not enabled');
    const actor = request.user;
    if (process.env.REPORT_SOURCE !== 'database' || actor?.system || actor?.id == null)
      throw new ForbiddenException('Administrator is required');
    const account = await this.db.user.findUnique({
      where: { id: id(actor.id) }, select: { id: true, role: true, status: true },
    });
    if (!account?.status || account.role !== UserRole.ADMIN)
      throw new ForbiddenException('Administrator is required');
    return account.id;
  }

  @Get('permissions') async permissions(@Req() request: RequestWithUser) {
    await this.administrator(request);
    return HR_PERMISSIONS.map((permission) => ({
      ...permission,
      surface: hrPermissionSurfaceLabel(permission.module),
    }));
  }

  @Get('roles') async roles(@Req() request: RequestWithUser) {
    await this.administrator(request);
    return (await this.db.hrRole.findMany({
      include: { permissions: { select: { permissionCode: true } } }, orderBy: { id: 'asc' },
    })).map((role) => ({
      id: Number(role.id), code: role.code, name: role.name, enabled: role.enabled,
      onboardingAssignable: role.onboardingAssignable,
      participatesInScheduling: role.participatesInScheduling,
      showStoreSwitcher: role.showStoreSwitcher,
      // Render old grants as their equivalent new leaves before edits so saving
      // a legacy role cannot silently remove permissions during the transition.
      permissionCodes: expandLegacyHrPermissionCodes(role.permissions.map((item) => item.permissionCode))
        .filter((code) => HR_PERMISSIONS.some((permission) => permission.code === code)),
    }));
  }

  @Post('roles') async createRole(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    const actorId = await this.administrator(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100)
      throw new BadRequestException('A valid role name is required');
    const role = await this.db.$transaction(async (tx) => {
      // The database id is the human-facing sequence; use a temporary unique
      // code to satisfy the required unique column, then replace it in-tx.
      const created = await tx.hrRole.create({ data: { code: `PENDING_${randomUUID().replaceAll('-', '').toUpperCase()}`, name } });
      const baseCode = `HR-${String(created.id).padStart(4, '0')}`;
      let code = baseCode;
      let suffix = 1;
      while (await tx.hrRole.findUnique({ where: { code }, select: { id: true } })) {
        code = `${baseCode}-${suffix++}`;
      }
      const finalized = await tx.hrRole.update({ where: { id: created.id }, data: { code } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_ROLE', entityId: created.id, action: 'CREATE',
        afterData: { code, name },
      } });
      return finalized;
    });
    return { id: Number(role.id), code: role.code, name, enabled: role.enabled ?? true,
      onboardingAssignable: role.onboardingAssignable ?? false,
      participatesInScheduling: role.participatesInScheduling ?? true,
      showStoreSwitcher: role.showStoreSwitcher ?? false };
  }

  @Patch('roles/:id') async updateRole(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) roleIdValue: number, @Body() body: Record<string, unknown>) {
    const actorId = await this.administrator(request);
    const roleId = id(roleIdValue);
    const existing = await this.db.hrRole.findUnique({ where: { id: roleId } });
    if (!existing) throw new BadRequestException('Role does not exist');
    const name = body.name === undefined ? existing.name : typeof body.name === 'string' ? body.name.trim() : '';
    const enabled = body.enabled === undefined ? existing.enabled : body.enabled;
    const onboardingAssignable = body.onboardingAssignable === undefined
      ? existing.onboardingAssignable : body.onboardingAssignable;
    const participatesInScheduling = body.participatesInScheduling === undefined
      ? existing.participatesInScheduling : body.participatesInScheduling;
    const showStoreSwitcher = body.showStoreSwitcher === undefined
      ? existing.showStoreSwitcher : body.showStoreSwitcher;
    if (!name || name.length > 100 || typeof enabled !== 'boolean' || typeof onboardingAssignable !== 'boolean' ||
      typeof participatesInScheduling !== 'boolean' || typeof showStoreSwitcher !== 'boolean')
      throw new BadRequestException('角色名称、启用状态、入职分配、排班和门店切换显示设置无效');
    const updated = await this.db.$transaction(async (tx) => {
      const current = await tx.hrRole.update({ where: { id: roleId }, data: {
        name, enabled, onboardingAssignable, participatesInScheduling,
        showStoreSwitcher,
      } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_ROLE', entityId: roleId, action: 'UPDATE',
        beforeData: { name: existing.name, enabled: existing.enabled,
          onboardingAssignable: existing.onboardingAssignable,
          participatesInScheduling: existing.participatesInScheduling,
          showStoreSwitcher: existing.showStoreSwitcher },
        afterData: { name, enabled, onboardingAssignable, participatesInScheduling, showStoreSwitcher },
      } });
      return current;
    });
    return { id: Number(updated.id), name: updated.name, enabled: updated.enabled,
      onboardingAssignable: updated.onboardingAssignable,
      participatesInScheduling: updated.participatesInScheduling,
      showStoreSwitcher: updated.showStoreSwitcher };
  }

  @Put('roles/:id/permissions') async replaceRolePermissions(
    @Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) roleId: number,
    @Body() body: { permissionCodes?: unknown },
  ) {
    const actorId = await this.administrator(request);
    if (!Array.isArray(body.permissionCodes) || body.permissionCodes.some((code) => !isConfigurableHrPermissionCode(code)))
      throw new BadRequestException('所选人事权限代码无效，请刷新页面后重试');
    const codes = [...new Set(body.permissionCodes as string[])];
    const available = await this.db.hrPermission.findMany({ where: { code: { in: codes } }, select: { code: true } });
    const availableCodes = new Set(available.map((permission) => permission.code));
    const missingCodes = codes.filter((code) => !availableCodes.has(code));
    if (missingCodes.length)
      throw new ServiceUnavailableException(`系统权限字典缺少以下权限：${missingCodes.join('、')}，请联系管理员更新系统后重试`);
    const role = await this.db.hrRole.findUnique({
      where: { id: id(roleId) }, include: { permissions: { select: { permissionCode: true } } },
    });
    if (!role) throw new BadRequestException('Role does not exist');
    await this.db.$transaction(async (tx) => {
      // Replace only permissions understood by this version. Unknown codes can
      // belong to a newer rollout or another module; preserve them verbatim.
      await tx.hrRolePermission.deleteMany({ where: {
        roleId: role.id, permissionCode: { in: [...ALL_HR_PERMISSION_CODES] },
      } });
      if (codes.length) await tx.hrRolePermission.createMany({
        data: codes.map((permissionCode) => ({ roleId: role.id, permissionCode })),
      });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_ROLE', entityId: role.id, action: 'REPLACE_PERMISSIONS',
        beforeData: { permissionCodes: role.permissions.map((item) => item.permissionCode) },
        afterData: { permissionCodes: codes },
      } });
    });
    return { id: roleId, permissionCodes: codes };
  }

  @Get('grants') async grants(@Req() request: RequestWithUser) {
    await this.administrator(request);
    return (await this.db.hrRoleGrant.findMany({
      include: { role: { select: { code: true, name: true } }, user: { select: { name: true } } },
      orderBy: { id: 'asc' },
    })).map((grant) => ({
      id: Number(grant.id), userId: Number(grant.userId), userName: grant.user.name,
      roleId: Number(grant.roleId), roleCode: grant.role.code, roleName: grant.role.name,
      active: grant.active,
    }));
  }

  @Post('grants') async grant(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    const actorId = await this.administrator(request);
    const userId = id(body.userId);
    const roleId = id(body.roleId);
    if ('scopeKind' in body || 'scopeId' in body)
      throw new BadRequestException('门店范围只在账号的管理门店中设置');
    const [user, role] = await Promise.all([
      this.db.user.findUnique({ where: { id: userId }, select: { status: true } }),
      this.db.hrRole.findUnique({ where: { id: roleId }, select: { enabled: true } }),
    ]);
    if (!user?.status || !role?.enabled) throw new BadRequestException('Active user and role are required');
    const saved = await this.db.$transaction(async (tx) => {
      const grant = await tx.hrRoleGrant.upsert({
        where: { userId_roleId: { userId, roleId } },
        create: { userId, roleId },
        update: { active: true },
      });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_ROLE_GRANT', entityId: grant.id, action: 'GRANT',
        afterData: { userId: String(userId), roleId: String(roleId), roleScope: 'ACCOUNT' },
      } });
      return grant;
    });
    return { id: Number(saved.id), active: saved.active };
  }

  @Delete('grants/:id') async revoke(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) grantId: number) {
    const actorId = await this.administrator(request);
    const old = await this.db.hrRoleGrant.findUnique({ where: { id: id(grantId) } });
    if (!old) throw new BadRequestException('Grant does not exist');
    await this.db.$transaction(async (tx) => {
      await tx.hrRoleGrant.update({ where: { id: old.id }, data: { active: false } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_ROLE_GRANT', entityId: old.id, action: 'REVOKE',
        beforeData: { active: old.active }, afterData: { active: false },
      } });
    });
    return { id: grantId, active: false };
  }

  @Get('workflows') async workflows(@Req() request: RequestWithUser) {
    await this.administrator(request);
    const configured = await this.db.hrApprovalWorkflow.findMany({
      include: { steps: { orderBy: { position: 'asc' }, include: { role: { select: { name: true, enabled: true } } } } },
    });
    return Object.values(HrApprovalKind).map((kind) => {
      const flow = configured.find((item) => item.kind === kind);
      return { kind, version: flow?.version ?? 0, steps: flow?.steps.map((item) => ({
        position: item.position, roleId: Number(item.roleId), roleName: item.role.name,
        roleEnabled: item.role.enabled,
      })) ?? [] };
    });
  }

  @Put('workflows/:kind') async replaceWorkflow(
    @Req() request: RequestWithUser, @Param('kind') kindValue: string,
    @Body() body: { expectedVersion?: unknown; roleIds?: unknown },
  ) {
    const actorId = await this.administrator(request);
    if (!Object.values(HrApprovalKind).includes(kindValue as HrApprovalKind))
      throw new BadRequestException('Invalid HR workflow kind');
    const kind = kindValue as HrApprovalKind;
    if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0)
      throw new BadRequestException('Expected workflow version is required');
    if (!Array.isArray(body.roleIds) || !body.roleIds.length || body.roleIds.length > 10)
      throw new BadRequestException('Workflow requires 1 to 10 approval roles');
    const roleIds = body.roleIds.map(id);
    const roles = await this.db.hrRole.findMany({
      where: { id: { in: roleIds } },
      include: { permissions: { select: { permissionCode: true } } },
    });
    if (roles.length !== new Set(roleIds.map(String)).size || roles.some((role) =>
      !role.enabled || !role.permissions.some((entry) => entry.permissionCode === workflowPermission[kind])))
      throw new BadRequestException('Every approval role must be enabled and have the required permission');

    return this.db.$transaction(async (tx) => {
      await tx.hrApprovalWorkflow.upsert({ where: { kind }, create: { kind }, update: {} });
      await tx.$queryRaw`SELECT kind FROM hr_approval_workflows WHERE kind = ${kind} FOR UPDATE`;
      const current = await tx.hrApprovalWorkflow.findUnique({ where: { kind },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      if (!current || current.version !== body.expectedVersion)
        throw new ConflictException('Workflow changed; reload before saving');
      await tx.hrApprovalWorkflowStep.deleteMany({ where: { kind } });
      await tx.hrApprovalWorkflowStep.createMany({
        data: roleIds.map((roleId, index) => ({ kind, position: index + 1, roleId })),
      });
      const updated = await tx.hrApprovalWorkflow.update({ where: { kind }, data: { version: { increment: 1 } } });
      await tx.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_APPROVAL_WORKFLOW', entityId: workflowAuditId[kind], action: 'REPLACE',
        beforeData: { kind, version: current.version, roleIds: current.steps.map((step) => String(step.roleId)) },
        afterData: { kind, version: updated.version, roleIds: roleIds.map(String) },
      } });
      return { kind, version: updated.version, roleIds: roleIds.map(Number) };
    });
  }
}

