import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HrApprovalKind, HrApprovalStatus, HrTransferStatus, HrTransferStep, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { isTemplateNotificationEnabled, TEMPLATE_NOTIFICATION_IDS, TEMPLATE_NOTIFICATION_KEYS } from '../notification-template-catalog';

export const HR_APPROVAL_TEMPLATE_ID = TEMPLATE_NOTIFICATION_IDS.approval;

const permissionByKind: Record<HrApprovalKind, string> = {
  TIME_CORRECTION: 'HR_TIME_CORRECTION_EDIT',
  SALARY_CHANGE: 'HR_SALARY_CHANGE_APPROVE',
  MONTHLY_REVIEW: 'HR_MONTH_APPROVE',
  ONBOARDING: 'HR_ONBOARDING_APPROVE',
  OFFBOARDING: 'HR_OFFBOARDING_APPROVE',
  BANK_CHANGE: 'HR_BANK_CHANGE_APPROVE',
};

const formNameByKind: Record<HrApprovalKind, string> = {
  TIME_CORRECTION: '工时更正待审批',
  SALARY_CHANGE: '时薪变更待审批',
  MONTHLY_REVIEW: '月度工时待审批',
  ONBOARDING: '员工入职待审批',
  OFFBOARDING: '员工离职待审批',
  BANK_CHANGE: '银行卡变更待审批',
};

const correctionFormNameByKind: Record<HrApprovalKind, string> = {
  TIME_CORRECTION: '工时更正待修改',
  SALARY_CHANGE: '时薪变更待修改',
  MONTHLY_REVIEW: '月度工时待修改',
  ONBOARDING: '员工入职待修改',
  OFFBOARDING: '员工离职待修改',
  BANK_CHANGE: '银行卡变更待修改',
};

const transferPermission: Record<HrTransferStep, string> = {
  SOURCE_STORE: 'HR_TRANSFER_APPROVE_SOURCE',
  DESTINATION_STORE: 'HR_TRANSFER_APPROVE_DESTINATION',
  HR: 'HR_TRANSFER_APPROVE_HR',
};

type EnqueueContext = Pick<Prisma.TransactionClient, 'store' | 'hrRoleGrant' | 'user' | 'userNotification' | '$executeRaw'>;
type NotificationRow = {
  id: bigint; subject: 'APPROVAL' | 'TRANSFER'; subjectId: bigint; stageKey: string;
  purpose: 'PENDING' | 'CORRECTION'; recipientUserId: bigint; formName: string;
  applicantName: string; page: string; status: 'QUEUED' | 'SENT' | 'FAILED';
  reasonCode: string | null; attempts: number;
};
type NotificationInsert = {
  subject: 'APPROVAL' | 'TRANSFER'; subjectId: bigint; stageKey: string;
  purpose: 'PENDING' | 'CORRECTION'; recipientUserId: bigint; formName: string;
  applicantName: string; page: string;
};

export function templateText(value: string, maxLength = 20) {
  return Array.from(value.trim()).slice(0, maxLength).join('') || '待处理事项';
}

export function approvalTemplateData(notification: Pick<NotificationRow, 'formName' | 'applicantName'>) {
  return {
    thing1: { value: templateText(notification.formName) },
    thing2: { value: templateText(notification.applicantName) },
  };
}

function pageForApproval(storeId: bigint) {
  return `pages/hr/approvals?storeId=${Number(storeId)}`;
}

function pageForCorrection(kind: HrApprovalKind, storeId: bigint) {
  const pageByKind: Partial<Record<HrApprovalKind, string>> = {
    ONBOARDING: 'pages/hr/onboarding',
    OFFBOARDING: 'pages/hr/offboarding',
    TIME_CORRECTION: 'pages/hr/correction',
  };
  const page = pageByKind[kind] ?? 'pages/hr/index';
  return `${page}?storeId=${Number(storeId)}`;
}

function codeFromStage(stageKey: string): HrApprovalKind | null {
  const prefix = 'RETURNED_';
  if (!stageKey.startsWith(prefix)) return null;
  const kind = stageKey.slice(prefix.length);
  return Object.values(HrApprovalKind).includes(kind as HrApprovalKind) ? kind as HrApprovalKind : null;
}

@Injectable()
export class HrApprovalNotificationService {
  private readonly logger = new Logger(HrApprovalNotificationService.name);
  private accessToken?: { value: string; expiresAt: number };
  private dispatching = false;

  constructor(private readonly db: PrismaService) {}

