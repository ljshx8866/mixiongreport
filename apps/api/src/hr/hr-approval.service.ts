import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { HrApprovalKind, HrApprovalStatus, HrTransferDecisionType, Prisma } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrApprovalNotificationService } from './hr-approval-notification.service';

const approvePermission: Record<HrApprovalKind, string> = {
  TIME_CORRECTION: 'HR_TIME_CORRECTION_EDIT',
  SALARY_CHANGE: 'HR_SALARY_CHANGE_APPROVE',
  MONTHLY_REVIEW: 'HR_MONTH_APPROVE',
  ONBOARDING: 'HR_ONBOARDING_APPROVE',
  OFFBOARDING: 'HR_OFFBOARDING_APPROVE',
  BANK_CHANGE: 'HR_BANK_CHANGE_APPROVE',
};

/** Approval config is snapshotted in the request transaction by its owner service. */
@Injectable()
export class HrApprovalService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly notifications?: HrApprovalNotificationService) {}

  async createForSubject(tx: Prisma.TransactionClient, kind: HrApprovalKind,
    subjectId: bigint, scopeStoreId: bigint, requestedBy: bigint, notificationRound = 1) {
    if (subjectId <= 0n || scopeStoreId <= 0n || requestedBy <= 0n)
      throw new BadRequestException('审批申请信息无效，请刷新后重试。');
    await tx.$queryRaw`SELECT kind FROM hr_approval_workflows WHERE kind = ${kind} FOR SHARE`;
    const workflow = await tx.hrApprovalWorkflow.findUnique({
      where: { kind }, include: { steps: { orderBy: { position: 'asc' }, include: { role: true } } },
    });
    if (!workflow?.steps.length || workflow.steps.some((step, index) =>
      step.position !== index + 1 || !step.role.enabled))
      throw new ConflictException('审批流程尚未配置有效的审批角色，请管理员检查人事审批流程设置。');
    const instance = await tx.hrApprovalInstance.create({ data: {
      kind, subjectId, scopeStoreId, requestedBy, workflowVersion: workflow.version,
      steps: { create: workflow.steps.map((step) => ({ position: step.position, roleId: step.roleId })) },
    } });
    const firstStep = workflow.steps[0];
    if (firstStep) await this.notifications?.queueApprovalStep(tx, {
      kind, subjectId, scopeStoreId, requestedBy, position: firstStep.position,
      roleId: firstStep.roleId, round: notificationRound,
    });
    return instance;
  }

  /** Reuses a terminal approval instance for a new revision of the same request.
   * The prior decisions are copied to the request audit log before its live steps are reset.
   */
  async restartForSubject(tx: Prisma.TransactionClient, kind: HrApprovalKind,
    subjectId: bigint, requestedBy: bigint, round: number, scopeStoreId?: bigint) {
    if (subjectId <= 0n || requestedBy <= 0n || !Number.isSafeInteger(round) || round < 2)
      throw new BadRequestException('审批申请版本无效，请刷新后重试。');
    await tx.$queryRaw`SELECT kind FROM hr_approval_workflows WHERE kind = ${kind} FOR SHARE`;
    const workflow = await tx.hrApprovalWorkflow.findUnique({
      where: { kind }, include: { steps: { orderBy: { position: 'asc' }, include: { role: true } } },
    });
    if (!workflow?.steps.length || workflow.steps.some((step, index) =>
      step.position !== index + 1 || !step.role.enabled))
      throw new ConflictException('审批流程尚未配置有效的审批角色，请管理员检查人事审批流程设置。');
    const current = await tx.hrApprovalInstance.findUnique({
      where: { kind_subjectId: { kind, subjectId } },
      include: { steps: { orderBy: { position: 'asc' }, include: { role: { select: { name: true } } } } },
    });
    if (!current || current.status === HrApprovalStatus.PENDING)
      throw new ConflictException('上一轮审批记录仍在处理中或已失效，请刷新申请后重试。');

    const nextScopeStoreId = scopeStoreId ?? current.scopeStoreId;

    await tx.auditLog.create({ data: {
      userId: requestedBy, entityType: `HR_${kind}`, entityId: subjectId,
      action: 'APPROVAL_ROUND_ARCHIVED',
      beforeData: { approvalId: String(current.id), status: current.status,
        currentPosition: current.currentPosition, requestedBy: String(current.requestedBy),
        workflowVersion: current.workflowVersion,
        steps: current.steps.map((step) => ({ position: step.position, roleId: String(step.roleId),
          roleName: step.role.name, decision: step.decision, actorId: step.actorId == null ? null : String(step.actorId),
          reason: step.reason, decidedAt: step.decidedAt?.toISOString() ?? null })) },
      afterData: { revision: round, restartedBy: String(requestedBy) },
    } });

    // Old queued reminders must not become actionable after the same approval instance is reopened.
    await tx.hrApprovalNotification.updateMany({ where: {
      subject: 'APPROVAL', subjectId, status: 'QUEUED',
      purpose: { in: ['PENDING', 'CORRECTION'] },
    }, data: { status: 'FAILED', reasonCode: 'SUPERSEDED_BY_RESUBMIT' } });
    await tx.hrApprovalInstanceStep.deleteMany({ where: { instanceId: current.id } });
    await tx.hrApprovalInstanceStep.createMany({ data: workflow.steps.map((step) => ({
      instanceId: current.id, position: step.position, roleId: step.roleId,
    })) });
    const restarted = await tx.hrApprovalInstance.update({ where: { id: current.id }, data: {
      requestedBy, scopeStoreId: nextScopeStoreId, workflowVersion: workflow.version, status: HrApprovalStatus.PENDING,
      currentPosition: workflow.steps[0].position,
    } });
    const firstStep = workflow.steps[0];
    if (firstStep) await this.notifications?.queueApprovalStep(tx, {
      kind, subjectId, scopeStoreId: nextScopeStoreId, requestedBy,
      position: firstStep.position, roleId: firstStep.roleId, round,
    });
    return restarted;
  }

  async decide(user: AuthContext | undefined, instanceId: bigint,
    decision: HrTransferDecisionType, reason: string,
    onTerminalDecision?: (tx: Prisma.TransactionClient, status: HrApprovalStatus) => Promise<void>) {
    if (instanceId <= 0n || !Object.values(HrTransferDecisionType).includes(decision))
      throw new BadRequestException('审批操作无效，请刷新申请后重试。');
    if (decision === HrTransferDecisionType.REJECT && !reason.trim())
      throw new BadRequestException('请填写驳回原因。');
    const preview = await this.db.hrApprovalInstance.findUnique({
      where: { id: instanceId }, include: { steps: { include: { role: { select: { name: true } } } } },
    });
    if (!preview || preview.status !== HrApprovalStatus.PENDING || !preview.currentPosition)
      throw new ConflictException('该审批已处理或已变化，请刷新审批列表。');
    const step = preview.steps.find((item) => item.position === preview.currentPosition);
    if (!step || step.decision) throw new ConflictException('当前审批步骤已处理或不可用，请刷新审批列表。');
    if (!user?.id || BigInt(user.id) === preview.requestedBy)
      throw new ForbiddenException('申请人不能审批本人提交的申请。');
    try {
      await this.access.assertWorkflowRolePermission(user, approvePermission[preview.kind], preview.scopeStoreId, step.roleId);
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      const roleName = typeof step.role?.name === 'string' ? step.role.name : `ID ${step.roleId}`;
      throw new ForbiddenException(
        `当前审批步骤要求“${roleName}”角色，且审批人必须拥有该申请门店的管理权限。请由管理员检查账号的功能角色和管理门店；申请人不能审批本人提交的申请。`,
      );
    }

    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_approval_instances WHERE id = ${instanceId} FOR UPDATE`;
      const current = await tx.hrApprovalInstance.findUnique({
        where: { id: instanceId }, include: { steps: { orderBy: { position: 'asc' } } },
      });
      if (!current || current.status !== HrApprovalStatus.PENDING ||
        current.currentPosition !== preview.currentPosition)
        throw new ConflictException('审批步骤已发生变化，请刷新审批列表后重试。');
      const currentStep = current.steps.find((item) => item.position === current.currentPosition);
      if (!currentStep || currentStep.decision || currentStep.roleId !== step.roleId)
        throw new ConflictException('审批步骤已发生变化，请刷新审批列表后重试。');
      await tx.hrApprovalInstanceStep.update({
        where: { instanceId_position: { instanceId, position: currentStep.position } },
        data: { decision, actorId: BigInt(user.id!), reason: reason.trim() || null, decidedAt: new Date() },
      });
      const next = current.steps.find((item) => item.position === currentStep.position + 1);
      const status = decision === HrTransferDecisionType.REJECT ? HrApprovalStatus.REJECTED :
        next ? HrApprovalStatus.PENDING : HrApprovalStatus.APPROVED;
      const nextPosition = status === HrApprovalStatus.PENDING ? next!.position : null;
      if (status !== HrApprovalStatus.PENDING && onTerminalDecision)
        await onTerminalDecision(tx, status);
      await tx.hrApprovalInstance.update({ where: { id: instanceId },
        data: { status, currentPosition: nextPosition },
      });
      if (status === HrApprovalStatus.APPROVED) {
        const kindNames: Record<HrApprovalKind, string> = {
          TIME_CORRECTION: '工时更正', SALARY_CHANGE: '时薪变更', MONTHLY_REVIEW: '月度工时审核',
          ONBOARDING: '员工入职', OFFBOARDING: '员工离职', BANK_CHANGE: '银行卡变更',
        };
        const resultPageByKind: Record<HrApprovalKind, string> = {
          TIME_CORRECTION: 'pages/hr/correction', SALARY_CHANGE: 'pages/hr/approvals',
          MONTHLY_REVIEW: 'pages/hr/approvals', ONBOARDING: 'pages/hr/onboarding',
          OFFBOARDING: 'pages/hr/offboarding', BANK_CHANGE: 'pages/hr/approvals',
        };
        await tx.userNotification.createMany({
          data: [{
            userId: current.requestedBy,
            category: 'RESULT',
            title: `${kindNames[current.kind]}审批已通过`,
            summary: '你的申请已完成审批。',
            page: `${resultPageByKind[current.kind]}?storeId=${Number(current.scopeStoreId)}`,
            eventKey: `hr:approval:${instanceId}:approved:${currentStep.position}:${new Date().toISOString()}`,
          }],
          skipDuplicates: true,
        });
      }
      if (decision === HrTransferDecisionType.REJECT) {
        await this.notifications?.queueCorrection(tx, {
          kind: current.kind, subjectId: current.subjectId, scopeStoreId: current.scopeStoreId,
          requestedBy: current.requestedBy,
        });
      } else if (next) {
        await this.notifications?.queueApprovalStep(tx, {
          kind: current.kind, subjectId: current.subjectId, scopeStoreId: current.scopeStoreId,
          requestedBy: current.requestedBy, position: next.position, roleId: next.roleId,
        });
      }
      await tx.auditLog.create({ data: {
        userId: BigInt(user.id!), entityType: 'HR_APPROVAL', entityId: instanceId, action: decision,
        afterData: { kind: current.kind, subjectId: String(current.subjectId), position: currentStep.position,
          status, reason: reason.trim() || null },
      } });
      return { id: Number(instanceId), kind: current.kind, subjectId: Number(current.subjectId), status,
        nextPosition };
    });
  }
}

