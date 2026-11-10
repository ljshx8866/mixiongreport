import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { HrEmployeeStatus, HrSensitiveDraftKind } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Workbook } from 'exceljs';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { loadHrSensitiveCryptoFromEnv, type HrSealedValue } from './hr-sensitive-crypto';

const EMPLOYEE_STATUSES = [HrEmployeeStatus.DRAFT, HrEmployeeStatus.ACTIVE,
  HrEmployeeStatus.TERMINATED] as const;

function dateOnly(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

function dateTime(value: Date | null | undefined): string {
  return value ? value.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '';
}

function employeeStatusLabel(value: string): string {
  return ({ DRAFT: '待入职处理', ACTIVE: '在职', TERMINATED: '已离职' } as Record<string, string>)[value] ?? value;
}

function onboardingStatusLabel(value: string | null | undefined): string {
  if (!value) return '';
  return ({ SUBMITTED: '待审批', APPROVED_AWAITING_EFFECTIVE: '审批通过，待生效',
    REJECTED: '已退回', EFFECTIVE: '已生效', EFFECTIVE_FAILED: '生效异常' } as Record<string, string>)[value] ?? value;
}

function approvalStatusLabel(value: string | null | undefined): string {
  if (!value) return '';
  return ({ PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回' } as Record<string, string>)[value] ?? value;
}

function onboardingFailureLabel(value: string | null | undefined): string {
  if (!value) return '';
  const labels: Record<string, string> = {
    PHONE_REQUIRED: '手机号缺失或格式无效', PHONE_ACCOUNT_LINKED: '手机号已关联其他员工',
    PHONE_ACCOUNT_DISABLED: '手机号对应账号已停用', PHONE_ACCOUNT_AMBIGUOUS: '存在多个手机号相同的账号',
    SOURCE_CHANGED: '入职资料发生变化，请重新核对',
  };
  return labels[value] ?? '请联系管理员核查';
}

@Injectable()
export class HrEmployeeExportService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService) {}

  async generate(user: AuthContext | undefined, input: {
    storeId?: string; status?: string; q?: string;
  }) {
    const access = await this.access.currentAccess(user);
    const listStores = access.stores.filter((store) => store.permissionCodes.includes('HR_EMPLOYEE_LIST_READ'));
    const requestedStoreId = input.storeId ? Number(input.storeId) : null;
    if (input.storeId && (!Number.isSafeInteger(requestedStoreId) || requestedStoreId! <= 0))
      throw new BadRequestException('门店编号无效');
    const scope = requestedStoreId == null ? listStores
      : listStores.filter((store) => store.id === requestedStoreId);
    if (!scope.length) throw new ForbiddenException('没有所选门店的员工列表权限');
    const missing = scope.some((store) => !store.permissionCodes.includes('HR_EMPLOYEE_EXPORT') ||
      !store.permissionCodes.includes('HR_EMPLOYEE_DETAIL_READ') ||
      !store.permissionCodes.includes('HR_EMPLOYEE_SENSITIVE_READ'));
    if (missing) throw new ForbiddenException('导出完整员工档案需要员工导出、员工详情和敏感资料查看权限，请为所选门店配置完整权限');

    const status = input.status && input.status !== 'ALL' ? input.status : null;
    if (status && !EMPLOYEE_STATUSES.some((item) => item === status))
      throw new BadRequestException('员工状态筛选无效');
    const search = typeof input.q === 'string' ? input.q.trim().slice(0, 100) : '';
    const storeIds = scope.map((store) => BigInt(store.id));
    const permittedStoreIds = new Set(storeIds.map((id) => id.toString()));
    const todayValue = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const today = new Date(`${todayValue}T00:00:00.000Z`);
    const employees = await this.db.hrEmployee.findMany({
      where: { OR: [
        { status: HrEmployeeStatus.DRAFT, initialStoreId: { in: storeIds } },
        { status: HrEmployeeStatus.ACTIVE, primaryAppointments: { some: {
          storeId: { in: storeIds }, effectiveFrom: { lte: today },
          OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }],
        } } },
        { status: HrEmployeeStatus.TERMINATED, primaryAppointments: { some: { storeId: { in: storeIds } } } },
      ], ...(status ? { status: status as HrEmployeeStatus } : {}),
        ...(search ? { displayName: { contains: search } } : {}) },
      include: {
        initialStore: { select: { storeName: true } },
        jobPosition: { select: { name: true, scheduleOnly: true } },
        user: { select: { id: true } },
        primaryAppointments: { where: { storeId: { in: storeIds } }, orderBy: { effectiveFrom: 'desc' },
          include: { store: { select: { storeName: true } } } },
        onboardingRequests: { orderBy: { revision: 'desc' }, take: 1, include: {
          store: { select: { id: true, storeName: true } },
          accountHrRole: { select: { name: true } },
          jobPosition: { select: { name: true } },
          salaryRate: { select: { hourlyRate: true } },
        } },
      }, orderBy: { id: 'desc' },
    });

    const employeeIds = employees.map((employee) => employee.id);
    const identityRevisions = employeeIds.length ? await this.db.hrSensitiveDraftRevision.findMany({
      where: { employeeId: { in: employeeIds }, kind: HrSensitiveDraftKind.IDENTITY },
      orderBy: [{ version: 'desc' }, { id: 'desc' }],
      select: { id: true, employeeId: true, sealedPayload: true },
    }) : [];
    const bankVersions = employeeIds.length ? await this.db.hrBankAccountVersion.findMany({
      where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: today },
        OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: today } }] },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      include: { sourceRevision: { select: { id: true, sealedPayload: true } } },
    }) : [];
    const latestIdentity = new Map<string, typeof identityRevisions[number]>();
    for (const revision of identityRevisions)
      if (!latestIdentity.has(revision.employeeId.toString())) latestIdentity.set(revision.employeeId.toString(), revision);
    const currentBank = new Map<string, typeof bankVersions[number]>();
    for (const version of bankVersions)
      if (!currentBank.has(version.employeeId.toString())) currentBank.set(version.employeeId.toString(), version);

    const requestIds = employees.flatMap((employee) => employee.onboardingRequests.map((item) => item.id));
    const approvals = requestIds.length ? await this.db.hrApprovalInstance.findMany({
      where: { kind: 'ONBOARDING', subjectId: { in: requestIds } },
      select: { subjectId: true, status: true },
    }) : [];
    const approvalByRequest = new Map(approvals.map((item) => [item.subjectId.toString(), item.status]));
    const crypto = employeeIds.length ? loadHrSensitiveCryptoFromEnv(process.env) : null;

    const workbook = new Workbook();
    workbook.creator = '米熊经营系统';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('员工完整档案', { views: [{ state: 'frozen', ySplit: 1 }] });
    const headers = ['员工编号', '姓名', '员工状态', '资料姓名', '手机号', '身份证号码', '性别', '民族', '出生日期', '住址',
      '开户姓名', '开户银行', '开户支行', '银行卡号', '登录账号编号', '账号关联情况',
      '入职门店', '门店任职记录', '当前岗位', '仅排班不计工时', '试岗开始日期', '试岗结束时间',
      '入职申请门店', '入职生效日期', '入职申请状态', '入职审批状态', '入职未生效原因', '入职分配人事角色',
      '入职申请岗位', '入职申请时薪（元/小时）', '档案创建时间', '档案更新时间'];
    sheet.columns = headers.map((header, index) => ({ header, key: `column${index + 1}`,
      width: [12, 18, 16, 18, 16, 24, 10, 12, 14, 34, 18, 20, 24, 28, 14, 14,
        42, 18, 16, 16, 22, 18, 16, 18, 16, 30, 20, 18, 20, 22, 22][index] }));
    const heading = sheet.getRow(1);
    heading.height = 26;
    heading.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF20334F' } };
    heading.alignment = { vertical: 'middle', wrapText: true };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

    for (const employee of employees) {
      const identityRevision = latestIdentity.get(employee.id.toString());
      const identity = identityRevision && crypto
        ? crypto.open(employee.id, 'IDENTITY', identityRevision.sealedPayload as unknown as HrSealedValue) : {};
      const bankVersion = currentBank.get(employee.id.toString());
      const bank = bankVersion && crypto
        ? crypto.open(employee.id, 'BANK', bankVersion.sourceRevision.sealedPayload as unknown as HrSealedValue) : {};
      const onboarding = employee.onboardingRequests[0];
      const appointmentHistory = employee.primaryAppointments.map((appointment) =>
        `${appointment.store.storeName}：${dateOnly(appointment.effectiveFrom)}${appointment.effectiveToExclusive
          ? ` 至 ${dateOnly(appointment.effectiveToExclusive)}` : ' 至今'}`)
        .join('；');
      const approvalStatus = onboarding ? approvalByRequest.get(onboarding.id.toString()) : null;
      sheet.addRow([
        employee.id.toString(), employee.displayName, employeeStatusLabel(employee.status),
        typeof identity.name === 'string' ? identity.name : employee.displayName,
        typeof identity.phone === 'string' ? identity.phone : '',
        typeof identity.idNumber === 'string' ? identity.idNumber : '',
        typeof identity.sex === 'string' ? identity.sex : '',
        typeof identity.ethnicity === 'string' ? identity.ethnicity : '',
        typeof identity.birthDate === 'string' ? identity.birthDate : '',
        typeof identity.address === 'string' ? identity.address : '',
        typeof bank.accountName === 'string' ? bank.accountName : '',
        typeof bank.bankName === 'string' ? bank.bankName : '',
        typeof bank.branchName === 'string' ? bank.branchName : '',
        typeof bank.cardNumber === 'string' ? bank.cardNumber : '',
        employee.user?.id.toString() ?? '', employee.user ? '已关联' : '未关联',
        (employee.initialStoreId != null && permittedStoreIds.has(employee.initialStoreId.toString())
          ? employee.initialStore?.storeName : '') ?? '', appointmentHistory,
        employee.jobPosition?.name ?? '', employee.jobPosition?.scheduleOnly ? '是' : '否',
        dateOnly(employee.trialStartedAt), dateTime(employee.trialEndedAt),
        (onboarding && permittedStoreIds.has(onboarding.store.id.toString()) ? onboarding.store.storeName : ''),
        dateOnly(onboarding?.effectiveDate), onboardingStatusLabel(onboarding?.status),
        approvalStatusLabel(approvalStatus), onboardingFailureLabel(onboarding?.failureCode),
        onboarding?.accountHrRole?.name ?? '', onboarding?.jobPosition?.name ?? onboarding?.jobPositionNameSnapshot ?? '',
        onboarding?.salaryRate?.hourlyRate?.toFixed(2) ?? '', dateTime(employee.createdAt), dateTime(employee.updatedAt),
      ]);
    }
    sheet.eachRow((row, rowNumber) => {
      row.alignment = { vertical: 'middle', wrapText: rowNumber > 1 };
      if (rowNumber > 1 && rowNumber % 2 === 0)
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
    });

    const summary = workbook.addWorksheet('导出说明');
    summary.columns = [{ width: 24 }, { width: 78 }];
    summary.addRows([
      ['项目', '内容'], ['导出时间', dateTime(new Date())], ['导出操作者', user?.id == null ? '系统' : `用户 ID ${user.id}`],
      ['员工数量', employees.length], ['门店范围', scope.map((store) => store.storeName).join('、')],
      ['状态筛选', status ? employeeStatusLabel(status) : '全部状态'], ['是否按姓名搜索', search ? '是' : '否'],
      ['敏感字段说明', '本文件包含身份证号码、银行卡号等敏感个人信息，请妥善保管。'],
      ['数据范围说明', '包含所选门店范围内员工档案、当前身份证和银行卡资料、门店任职记录及最近一条入职申请信息。'],
    ]);
    summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF20334F' } };
    summary.eachRow((row) => { row.alignment = { vertical: 'middle', wrapText: true }; });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const exportedAt = new Date();
    await this.db.auditLog.create({ data: {
      userId: user?.id == null ? null : BigInt(user.id), entityType: 'HR_EMPLOYEE_EXPORT', entityId: 0n,
      action: 'EXPORT', afterData: { storeIds: scope.map((store) => String(store.id)), recordCount: employees.length,
        status: status ?? 'ALL', hasNameFilter: !!search, includesSensitiveData: true,
        fileHash, bytes: buffer.length, exportedAt: exportedAt.toISOString() },
    } });
    const dateLabel = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(exportedAt).replaceAll('-', '');
    return { buffer, fileName: `employee-roster-${requestedStoreId ?? 'all'}-${dateLabel}.xlsx` };
  }
}
