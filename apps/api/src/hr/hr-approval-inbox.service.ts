import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { HrApprovalKind, HrApprovalStatus, HrSensitiveDraftKind, HrTransferStatus } from '@prisma/client';
import type { HrPermissionCode } from '@restaurant/hr-engine';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { loadHrSensitiveCryptoFromEnv, type HrSealedValue } from './hr-sensitive-crypto';

const permissionByKind: Record<HrApprovalKind, HrPermissionCode> = {
  TIME_CORRECTION: 'HR_TIME_CORRECTION_EDIT',
  SALARY_CHANGE: 'HR_SALARY_CHANGE_APPROVE',
  MONTHLY_REVIEW: 'HR_MONTH_APPROVE',
  ONBOARDING: 'HR_ONBOARDING_APPROVE',
  OFFBOARDING: 'HR_OFFBOARDING_APPROVE',
  BANK_CHANGE: 'HR_BANK_CHANGE_APPROVE',
};
const transferPermissions: HrPermissionCode[] = [
  'HR_TRANSFER_APPROVE_SOURCE', 'HR_TRANSFER_APPROVE_DESTINATION', 'HR_TRANSFER_APPROVE_HR',
];
const allApprovalPermissions: HrPermissionCode[] = ['HR_APPROVAL_LIST_READ', ...Object.values(permissionByKind), ...transferPermissions];

type ApprovalDetail = { label: string; value: string };
type Summary = { employeeName: string | null; label: string; submittedAt: Date;
  businessStatus?: string; failureCode?: string | null; details?: ApprovalDetail[];
  sensitiveDetails?: ApprovalDetail[] };
type ApprovalInboxItem = { id: number; kind: string; subjectId: number; storeId: number; storeName: string;
  employeeName: string | null; label: string; submittedAt: string; currentPosition: number | null;
  totalSteps: number; roleName: string; status: string; canDecide: boolean;
  businessStatus?: string; failureCode?: string | null; rejectionReason?: string | null;
  canRetryEffect?: boolean; details: ApprovalDetail[] };

