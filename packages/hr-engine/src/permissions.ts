/**
 * Store-scoped permissions shown in role management. Each entry is an effective
 * action (level 3); domain and module provide the two display-only parent levels.
 */
export type HrPermissionDefinition = {
  code: string;
  name: string;
  domain: string;
  module: string;
};
export type HrPermissionSurface = 'MINIAPP' | 'ADMIN' | 'BOTH';

/** Where each role-controlled module is used; authorization itself is shared. */
export const HR_PERMISSION_SURFACES: Readonly<Record<string, HrPermissionSurface>> = {
  '首页经营数据': 'MINIAPP',
  '每日填报': 'BOTH', '经营日报': 'BOTH', '历史日报': 'BOTH', '填报提醒': 'BOTH',
  '个人资料': 'MINIAPP', '我的排班与工时': 'MINIAPP',
  '门店排班': 'MINIAPP', '班次设置': 'MINIAPP', '点位设置': 'MINIAPP',
  '当日工时确认': 'MINIAPP', '工时统计': 'BOTH', '工时更正': 'MINIAPP', '月度工时审核': 'BOTH',
  '员工档案': 'BOTH', '试岗管理': 'BOTH', '员工入职': 'BOTH', '岗位管理': 'BOTH', '员工离职': 'BOTH',
  '员工转店': 'MINIAPP', '调薪申请': 'BOTH', '银行卡变更': 'BOTH', '审批中心': 'BOTH',
};
export const hrPermissionSurfaceLabel = (module: string): string => {
  const surface = HR_PERMISSION_SURFACES[module] ?? 'BOTH';
  return surface === 'MINIAPP' ? '小程序' : surface === 'ADMIN' ? '后台' : '小程序 + 后台';
};

