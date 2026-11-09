import { createHash } from 'node:crypto';

export type AlertDiagnosis = { title: string; suggestion: string };

export function cleanAlertMessage(value: unknown): string {
  const raw = String(value ?? '').split('\n')[0].replace(/\s+/g, ' ').trim();
  if (!raw) return '未提供错误说明';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/(access[_-]?token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^,\s&]+/gi, '$1=[已隐藏]')
    .replace(/\b1\d{10}\b/g, '[手机号已隐藏]')
    .replace(/\b\d{17}[\dXx]\b/g, '[证件号已隐藏]')
    .replace(/\b\d{16,19}\b/g, '[银行卡号已隐藏]')
    .slice(0, 1200);
}

export function diagnoseAlert(text: string, httpStatus?: number | null): AlertDiagnosis {
  const message = text.toLowerCase();
  if (/product|dish|category|菜品|商品|分类|未关联|不存在于本地/.test(message)) {
    return { title: 'POS 菜品或分类关联异常', suggestion: '先在后台基础资料中同步 POS 菜品与分类，检查菜品编码、所属门店和分类；随后重试对应的数据同步。' };
  }
  if (/timeout|timed out|econn|socket|网络|连接失败|超时/.test(message)) {
    return { title: '外部服务连接异常', suggestion: '检查服务器网络、POS 服务地址及服务运行状态；网络恢复后再重试。' };
  }
  if (/401|403|unauthorized|forbidden|token|鉴权|授权|权限/.test(message)) {
    return { title: '接口鉴权或权限异常', suggestion: '检查接口凭据是否有效，以及当前账号或服务是否具有所需权限。' };
  }
  if (/database|prisma|mysql|sql|数据库|deadlock|连接池/.test(message)) {
    return { title: '数据库访问异常', suggestion: '检查数据库连接、连接池和数据库日志；若告警持续出现，应先恢复数据库连接再重试。' };
  }
  if (httpStatus === 503 || /503|service unavailable|服务暂不可用/.test(message)) {
    return { title: '服务暂时不可用', suggestion: '检查相关服务健康状态及依赖服务；服务恢复后由用户重试受影响的操作。' };
  }
  if (httpStatus != null && httpStatus >= 500) {
    return { title: `接口服务异常（HTTP ${httpStatus}）`, suggestion: '查看该接口对应的服务日志和依赖服务状态，确认原因后再处理。' };
  }
  return { title: '后台任务失败', suggestion: '查看任务日志和最近一次成功记录，确认输入数据、外部服务状态和权限后重试。' };
}

export function alertFingerprint(...parts: Array<string | number | bigint | null | undefined>): string {
  return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex');
}
