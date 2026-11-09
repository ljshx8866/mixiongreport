const statusLabels: Record<string, string> = {
  DRAFT: '草稿', SUBMITTED: '审批中', PENDING: '待审批', APPROVED: '已通过',
  APPROVED_AWAITING_EFFECTIVE: '待生效', REJECTED: '已驳回', EFFECTIVE: '已生效',
  EFFECTIVE_FAILED: '生效异常', TRIAL: '试岗中', TRIAL_ENDED: '试岗已结束', ACTIVE: '在职', TERMINATED: '已离职',
  PUBLISHED: '已发布', APPLIED: '已完成', CANCELED: '已取消', CANCELLED: '已取消', WITHDRAWN: '已撤回',
  UNAVAILABLE: '暂不可用', READ: '已读', UNREAD: '未读',
  QUEUED: '等待发送', SENT: '已发送', FAILED: '发送失败',
  APPLY_FAILED: '应用失败', SOURCE_STORE: '等待调出店审批', DESTINATION_STORE: '等待调入店审批', HR: '等待人事审批',
}

const failureLabels: Record<string, string> = {
  SOURCE_CHANGED: '已核验资料发生变化，请重新核对并提交。',
  PHONE_REQUIRED: '员工手机号无效，请核对入职资料。',
  PHONE_ACCOUNT_LINKED: '该手机号已绑定其他员工账号。',
  PHONE_ACCOUNT_DISABLED: '该手机号对应的账号已停用。',
  PHONE_ACCOUNT_AMBIGUOUS: '发现多个手机号相同的账号，请修正手机号后重新提交。',
  ACCOUNT_ROLE_UNAVAILABLE: '所选账号权限已停用，请联系管理员调整。',
  JOB_POSITION_UNAVAILABLE: '所选岗位已停用，请联系管理员调整。',
  SALARY_RATE_CONFLICT: '员工已有有效时薪记录，暂不能重复创建。',
  SOURCE_APPOINTMENT_CONFLICT: '员工原门店任职信息有冲突，请联系人事核实。',
  RECIPIENT_NOT_BOUND: '员工尚未绑定小程序账号，无法发送通知。',
  SCHEDULE_TEMPLATE_NOT_CONFIGURED: '排班通知尚未配置。',
  SEND_INTERRUPTED: '通知发送过程异常，请核实后再重试。',
  STALE_SCHEDULE_VERSION: '排班已更新，请刷新查看最新安排。',
  PAST_SCHEDULE: '排班日期已过，无法发送通知。',
  USER_DISABLED: '员工已关闭此类通知。',
  NETWORK_OR_PROVIDER_ERROR: '通知服务暂时异常，请稍后重试。',
}

export function hrStatusLabel(status?: string | null): string {
  if (!status) return '未知状态'
  return statusLabels[status] ?? '处理中'
}

export function hrFailureLabel(code?: string | null): string {
  if (!code) return ''
  return failureLabels[code] ?? '处理未完成，请联系管理员核实。'
}