export const HR_PERMISSIONS = [
  // 经营管理
  { code: 'HR_HOME_SALES_READ', name: '查看经营数据卡片', domain: '经营管理', module: '首页经营数据' },
  { code: 'HR_DAILY_INPUT_WRITE', name: '录入、修改并提交每日填报', domain: '经营管理', module: '每日填报' },
  { code: 'HR_DAILY_REPORT_READ', name: '查看当日经营日报', domain: '经营管理', module: '经营日报' },
  { code: 'HR_DAILY_REPORT_POSTER', name: '生成、保存和转发日报图片', domain: '经营管理', module: '经营日报' },
  { code: 'HR_HISTORY_REPORT_READ', name: '按日期查看历史日报', domain: '经营管理', module: '历史日报' },
  { code: 'HR_REMINDER_READ', name: '查看填报提醒', domain: '经营管理', module: '填报提醒' },
  { code: 'HR_REMINDER_PROCESS', name: '处理填报提醒', domain: '经营管理', module: '填报提醒' },

  // 排班与工时
  { code: 'HR_MY_PROFILE_READ', name: '查看本人资料', domain: '我的', module: '个人资料' },
  { code: 'HR_MY_SCHEDULE_READ', name: '查看本人排班', domain: '我的', module: '我的排班与工时' },
  { code: 'HR_MY_WORK_READ', name: '查看本人确认工时和工时工资', domain: '我的', module: '我的排班与工时' },
  { code: 'HR_SCHEDULE_LIST_READ', name: '查看门店排班列表', domain: '排班与工时', module: '门店排班' },
  { code: 'HR_SCHEDULE_DRAFT_EDIT', name: '新增和修改未发布排班', domain: '排班与工时', module: '门店排班' },
  { code: 'HR_SCHEDULE_DRAFT_DELETE', name: '删除未发布排班', domain: '排班与工时', module: '门店排班' },
  { code: 'HR_SCHEDULE_PUBLISH', name: '发布排班', domain: '排班与工时', module: '门店排班' },
  { code: 'HR_SCHEDULE_REVISE', name: '调整已发布排班并重新发布', domain: '排班与工时', module: '门店排班' },
  { code: 'HR_SHIFT_TEMPLATE_READ', name: '查看班次设置', domain: '排班与工时', module: '班次设置' },
  { code: 'HR_SHIFT_TEMPLATE_EDIT', name: '新增和修改班次', domain: '排班与工时', module: '班次设置' },
  { code: 'HR_SHIFT_TEMPLATE_DELETE', name: '删除班次', domain: '排班与工时', module: '班次设置' },
  { code: 'HR_SCHEDULE_POINT_READ', name: '查看点位设置', domain: '排班与工时', module: '点位设置' },
  { code: 'HR_SCHEDULE_POINT_EDIT', name: '新增和修改点位', domain: '排班与工时', module: '点位设置' },
  { code: 'HR_SCHEDULE_POINT_DELETE', name: '删除点位', domain: '排班与工时', module: '点位设置' },
  { code: 'HR_TIME_LIST_READ', name: '查看当日工时确认列表', domain: '排班与工时', module: '当日工时确认' },
  { code: 'HR_TIME_ADJUST', name: '调整实际上下班和休息时间', domain: '排班与工时', module: '当日工时确认' },
  { code: 'HR_TIME_CONFIRM_ONE', name: '逐人确认工时', domain: '排班与工时', module: '当日工时确认' },
  { code: 'HR_TIME_BULK_CONFIRM', name: '一键确认当前全部班次', domain: '排班与工时', module: '当日工时确认' },
  { code: 'HR_WORK_STATISTICS_READ', name: '查看工时和工时工资统计', domain: '排班与工时', module: '工时统计' },
  { code: 'HR_TIME_CORRECTION_READ', name: '查看工时更正记录', domain: '排班与工时', module: '工时更正' },
  { code: 'HR_TIME_CORRECTION_EDIT', name: '修改已发布工时', domain: '排班与工时', module: '工时更正' },
  { code: 'HR_TIME_CORRECTION_DELETE', name: '删除已发布工时', domain: '排班与工时', module: '工时更正' },
  { code: 'HR_MONTH_LIST_READ', name: '查看月度工时审核列表和详情', domain: '排班与工时', module: '月度工时审核' },
  { code: 'HR_MONTH_SUBMIT', name: '提交月度工时审核', domain: '排班与工时', module: '月度工时审核' },
  { code: 'HR_MONTH_APPROVE', name: '审批月度工时审核', domain: '排班与工时', module: '月度工时审核' },
  { code: 'HR_MONTH_EXPORT', name: '导出月度工时审核', domain: '排班与工时', module: '月度工时审核' },

  // 人事管理
  { code: 'HR_EMPLOYEE_LIST_READ', name: '查看员工列表', domain: '人事管理', module: '员工档案' },
  { code: 'HR_EMPLOYEE_EXPORT', name: '导出员工完整档案（含身份证和银行卡）', domain: '人事管理', module: '员工档案' },
  { code: 'HR_TRIAL_MANAGE', name: '录入和结束试岗', domain: '人事管理', module: '试岗管理' },
  { code: 'HR_EMPLOYEE_DETAIL_READ', name: '查看员工详情', domain: '人事管理', module: '员工档案' },
  { code: 'HR_EMPLOYEE_SENSITIVE_READ', name: '查看完整身份证和银行卡资料', domain: '人事管理', module: '员工档案' },
  { code: 'HR_EMPLOYEE_SENSITIVE_EDIT', name: '修改员工手机号和住址等敏感资料', domain: '人事管理', module: '员工档案' },
  { code: 'HR_EMPLOYEE_EDIT', name: '编辑员工资料和岗位', domain: '人事管理', module: '员工档案' },
  { code: 'HR_EMPLOYEE_ACCOUNT_LINK', name: '关联员工账号', domain: '人事管理', module: '员工档案' },
  { code: 'HR_JOB_POSITION_READ', name: '查看和选择岗位', domain: '人事管理', module: '岗位管理' },
  { code: 'HR_ONBOARDING_CREATE', name: '填写并提交入职申请', domain: '人事管理', module: '员工入职' },
  { code: 'HR_ONBOARDING_LIST_READ', name: '查看入职申请列表', domain: '人事管理', module: '员工入职' },
  { code: 'HR_ONBOARDING_DETAIL_READ', name: '查看入职申请详情', domain: '人事管理', module: '员工入职' },
  { code: 'HR_ONBOARDING_VERIFY', name: '门店核验入职资料', domain: '人事管理', module: '员工入职' },
  { code: 'HR_ONBOARDING_APPROVE', name: '审批入职申请', domain: '人事管理', module: '员工入职' },
  { code: 'HR_OFFBOARDING_REQUEST', name: '发起或重新提交离职申请', domain: '人事管理', module: '员工离职' },
  { code: 'HR_OFFBOARDING_LIST_READ', name: '查看离职申请列表和详情', domain: '人事管理', module: '员工离职' },
  { code: 'HR_OFFBOARDING_APPROVE', name: '审批离职申请', domain: '人事管理', module: '员工离职' },
  { code: 'HR_TRANSFER_REQUEST', name: '发起或重新提交转店申请', domain: '人事管理', module: '员工转店' },
  { code: 'HR_TRANSFER_LIST_READ', name: '查看转店记录和详情', domain: '人事管理', module: '员工转店' },
  { code: 'HR_TRANSFER_APPROVE_SOURCE', name: '审批原店转出', domain: '人事管理', module: '员工转店' },
  { code: 'HR_TRANSFER_APPROVE_DESTINATION', name: '审批新店转入', domain: '人事管理', module: '员工转店' },
  { code: 'HR_TRANSFER_APPROVE_HR', name: '人事终审转店', domain: '人事管理', module: '员工转店' },
  { code: 'HR_SALARY_CHANGE_REQUEST', name: '提交或重新提交调薪申请', domain: '人事管理', module: '调薪申请' },
  { code: 'HR_SALARY_CHANGE_LIST_READ', name: '查看调薪申请列表和详情', domain: '人事管理', module: '调薪申请' },
  { code: 'HR_SALARY_CHANGE_APPROVE', name: '审批调薪申请', domain: '人事管理', module: '调薪申请' },
  { code: 'HR_BANK_CHANGE_SUBMIT', name: '提交或重新提交银行卡变更', domain: '人事管理', module: '银行卡变更' },
  { code: 'HR_BANK_CHANGE_LIST_READ', name: '查看银行卡变更列表和详情', domain: '人事管理', module: '银行卡变更' },
  { code: 'HR_BANK_CHANGE_FULL_READ', name: '查看完整银行卡号', domain: '人事管理', module: '银行卡变更' },
  { code: 'HR_BANK_CHANGE_VERIFY', name: '门店核验银行卡原件', domain: '人事管理', module: '银行卡变更' },
  { code: 'HR_BANK_CHANGE_APPROVE', name: '审批银行卡变更', domain: '人事管理', module: '银行卡变更' },
  { code: 'HR_APPROVAL_LIST_READ', name: '查看全部状态的审批列表', domain: '人事管理', module: '审批中心' },
  { code: 'HR_APPROVAL_DETAIL_READ', name: '查看审批详情和审批日志', domain: '人事管理', module: '审批中心' },
] as const satisfies readonly HrPermissionDefinition[];