  /** Enqueues the first approver(s) in the same transaction that opens a request. */
  async queueApprovalStep(tx: EnqueueContext, input: {
    kind: HrApprovalKind; subjectId: bigint; scopeStoreId: bigint; requestedBy: bigint;
    position: number; roleId: bigint; round?: number;
  }) {
    const applicant = await tx.user.findUnique({ where: { id: input.requestedBy }, select: { name: true } });
    const store = await tx.store.findUnique({ where: { id: input.scopeStoreId }, select: { id: true, status: true } });
    if (!applicant || !store?.id || !store.status) return;
    const recipientIds = await this.roleRecipients(tx, store.id,
      permissionByKind[input.kind], input.roleId, input.requestedBy);
    if (!recipientIds.length) return;
    const rows: NotificationInsert[] = recipientIds.map((recipientUserId) => ({
      subject: 'APPROVAL', subjectId: input.subjectId,
      stageKey: `STEP_${input.kind}_${input.position}${input.round && input.round > 1 ? `_R${input.round}` : ''}`,
      purpose: 'PENDING',
      recipientUserId, formName: formNameByKind[input.kind], applicantName: templateText(applicant.name, 80),
      page: pageForApproval(store.id),
    }));
    await this.enqueue(tx, rows);
  }

  /** A rejected form goes back to its requester for correction. */
  async queueCorrection(tx: EnqueueContext, input: {
    kind: HrApprovalKind; subjectId: bigint; scopeStoreId: bigint; requestedBy: bigint;
  }) {
    const user = await tx.user.findFirst({ where: { id: input.requestedBy, status: true },
      select: { id: true, name: true } });
    if (!user) return;
    await this.enqueue(tx, [{
      subject: 'APPROVAL', subjectId: input.subjectId,
      stageKey: `RETURNED_${input.kind}`, purpose: 'CORRECTION',
      recipientUserId: user.id, formName: correctionFormNameByKind[input.kind],
      applicantName: templateText(user.name, 80), page: pageForCorrection(input.kind, input.scopeStoreId),
    }]);
  }

  /** Transfer approvals use a separate three-party workflow. */
  async queueTransferStep(tx: EnqueueContext, input: {
    subjectId: bigint; requestedBy: bigint; fromStoreId: bigint; toStoreId: bigint;
    nextStep: HrTransferStep;
  }) {
    const storeId = input.nextStep === 'SOURCE_STORE' ? input.fromStoreId : input.toStoreId;
    const [applicant, store] = await Promise.all([
      tx.user.findUnique({ where: { id: input.requestedBy }, select: { name: true } }),
      tx.store.findUnique({ where: { id: storeId }, select: { id: true, status: true } }),
    ]);
    if (!applicant || !store?.id || !store.status) return;
    const recipientIds = await this.roleRecipients(tx, store.id,
      transferPermission[input.nextStep], undefined, input.requestedBy);
    if (!recipientIds.length) return;
    await this.enqueue(tx, recipientIds.map((recipientUserId) => ({
      subject: 'TRANSFER', subjectId: input.subjectId,
      stageKey: input.nextStep, purpose: 'PENDING',
      recipientUserId, formName: '员工转店待审批', applicantName: templateText(applicant.name, 80),
      page: `pages/hr/approvals?storeId=${Number(store.id)}`,
    })));
  }

  async queueTransferCorrection(tx: EnqueueContext, input: { subjectId: bigint; requestedBy: bigint; fromStoreId: bigint }) {
    const user = await tx.user.findFirst({ where: { id: input.requestedBy, status: true },
      select: { id: true, name: true } });
    if (!user) return;
    await this.enqueue(tx, [{
      subject: 'TRANSFER', subjectId: input.subjectId,
      stageKey: 'RETURNED', purpose: 'CORRECTION',
      recipientUserId: user.id, formName: '员工转店待修改', applicantName: templateText(user.name, 80),
      page: `pages/hr/transfer?storeId=${Number(input.fromStoreId)}`,
    }]);
  }