@Injectable()
export class HrApprovalInboxService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  async list(user: AuthContext | undefined, storeIdInput?: unknown) {
    const access = await this.access.currentAccess(user);
    const storeId = storeIdInput == null || storeIdInput === '' ? null : this.parseStoreId(storeIdInput);
    const byStore = new Map(access.stores.map((store) => [store.id, store]));
    const candidateStores = access.stores.filter((store) => (!storeId || store.id === storeId) &&
      allApprovalPermissions.some((permission) => new Set<string>(store.permissionCodes).has(permission)));
    if (storeId && !byStore.has(storeId)) throw new ForbiddenException('HR access denied');
    const ids = candidateStores.map((store) => BigInt(store.id));
    const actorId = user?.id == null ? null : BigInt(user.id);
    const workflowPermissionChecks = new Map<string, Promise<boolean>>();
    const storePermissionChecks = new Map<string, Promise<boolean>>();
    const hasWorkflowPermission = (permission: HrPermissionCode, targetStoreId: bigint, roleId: bigint) => {
      const key = `${targetStoreId}:${permission}:${roleId}`;
      let check = workflowPermissionChecks.get(key);
      if (!check) {
        check = this.access.assertWorkflowRolePermission(user, permission, targetStoreId, roleId)
          .then(() => true).catch((error) => {
            if (error instanceof ForbiddenException) return false;
            throw error;
          });
        workflowPermissionChecks.set(key, check);
      }
      return check;
    };
    const hasTransferPermission = (permission: HrPermissionCode, targetStoreId: bigint) => {
      const key = `${targetStoreId}:${permission}`;
      let check = storePermissionChecks.get(key);
      if (!check) {
        check = this.access.assertStorePermission(user, permission, targetStoreId)
          .then(() => true).catch((error) => {
            if (error instanceof ForbiddenException) return false;
            throw error;
          });
        storePermissionChecks.set(key, check);
      }
      return check;
    };
    const instances = ids.length ? await this.db.hrApprovalInstance.findMany({
      where: { scopeStoreId: { in: ids } },
      include: { steps: { include: { role: { select: { name: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }) : [];

    const visibleInstances = await Promise.all(instances.map(async (instance) => {
      const store = byStore.get(Number(instance.scopeStoreId));
      if (!store) return null;
      const currentStep = instance.currentPosition == null ? undefined :
        instance.steps.find((item) => item.position === instance.currentPosition);
      const lastDecidedStep = [...instance.steps].reverse().find((item) => item.decision != null);
      const displayStep = currentStep ?? lastDecidedStep;
      let canDecide = false;
      if (instance.status === HrApprovalStatus.PENDING && currentStep && actorId != null &&
        actorId !== instance.requestedBy && new Set<string>(store.permissionCodes).has(permissionByKind[instance.kind])) {
        canDecide = await hasWorkflowPermission(permissionByKind[instance.kind],
          instance.scopeStoreId, currentStep.roleId);
      }
      return { instance, step: displayStep, store, canDecide };
    }));

    const authorizedInstances = visibleInstances.filter((item): item is NonNullable<typeof item> => item != null);
    const detailStoreIds = new Set(authorizedInstances.filter(({ store }) =>
      store.permissionCodes.includes('HR_APPROVAL_DETAIL_READ')).map(({ store }) => store.id));
    const sensitiveStoreIds = new Set(authorizedInstances.filter(({ store }) =>
      store.permissionCodes.includes('HR_EMPLOYEE_SENSITIVE_READ')).map(({ store }) => store.id));
    const summaries = await this.loadSummaries(authorizedInstances.map(({ instance }) => instance), actorId,
      detailStoreIds, sensitiveStoreIds);
    const inbox: ApprovalInboxItem[] = authorizedInstances.flatMap(({ instance, step, store, canDecide }) => {
      const summary = summaries.get(`${instance.kind}:${Number(instance.subjectId)}`);
      if (!summary) return [];
      return [{ id: Number(instance.id), kind: instance.kind, subjectId: Number(instance.subjectId),
        storeId: store.id, storeName: store.storeName, employeeName: summary.employeeName,
        label: summary.label, submittedAt: summary.submittedAt.toISOString(),
        currentPosition: instance.currentPosition, totalSteps: instance.steps.length,
        roleName: step?.role.name ?? '审批流程', status: instance.status, canDecide,
        ...(summary.businessStatus ? { businessStatus: summary.businessStatus,
          failureCode: summary.failureCode ?? null } : {}),
        rejectionReason: instance.steps.find((item) => item.decision === 'REJECT')?.reason ?? null,
        details: store.permissionCodes.includes('HR_APPROVAL_DETAIL_READ') ? [{ label: '审批状态', value: instance.status === HrApprovalStatus.PENDING ? '审批中' :
          instance.status === HrApprovalStatus.APPROVED ? '已通过' : '已驳回' },
          { label: '审批进度', value: `${instance.currentPosition ?? instance.steps.length}/${instance.steps.length}` },
          { label: '当前/最近审批角色', value: step?.role.name ?? '—' },
          ...(summary.details ?? []), ...(sensitiveStoreIds.has(store.id) ? summary.sensitiveDetails ?? [] : []),
          ...instance.steps.filter((item) => item.decision != null)
          .map((item) => ({ label: `第 ${item.position} 步 · ${item.role.name}`,
            value: `${item.decision === 'APPROVE' ? '已通过' : '已驳回'}${item.reason ? `：${item.reason}` : ''}` }))] : [] }];
    });

    const transferStores = candidateStores.filter((store) => store.permissionCodes.includes('HR_APPROVAL_LIST_READ') ||
      store.permissionCodes.includes('HR_TRANSFER_LIST_READ') ||
      transferPermissions.some((permission) => new Set<string>(store.permissionCodes).has(permission)));
    const transferStoreIds = transferStores.map((store) => BigInt(store.id));
    const transfers = transferStoreIds.length ? await this.db.hrTransferRequest.findMany({
      where: { OR: [
        { fromStoreId: { in: transferStoreIds } }, { toStoreId: { in: transferStoreIds } },
      ] }, include: { employee: { select: { displayName: true } },
        fromStore: { select: { storeName: true } }, toStore: { select: { storeName: true } },
        decisions: { orderBy: { id: 'asc' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }) : [];
    for (const transfer of transfers) {
      const isPending = transfer.status === HrTransferStatus.PENDING && transfer.nextStep != null;
      const decisionStoreId = isPending
        ? transfer.nextStep === 'SOURCE_STORE' ? transfer.fromStoreId : transfer.toStoreId
        : transfer.fromStoreId;
      const permission: HrPermissionCode | null = isPending
        ? transfer.nextStep === 'SOURCE_STORE' ? 'HR_TRANSFER_APPROVE_SOURCE' :
          transfer.nextStep === 'DESTINATION_STORE' ? 'HR_TRANSFER_APPROVE_DESTINATION' : 'HR_TRANSFER_APPROVE_HR'
        : null;
      let canDecide = false;
      if (permission && actorId != null && transfer.requestedBy !== actorId) {
        canDecide = await hasTransferPermission(permission, decisionStoreId);
      }
      const canRetryEffect = transfer.status === HrTransferStatus.EFFECTIVE_FAILED &&
        transfer.failureCode === 'SOURCE_APPOINTMENT_CONFLICT' &&
        await hasTransferPermission('HR_TRANSFER_APPROVE_HR', transfer.fromStoreId);
      const lastDecision = transfer.decisions.at(-1);
      const roleName = isPending
        ? transfer.nextStep === 'SOURCE_STORE' ? '原店审批' : transfer.nextStep === 'DESTINATION_STORE' ? '新店审批' : '人事审批'
        : lastDecision?.step === 'SOURCE_STORE' ? '原店审批' :
          lastDecision?.step === 'DESTINATION_STORE' ? '新店审批' : lastDecision ? '人事审批' : '审批流程';
      const storeName = isPending
        ? decisionStoreId === transfer.fromStoreId ? transfer.fromStore.storeName : transfer.toStore.storeName
        : `${transfer.fromStore.storeName} → ${transfer.toStore.storeName}`;
      const isLegacy = transfer.decisions.some((item) => item.step === 'SOURCE_STORE');
      const transferDetails: ApprovalDetail[] = [
        { label: '调出门店', value: transfer.fromStore.storeName },
        { label: '调入门店', value: transfer.toStore.storeName },
        { label: '计划生效日', value: date(transfer.requestedEffectiveDate) },
        { label: '转店原因', value: transfer.reason },
        ...transfer.decisions.map((item) => ({ label: `${item.step === 'SOURCE_STORE' ? '原店' : item.step === 'DESTINATION_STORE' ? '新店' : '人事'}审批`,
          value: `${item.decision === 'APPROVE' ? '已通过' : '已驳回'}${item.reason ? `：${item.reason}` : ''}` })),
      ];
      inbox.push({ id: Number(transfer.id), kind: 'TRANSFER', subjectId: Number(transfer.id),
        storeId: Number(decisionStoreId), storeName,
        employeeName: transfer.employee.displayName,
        label: `员工转店：${transfer.fromStore.storeName} → ${transfer.toStore.storeName}`,
        submittedAt: transfer.createdAt.toISOString(), currentPosition: isPending
          ? transfer.decisions.length + 1 : null, totalSteps: isLegacy ? 3 : 2,
        roleName, status: transfer.status, canDecide,
        failureCode: transfer.failureCode, canRetryEffect,
        rejectionReason: transfer.decisions.find((item) => item.decision === 'REJECT')?.reason ?? null,
        details: candidateStores.some((store) => store.id === Number(decisionStoreId) &&
          store.permissionCodes.includes('HR_APPROVAL_DETAIL_READ')) ? transferDetails : [] });
    }
    inbox.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || a.id - b.id);
    return inbox;
  }

  private async loadSummaries(instances: Array<{ kind: HrApprovalKind; subjectId: bigint }>, actorId: bigint | null,
    detailStoreIds: ReadonlySet<number>, sensitiveStoreIds: ReadonlySet<number>) {
    const summaries = new Map<string, Summary>();
    const grouped = new Map<HrApprovalKind, bigint[]>();
    for (const item of instances) grouped.set(item.kind, [...(grouped.get(item.kind) ?? []), item.subjectId]);
    const add = (kind: HrApprovalKind, id: bigint, summary: Summary) => {
      summaries.set(`${kind}:${Number(id)}`, summary);
    };
    const queries: Promise<void>[] = [];
    const idsFor = (kind: HrApprovalKind) => grouped.get(kind) ?? [];
    if (idsFor('ONBOARDING').length) queries.push(this.db.hrOnboardingRequest.findMany({
      where: { id: { in: idsFor('ONBOARDING') } },
      include: { employee: { select: { displayName: true } }, store: { select: { storeName: true } },
        accountHrRole: { select: { name: true } }, jobPosition: { select: { name: true } } },
    }).then(async (rows) => {
      await Promise.all(rows.map(async (row) => {
        const canReadDetails = detailStoreIds.has(Number(row.storeId));
        const canReadSensitive = sensitiveStoreIds.has(Number(row.storeId));
        const revisions = canReadDetails && canReadSensitive ? await this.db.hrSensitiveDraftRevision.findMany({ where: { employeeId: row.employeeId,
          OR: [{ kind: HrSensitiveDraftKind.IDENTITY, version: row.identityVersion },
            { kind: HrSensitiveDraftKind.BANK, version: row.bankVersion }] },
          select: { id: true, kind: true, sealedPayload: true } }) : [];
        const identityRevision = revisions.find((item) => item.kind === HrSensitiveDraftKind.IDENTITY);
        const bankRevision = revisions.find((item) => item.kind === HrSensitiveDraftKind.BANK);
        const crypto = revisions.length ? loadHrSensitiveCryptoFromEnv(process.env) : null;
        const identity = identityRevision && crypto ? crypto.open(row.employeeId, 'IDENTITY',
          identityRevision.sealedPayload as unknown as HrSealedValue) : null;
        const bank = bankRevision && crypto ? crypto.open(row.employeeId, 'BANK',
          bankRevision.sealedPayload as unknown as HrSealedValue) : null;
        add('ONBOARDING', row.id, {
          employeeName: row.employee.displayName, label: `员工入职：${date(row.effectiveDate)}`, submittedAt: row.createdAt,
          businessStatus: row.status, failureCode: row.failureCode,
          details: [{ label: '申请门店', value: row.store?.storeName ?? '—' },
            { label: '生效日期', value: date(row.effectiveDate) },
            { label: '账号角色', value: row.accountHrRole?.name ?? row.accountRole ?? '员工' },
            { label: '岗位', value: row.jobPositionNameSnapshot ?? row.jobPosition?.name ?? '未指定' },
            { label: '岗位类型', value: row.scheduleOnlySnapshot ? '仅排班，不计工时' : '按时薪计算' },
            ...(!row.scheduleOnlySnapshot ? [{ label: '时薪', value: row.hourlyRateSnapshot?.toFixed(2) ?? '—' }] : [])],
          sensitiveDetails: [
            { label: '姓名', value: typeof identity?.name === 'string' ? identity.name : row.employee.displayName },
            { label: '手机号', value: typeof identity?.phone === 'string' ? identity.phone : '—' },
            { label: '身份证号', value: typeof identity?.idNumber === 'string' ? identity.idNumber : '—' },
            { label: '性别 / 民族 / 出生日期', value: [identity?.sex, identity?.ethnicity, identity?.birthDate].filter(Boolean).join(' / ') || '—' },
            { label: '住址', value: typeof identity?.address === 'string' ? identity.address : '—' },
            { label: '开户银行', value: typeof bank?.bankName === 'string' ? bank.bankName : '—' },
            { label: '开户支行', value: typeof bank?.branchName === 'string' ? bank.branchName : '—' },
            { label: '银行卡号', value: typeof bank?.cardNumber === 'string' ? bank.cardNumber : '—' }],
        });
      }));
      if (rows.length && actorId != null && rows.some((row) => detailStoreIds.has(Number(row.storeId)))) await this.db.auditLog.create({ data: {
        userId: actorId, entityType: 'HR_APPROVAL_ONBOARDING', entityId: rows[0].id,
        action: 'VIEW_FULL_ONBOARDING_DETAILS', afterData: { requestIds: rows.map((row) => String(row.id)), count: rows.length },
      } });
    }));
    if (idsFor('OFFBOARDING').length) queries.push(this.db.hrOffboardingRequest.findMany({
      where: { id: { in: idsFor('OFFBOARDING') } },
      include: { employee: { select: { displayName: true } }, store: { select: { storeName: true } } },
    }).then((rows) => rows.forEach((row) => add('OFFBOARDING', row.id, {
      employeeName: row.employee.displayName, label: `员工离职：${date(row.effectiveDate)}`, submittedAt: row.createdAt,
      details: [{ label: '申请门店', value: row.store?.storeName ?? '—' }, { label: '生效日期', value: date(row.effectiveDate) },
        { label: '离职原因', value: row.reason }, { label: '生效时删除账号', value: row.deleteAccountOnEffective ? '是' : '否' }],
    }))));
    if (idsFor('SALARY_CHANGE').length) queries.push(this.db.hrSalaryChangeRequest.findMany({
      where: { id: { in: idsFor('SALARY_CHANGE') } },
      include: { employee: { select: { displayName: true } } },
    }).then((rows) => rows.forEach((row) => add('SALARY_CHANGE', row.id, {
      employeeName: row.employee.displayName, label: `时薪变动：${date(row.effectiveDate)}`, submittedAt: row.createdAt,
      details: [{ label: '新时薪', value: `¥${row.proposedRate.toFixed(2)}/小时` },
        { label: '生效日期', value: date(row.effectiveDate) }, { label: '变更原因', value: row.reason }],
    }))));
    if (idsFor('BANK_CHANGE').length) queries.push(this.db.hrBankChangeRequest.findMany({
      where: { id: { in: idsFor('BANK_CHANGE') } },
      include: { employee: { select: { displayName: true } }, sourceRevision: { select: { maskedValue: true } } },
    }).then((rows) => rows.forEach((row) => add('BANK_CHANGE', row.id, {
      employeeName: row.employee.displayName, label: '银行卡变更', submittedAt: row.createdAt,
      details: [{ label: '新银行卡', value: row.sourceRevision.maskedValue ?? '已加密保存（仅显示脱敏信息）' }],
    }))));
    if (idsFor('MONTHLY_REVIEW').length) queries.push(this.db.hrMonthlyReview.findMany({
      where: { id: { in: idsFor('MONTHLY_REVIEW') } },
    }).then((rows) => rows.forEach((row) => add('MONTHLY_REVIEW', row.id, {
      employeeName: null, label: `月度工时审核：${row.month.toISOString().slice(0, 7)}（第 ${row.revision} 版）`,
      submittedAt: row.submittedAt,
      details: [{ label: '月份', value: row.month.toISOString().slice(0, 7) },
        { label: '版本', value: String(row.revision) }, { label: '状态', value: row.status }],
    }))));
    if (idsFor('TIME_CORRECTION').length) queries.push(this.db.hrTimeCorrection.findMany({
      where: { id: { in: idsFor('TIME_CORRECTION') } },
      include: { record: { include: { employee: { select: { displayName: true } } } } },
    }).then((rows) => rows.forEach((row) => add('TIME_CORRECTION', row.id, {
      employeeName: row.record.employee.displayName, label: `工时更正申请 #${Number(row.id)}`, submittedAt: row.createdAt,
      details: [{ label: '更正后上班时间', value: row.proposedStart.toISOString().slice(0, 16).replace('T', ' ') },
        { label: '更正后下班时间', value: row.proposedEnd.toISOString().slice(0, 16).replace('T', ' ') },
        { label: '更正原因', value: row.reason }],
    }))));
    await Promise.all(queries);
    return summaries;
  }

  private parseStoreId(value: unknown): number {
    const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException('Invalid store id');
    return parsed;
  }
}

function date(value: Date) { return value.toISOString().slice(0, 10); }