/** Old capabilities retained only so deployed service code and old DB grants
 * remain readable during rollout. They are not returned by the role editor. */
export const LEGACY_HR_PERMISSIONS = [
  ['HR_EMPLOYEE_READ', '查看员工基础档案'], ['HR_EMPLOYEE_WRITE', '维护员工基础档案'],
  ['HR_SENSITIVE_DRAFT_WRITE', '维护入职敏感资料'], ['HR_TIME_CORRECTION_REQUEST', '查看工时更正记录'],
  ['HR_TIME_CORRECTION_APPROVE', '维护已确认工时'],
  ['HR_SCHEDULE_WRITE', '编排和发布班次'], ['HR_TIME_CONFIRM', '确认实际工时'],
  ['HR_SCHEDULE_READ', '查看门店排班'], ['HR_ONBOARDING_STORE_VERIFY', '门店核验入职资料'],
  ['HR_BANK_CHANGE_STORE_VERIFY', '门店核验银行卡原件'],
] as const;

const LEGACY_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  HR_EMPLOYEE_READ: ['HR_EMPLOYEE_LIST_READ', 'HR_EMPLOYEE_DETAIL_READ', 'HR_EMPLOYEE_SENSITIVE_READ'],
  HR_EMPLOYEE_WRITE: ['HR_EMPLOYEE_DETAIL_READ', 'HR_EMPLOYEE_EDIT', 'HR_EMPLOYEE_ACCOUNT_LINK',
    'HR_EMPLOYEE_SENSITIVE_EDIT', 'HR_JOB_POSITION_READ'],
  HR_SENSITIVE_DRAFT_WRITE: ['HR_ONBOARDING_CREATE', 'HR_EMPLOYEE_SENSITIVE_EDIT'],
  HR_TIME_CORRECTION_REQUEST: ['HR_TIME_CORRECTION_READ'],
  HR_TIME_CORRECTION_APPROVE: ['HR_TIME_CORRECTION_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE'],
  HR_SCHEDULE_READ: ['HR_SCHEDULE_LIST_READ', 'HR_SHIFT_TEMPLATE_READ', 'HR_SCHEDULE_POINT_READ', 'HR_TIME_CORRECTION_READ'],
  HR_SCHEDULE_WRITE: ['HR_SCHEDULE_LIST_READ', 'HR_SCHEDULE_DRAFT_EDIT', 'HR_SCHEDULE_DRAFT_DELETE', 'HR_SCHEDULE_PUBLISH',
    'HR_SCHEDULE_REVISE', 'HR_SHIFT_TEMPLATE_READ', 'HR_SHIFT_TEMPLATE_EDIT', 'HR_SHIFT_TEMPLATE_DELETE',
    'HR_SCHEDULE_POINT_READ', 'HR_SCHEDULE_POINT_EDIT', 'HR_SCHEDULE_POINT_DELETE', 'HR_TIME_LIST_READ', 'HR_TIME_ADJUST',
    'HR_TIME_CONFIRM_ONE', 'HR_TIME_BULK_CONFIRM', 'HR_WORK_STATISTICS_READ', 'HR_TIME_CORRECTION_EDIT',
    'HR_TIME_CORRECTION_DELETE'],
  HR_TIME_CONFIRM: ['HR_TIME_LIST_READ', 'HR_TIME_ADJUST', 'HR_TIME_CONFIRM_ONE', 'HR_TIME_BULK_CONFIRM',
  'HR_WORK_STATISTICS_READ'],
  HR_ONBOARDING_STORE_VERIFY: ['HR_ONBOARDING_VERIFY', 'HR_ONBOARDING_LIST_READ', 'HR_ONBOARDING_DETAIL_READ',
    'HR_EMPLOYEE_SENSITIVE_READ', 'HR_JOB_POSITION_READ'],
  HR_ONBOARDING_APPROVE: ['HR_ONBOARDING_LIST_READ', 'HR_ONBOARDING_DETAIL_READ', 'HR_EMPLOYEE_SENSITIVE_READ',
    'HR_JOB_POSITION_READ', 'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  // Requesters must be able to choose an active employee from the store roster.
  // The list permission exposes the roster only; employee details remain separately gated.
  HR_OFFBOARDING_REQUEST: ['HR_OFFBOARDING_LIST_READ', 'HR_EMPLOYEE_LIST_READ'],
  HR_OFFBOARDING_APPROVE: ['HR_OFFBOARDING_LIST_READ', 'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  HR_TRANSFER_REQUEST: ['HR_TRANSFER_LIST_READ'],
  HR_TRANSFER_APPROVE_SOURCE: ['HR_TRANSFER_LIST_READ', 'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  HR_TRANSFER_APPROVE_DESTINATION: ['HR_TRANSFER_LIST_READ', 'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  HR_TRANSFER_APPROVE_HR: ['HR_TRANSFER_LIST_READ', 'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  HR_SALARY_CHANGE_REQUEST: ['HR_SALARY_CHANGE_LIST_READ'],
  HR_SALARY_CHANGE_APPROVE: ['HR_SALARY_CHANGE_LIST_READ', 'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  HR_BANK_CHANGE_SUBMIT: ['HR_BANK_CHANGE_LIST_READ'],
  HR_BANK_CHANGE_STORE_VERIFY: ['HR_BANK_CHANGE_VERIFY', 'HR_BANK_CHANGE_SUBMIT', 'HR_BANK_CHANGE_LIST_READ', 'HR_BANK_CHANGE_FULL_READ',
    'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  HR_BANK_CHANGE_APPROVE: ['HR_BANK_CHANGE_LIST_READ', 'HR_BANK_CHANGE_FULL_READ',
    'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  HR_MONTH_SUBMIT: ['HR_MONTH_LIST_READ'],
  HR_MONTH_APPROVE: ['HR_MONTH_LIST_READ', 'HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ'],
  HR_MONTH_EXPORT: ['HR_MONTH_LIST_READ'],
};

/** Expand pre-tree permissions so existing roles retain their former access
 * until an administrator edits and saves them with the new action leaves. */
export function expandLegacyHrPermissionCodes(codes: readonly string[]): readonly string[] {
  const expanded = new Set(codes);
  for (const code of codes) for (const leaf of LEGACY_EXPANSIONS[code] ?? []) expanded.add(leaf);
  return [...expanded];
}

/**
 * Return read-only aliases used by miniapp builds before the three-level
 * permission tree. They only control legacy client-side entry visibility;
 * API authorization continues to check the fine-grained permission code.
 */
const LEGACY_DISPLAY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  HR_EMPLOYEE_READ: ['HR_EMPLOYEE_LIST_READ'],
  HR_EMPLOYEE_WRITE: ['HR_EMPLOYEE_EDIT', 'HR_EMPLOYEE_ACCOUNT_LINK', 'HR_EMPLOYEE_SENSITIVE_EDIT'],
  HR_SENSITIVE_DRAFT_WRITE: ['HR_ONBOARDING_CREATE'],
  HR_TIME_CORRECTION_REQUEST: ['HR_TIME_CORRECTION_READ'],
  HR_TIME_CORRECTION_APPROVE: ['HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE'],
  HR_SCHEDULE_READ: ['HR_SCHEDULE_LIST_READ'],
  HR_SCHEDULE_WRITE: ['HR_SCHEDULE_DRAFT_EDIT', 'HR_SCHEDULE_DRAFT_DELETE', 'HR_SCHEDULE_PUBLISH', 'HR_SCHEDULE_REVISE'],
  HR_TIME_CONFIRM: ['HR_TIME_LIST_READ', 'HR_TIME_ADJUST', 'HR_TIME_CONFIRM_ONE', 'HR_TIME_BULK_CONFIRM'],
  HR_ONBOARDING_STORE_VERIFY: ['HR_ONBOARDING_VERIFY'],
  HR_BANK_CHANGE_STORE_VERIFY: ['HR_BANK_CHANGE_VERIFY'],
};

/** Adds only old names to the current-access response for already released miniapps. */
export function addLegacyHrPermissionDisplayAliases(codes: readonly string[]): readonly string[] {
  const visible = new Set(codes);
  for (const [legacyCode, leaves] of Object.entries(LEGACY_DISPLAY_ALIASES)) {
    if (leaves.some((leaf) => visible.has(leaf))) visible.add(legacyCode);
  }
  return [...visible];
}

export const ALL_HR_PERMISSION_CODES = [
  ...HR_PERMISSIONS.map(({ code }) => code),
  ...LEGACY_HR_PERMISSIONS.map(([code]) => code),
] as const;

export type HrPermissionCode = typeof HR_PERMISSIONS[number]['code'] | typeof LEGACY_HR_PERMISSIONS[number][0];
export const isHrPermissionCode = (value: unknown): value is HrPermissionCode =>
  typeof value === 'string' && ALL_HR_PERMISSION_CODES.some((code) => code === value);
export const isConfigurableHrPermissionCode = (value: unknown): value is HrPermissionCode =>
  typeof value === 'string' && HR_PERMISSIONS.some(({ code }) => code === value);