  /** Called only after the mini-program reports that this user accepted this template. */
  async retryOneForUser(userIdInput: unknown) {
    if (process.env.HR_APPROVAL_NOTIFY_ENABLED !== 'true' || process.env.HR_FEATURES_ENABLED !== 'true' ||
        process.env.REPORT_SOURCE !== 'database') return { status: 'DISABLED' };
    const userId = typeof userIdInput === 'number' && Number.isSafeInteger(userIdInput) && userIdInput > 0
      ? BigInt(userIdInput) : null;
    if (!userId) throw new BadRequestException('A valid account is required');
    const recipient = await this.db.user.findFirst({ where: { id: userId, status: true },
      select: { id: true, openid: true } });
    if (!recipient?.openid) return { status: 'UNAVAILABLE', reason: 'RECIPIENT_NOT_BOUND' };
    const [notification] = await this.db.$queryRaw<NotificationRow[]>`SELECT id, subject,
      subject_id AS subjectId, stage_key AS stageKey, purpose,
      recipient_user_id AS recipientUserId, form_name AS formName, applicant_name AS applicantName,
      page, status, reason_code AS reasonCode, attempts
      FROM hr_approval_notifications
      WHERE recipient_user_id = ${userId} AND (status = 'QUEUED' OR
        (status = 'FAILED' AND reason_code IN ('WECHAT_43101', 'RECIPIENT_NOT_BOUND')))
      ORDER BY created_at ASC, id ASC LIMIT 1`;
    if (!notification || !await this.isRelevant(notification)) return { status: 'NONE' };
    if (notification.status === 'FAILED') {
      const claimed = await this.db.$executeRaw`UPDATE hr_approval_notifications
        SET status = 'QUEUED', reason_code = NULL WHERE id = ${notification.id}
        AND status = 'FAILED' AND reason_code IN ('WECHAT_43101', 'RECIPIENT_NOT_BOUND')`;
      if (!claimed) return { status: 'NONE' };
    }
    await this.dispatchOne(notification.id);
    const [result] = await this.db.$queryRaw<Array<{ status: string; reason: string | null }>>`
      SELECT status, reason_code AS reason FROM hr_approval_notifications WHERE id = ${notification.id}`;
    return { status: result?.status ?? 'FAILED', reason: result?.reason ?? null };
  }

  @Cron('*/30 * * * * *', { timeZone: 'Asia/Shanghai' })
  async dispatchQueued() {
    if (this.dispatching || process.env.HR_APPROVAL_NOTIFY_ENABLED !== 'true' ||
      process.env.HR_FEATURES_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database') return;
    this.dispatching = true;
    try {
      await this.enqueueCurrentPending();
      const queued = await this.db.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM hr_approval_notifications
        WHERE status = 'QUEUED' ORDER BY created_at ASC, id ASC LIMIT 30`;
      for (const item of queued) {
        try { await this.dispatchOne(item.id); }
        catch { this.logger.error(`Approval notification ${item.id} failed; see its delivery status`); }
      }
    } finally { this.dispatching = false; }
  }

  private async enqueueCurrentPending() {
    const instances = await this.db.hrApprovalInstance.findMany({
      where: { status: HrApprovalStatus.PENDING, currentPosition: { not: null } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500,
      select: { id: true, kind: true, subjectId: true, scopeStoreId: true, requestedBy: true, currentPosition: true },
    });
    for (const instance of instances) {
      const step = await this.db.hrApprovalInstanceStep.findUnique({ where: {
        instanceId_position: { instanceId: instance.id, position: instance.currentPosition! },
      }, select: { roleId: true } });
      if (!step) continue;
      const onboarding = instance.kind === HrApprovalKind.ONBOARDING
        ? await this.db.hrOnboardingRequest.findUnique({ where: { id: instance.subjectId },
          select: { revision: true } }) : null;
      await this.queueApprovalStep(this.db, { kind: instance.kind, subjectId: instance.subjectId,
        scopeStoreId: instance.scopeStoreId, requestedBy: instance.requestedBy,
        position: instance.currentPosition!, roleId: step.roleId, round: onboarding?.revision ?? 1 });
    }
    const transfers = await this.db.hrTransferRequest.findMany({
      where: { status: HrTransferStatus.PENDING, nextStep: { not: null } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 300,
      select: { id: true, requestedBy: true, fromStoreId: true, toStoreId: true, nextStep: true },
    });
    for (const transfer of transfers) if (transfer.nextStep) {
      await this.queueTransferStep(this.db, { subjectId: transfer.id, requestedBy: transfer.requestedBy,
        fromStoreId: transfer.fromStoreId, toStoreId: transfer.toStoreId, nextStep: transfer.nextStep });
    }
  }

  private async dispatchOne(id: bigint) {
    // Claim before contacting WeChat. If the request times out, do not send a
    // duplicate automatically because WeChat may already have accepted it.
    const claimed = await this.db.$executeRaw`UPDATE hr_approval_notifications
      SET status = 'FAILED', reason_code = 'SEND_INTERRUPTED', attempts = attempts + 1,
      last_attempt_at = NOW(3) WHERE id = ${id} AND status = 'QUEUED'`;
    if (claimed !== 1) return;
    const [notification] = await this.db.$queryRaw<NotificationRow[]>`SELECT id, subject,
      subject_id AS subjectId, stage_key AS stageKey, purpose,
      recipient_user_id AS recipientUserId, form_name AS formName, applicant_name AS applicantName,
      page, status, reason_code AS reasonCode, attempts
      FROM hr_approval_notifications WHERE id = ${id}`;
    if (!notification) return;
    if (!await this.isRelevant(notification)) { await this.fail(id, 'STALE_NOTIFICATION'); return; }
    const recipient = await this.db.user.findFirst({ where: { id: notification.recipientUserId, status: true },
      select: { openid: true, notificationPreferences: true } });
    if (!recipient?.openid) { await this.fail(id, 'RECIPIENT_NOT_BOUND'); return; }
    if (!isTemplateNotificationEnabled(recipient.notificationPreferences, TEMPLATE_NOTIFICATION_KEYS.APPROVAL)) {
      await this.fail(id, 'USER_DISABLED'); return;
    }

    try {
      const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${await this.token()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touser: recipient.openid,
          template_id: process.env.HR_APPROVAL_TEMPLATE_ID?.trim() || HR_APPROVAL_TEMPLATE_ID,
          page: notification.page, data: approvalTemplateData(notification),
          miniprogram_state: process.env.NODE_ENV === 'production' ? 'formal' : 'developer' }),
      });
      const result = await response.json() as { errcode?: number; errmsg?: string; msgid?: number };
      if (!response.ok) { await this.fail(id, 'HTTP_ERROR'); return; }
      if (result.errcode) {
        await this.fail(id, result.errcode === 43101 ? 'WECHAT_43101' : `WECHAT_${result.errcode}`);
        return;
      }
      await this.db.$executeRaw`UPDATE hr_approval_notifications SET status = 'SENT',
        reason_code = NULL, sent_at = NOW(3) WHERE id = ${id}`;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Approval notification ${id} send outcome is uncertain: ${reason.slice(0, 180)}`);
      await this.fail(id, 'SEND_UNCERTAIN');
    }
  }

