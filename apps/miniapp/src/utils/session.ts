import { returnToLoginAfterSessionExpiry } from './auth-session'

export function businessDate(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function currentStoreId(): number | null {
  const value = Number(uni.getStorageSync('storeId'))
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function errorMessage(error: unknown): string {
  let detail: unknown = error
  const parseJsonText = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    const text = value.trim()
    if (!text.startsWith('{') && !text.startsWith('[')) return value
    try { return JSON.parse(text) as unknown } catch { return value }
  }
  detail = parseJsonText(detail)
  const responseStatusCode = typeof detail === 'object' && detail !== null && 'statusCode' in detail
    ? (detail as { statusCode: unknown }).statusCode : undefined
  if (typeof detail === 'object' && detail !== null && 'data' in detail)
    detail = parseJsonText((detail as { data: unknown }).data) ?? detail

  let raw = ''
  if (detail instanceof Error) raw = detail.message
  else if (typeof detail === 'string') raw = detail
  else if (typeof detail === 'object' && detail !== null) {
    if ('message' in detail) {
      const message = (detail as { message: unknown }).message
      if (typeof message === 'string' && message.trim()) raw = message
      else if (Array.isArray(message)) raw = message.join('；')
    }
    if (!raw && 'errMsg' in detail) {
      const errMsg = (detail as { errMsg: unknown }).errMsg
      if (typeof errMsg === 'string' && errMsg.trim()) {
        if (errMsg.toLowerCase().includes('url not in domain list'))
          raw = '上传域名未加入小程序合法域名，请在小程序开发设置中添加当前 API 域名。'
        else raw = errMsg
      }
    }
  }
  const statusCode = responseStatusCode ?? (typeof detail === 'object' && detail !== null && 'statusCode' in detail
    ? (detail as { statusCode: unknown }).statusCode : undefined)
  const lower = raw.toLowerCase()
  let message = raw
  if (typeof statusCode === 'number' && statusCode === 401) message = '登录状态已失效，正在返回登录页。'
  else if (typeof statusCode === 'number' && statusCode === 403) message = '当前账号没有查看所选门店审批记录的权限，请联系管理员。'
  else if (typeof statusCode === 'number' && statusCode >= 500) message = `审批服务暂时异常（HTTP ${statusCode}），请稍后重试；如持续出现，请联系管理员。`
  else if (!raw) message = '操作失败，请稍后重试。'
  else if (lower.includes("only today's shifts")) message = '只能在当天确认当天的排班，请选择今天的班次。'
  else if (lower.includes('actual work times must be on the shift date') || lower.includes('actual work times must be on shift date')) message = '实际上下班时间需在排班当天，请检查时间。'
  else if (lower.includes('already confirmed')) message = '该班次已确认，如需修改请提交工时更正。'
  else if (lower.includes('confirmed work hours exist')) message = '该班次已有确认工时，请先通过工时更正流程处理后再删除。'
  else if (lower.includes('identity number is already linked') || lower.includes('identity number already exists')) message = '该身份证号码已关联现有员工，请先在员工列表或审批记录中核查，避免重复录入。'
  else if (lower.includes('idnumber is invalid') || lower.includes('invalid identity number')) message = '身份证号码校验未通过，请核对号码、出生日期和末位校验码。'
  else if (lower.includes('invalid bank card number') || lower.includes('cardnumber is invalid')) message = '银行卡号格式不正确，请填写 12 至 25 位数字。'
  else if (lower.includes('bank account name must match') || lower.includes('accountname is invalid')) message = '银行卡开户姓名必须与员工姓名一致，请核对后重试。'
  else if (lower.includes('phone is invalid') || lower.includes('phone is required')) message = '手机号格式不正确，请填写有效的 11 位手机号。'
  else if (lower.includes('approval workflow is not configured')) message = '入职审批流程尚未配置有效审批角色，请联系管理员完善流程设置。'
  else if (lower.includes('hr data protection is not configured') || lower.includes('hr data key is invalid') || lower.includes('hr active data key is missing')) message = '员工资料加密配置异常，请联系管理员检查系统设置。'
  else if (lower.includes('store must confirm the original')) message = '请先确认已在门店现场核验身份证和银行卡原件。'
  else if (lower.includes('effective date must') || lower.includes('invalid effective date')) message = '入职生效日期无效，请重新选择日期。'
  else if (lower.includes('name is invalid') || lower.includes('bankname is invalid')) message = '姓名或开户银行信息不完整，请核对后重试。'
  else if (lower.includes('hr access denied') || lower.includes('access denied') || lower.includes('insufficient role')) message = '当前账号没有执行此操作的权限，请联系管理员。'
  else if (lower.includes('invalid store') || lower.includes('store access')) message = '门店信息无效或当前账号没有该门店权限。'
  else if (lower.includes('not found') || lower.includes('unavailable')) message = '记录不存在或已被停用，请刷新后重试。'
  else if (lower.includes('already exists') || lower.includes('unique constraint') || lower.includes('p2002')) message = '信息重复，请检查手机号或编码是否已使用。'
  else if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) message = '网络连接失败，请检查网络后重试。'
  else if (lower.includes('request:fail') || lower.includes('request fail') || lower.includes('err_network_changed')) message = '审批列表连接失败，请检查手机网络或稍后重试。'
  else if (lower.includes('ssl') || lower.includes('certificate') || lower.includes('handshake')) message = '安全连接失败，请检查手机日期时间和网络后重试。'
  else if (lower.includes('filter is not a function') || lower.includes('map is not a function')) message = '审批数据格式不兼容，请重新打开小程序；如仍出现，请更新到最新版本。'
  else if (lower.includes('unauthorized') || lower.includes('token is invalid') || lower.includes('bearer token')) message = '登录状态已失效，请重新登录。'
  else if (lower.includes('forbidden')) message = '当前账号没有执行此操作的权限。'
  else if (lower.includes('timeout')) message = '请求超时，请稍后重试。'
  else if (!/[\u3400-\u9fff]/.test(raw)) message = '操作未成功，请稍后重试或联系管理员。'
  if (statusCode === 401 || lower.includes('unauthorized') || lower.includes('token is invalid') || lower.includes('bearer token')) {
    returnToLoginAfterSessionExpiry()
    return message
  }
  uni.showModal({ title: '操作提醒', content: message, showCancel: false, confirmText: '我知道了' })
  return message
}