  private async isRelevant(notification: NotificationRow) {
    const user = await this.db.user.findFirst({ where: { id: notification.recipientUserId, status: true },
      select: { id: true } });
    if (!user) return false;
    if (notification.purpose === 'CORRECTION') {
      if (notification.subject === 'TRANSFER') {
        const transfer = await this.db.hrTransferRequest.findUnique({ where: { id: notification.subjectId },
          select: { status: true, requestedBy: true } });
        return transfer?.status === HrTransferStatus.REJECTED && transfer.requestedBy === notification.recipientUserId;
      }
      const kind = codeFromStage(notification.stageKey);
      if (!kind) return false;
      const requester = await this.rejectedRequester(kind, notification.subjectId);
      return requester === notification.recipientUserId;
    }

    if (notification.subject === 'TRANSFER') {
      const step = Object.values(HrTransferStep).find((value) => value === notification.stageKey);
      if (!step) return false;
      const transfer = await this.db.hrTransferRequest.findUnique({ where: { id: notification.subjectId },
        select: { status: true, nextStep: true, requestedBy: true, fromStoreId: true, toStoreId: true } });
      if (transfer?.status !== HrTransferStatus.PENDING || transfer.nextStep !== step ||
          transfer.requestedBy === notification.recipientUserId) return false;
      const storeId = step === 'SOURCE_STORE' ? transfer.fromStoreId : transfer.toStoreId;
      return this.hasPermission(notification.recipientUserId, storeId, transferPermission[step]);
    }

    const stepMatch = /^STEP_(.+)_(\d+)(?:_R(\d+))?$/.exec(notification.stageKey);
    const kind = stepMatch?.[1] as HrApprovalKind | undefined;
    const position = Number(stepMatch?.[2]);
    const round = stepMatch?.[3] ? Number(stepMatch[3]) : 1;
    if (!kind || !Object.values(HrApprovalKind).includes(kind) || !Number.isSafeInteger(position) || position < 1) return false;
    const instance = await this.db.hrApprovalInstance.findUnique({ where: {
      kind_subjectId: { kind, subjectId: notification.subjectId },
    },
      include: { steps: { where: { position }, select: { roleId: true } } } });
    if (kind === HrApprovalKind.ONBOARDING) {
      const request = await this.db.hrOnboardingRequest.findUnique({
        where: { id: notification.subjectId }, select: { revision: true },
      });
      if (!request || request.revision !== round) return false;
    }
    if (!instance || instance.status !== HrApprovalStatus.PENDING || instance.currentPosition !== position ||
        instance.requestedBy === notification.recipientUserId) return false;
    const currentStep = instance.steps[0];
    return !!currentStep && this.hasPermission(notification.recipientUserId, instance.scopeStoreId,
      permissionByKind[instance.kind], currentStep.roleId);
  }

  private async rejectedRequester(kind: HrApprovalKind, subjectId: bigint) {
    const approval = await this.db.hrApprovalInstance.findUnique({
      where: { kind_subjectId: { kind, subjectId } },
      select: { requestedBy: true, status: true },
    });
    return approval?.status === HrApprovalStatus.REJECTED ? approval.requestedBy : null;
  }

  private async hasPermission(userId: bigint, storeId: bigint, permissionCode: string, roleId?: bigint) {
    const store = await this.db.store.findUnique({ where: { id: storeId }, select: { id: true, status: true } });
    if (!store?.status) return false;
    return !!(await this.db.hrRoleGrant.findFirst({ where: {
      userId, active: true, ...(roleId ? { roleId } : {}),
      user: { is: { status: true, stores: { some: { storeId: store.id } } } },
      role: { is: { enabled: true, permissions: { some: { permissionCode } } } },
    }, select: { id: true } }));
  }

  private async roleRecipients(tx: EnqueueContext, storeId: bigint,
    permissionCode: string, roleId?: bigint, excludeUserId?: bigint) {
    const grants = await tx.hrRoleGrant.findMany({ where: {
      active: true, ...(roleId ? { roleId } : {}),
      user: { is: { status: true, stores: { some: { storeId } } } },
      role: { is: { enabled: true, permissions: { some: { permissionCode } } } },
    }, select: { userId: true } });
    return [...new Set(grants.map((grant) => grant.userId.toString()))]
      .map((value) => BigInt(value)).filter((userId) => userId !== excludeUserId);
  }

  private async fail(id: bigint, reasonCode: string) {
    await this.db.$executeRaw`UPDATE hr_approval_notifications SET status = 'FAILED',
      reason_code = ${reasonCode.slice(0, 80)} WHERE id = ${id}`;
  }

  private async enqueue(tx: EnqueueContext, rows: NotificationInsert[]) {
    if (!rows.length) return;
    await tx.userNotification.createMany({
      data: rows.map((row) => ({
        userId: row.recipientUserId,
        category: row.purpose === 'CORRECTION' ? 'CORRECTION' : 'APPROVAL',
        title: row.formName,
        summary: row.purpose === 'CORRECTION'
          ? '你的申请需要修改，请查看详情并重新提交'
          : `有新的待审批事项，申请人：${row.applicantName}`,
        page: row.page,
        eventKey: `hr:${row.subject}:${row.subjectId}:${row.stageKey}:${row.purpose}:${row.recipientUserId}`,
      })),
      skipDuplicates: true,
    });
    for (const row of rows) await tx.$executeRaw`INSERT IGNORE INTO hr_approval_notifications
      (subject, subject_id, stage_key, purpose, recipient_user_id, form_name, applicant_name, page)
      VALUES (${row.subject}, ${row.subjectId}, ${row.stageKey}, ${row.purpose},
        ${row.recipientUserId}, ${row.formName}, ${row.applicantName}, ${row.page})`;
  }

  private async token() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) return this.accessToken.value;
    const appId = process.env.WECHAT_APP_ID;
    const secret = process.env.WECHAT_APP_SECRET;
    if (!appId || !secret) throw new Error('WECHAT_CONFIG_MISSING');
    const query = new URLSearchParams({ grant_type: 'client_credential', appid: appId, secret });
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
    const result = await response.json() as { access_token?: string; expires_in?: number; errcode?: number };
    if (!response.ok || result.errcode || !result.access_token) throw new Error(`WECHAT_TOKEN_${result.errcode ?? 'FAILED'}`);
    this.accessToken = { value: result.access_token,
      expiresAt: Date.now() + (Math.max(60, result.expires_in ?? 7200) - 300) * 1000 };
    return result.access_token;
  }
}

