import type { Directive } from 'vue'

export function friendlyError(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '操作失败，请稍后重试。'
  if (/[\u3400-\u9fff]/.test(raw)) return raw
  const lower = raw.toLowerCase()
  if (lower.includes('hr access denied') || lower.includes('access denied') || lower.includes('insufficient role')) return '当前账号没有执行此操作的权限，请联系管理员。'
  if (lower.includes('invalid store') || lower.includes('store access')) return '门店信息无效或当前账号没有该门店权限。'
  if (lower.includes('not found') || lower.includes('unavailable')) return '记录不存在或已被停用，请刷新后重试。'
  if (lower.includes('already exists') || lower.includes('unique constraint') || lower.includes('p2002')) return '信息重复，请检查手机号或编码是否已使用。'
  if (lower.includes('foreign key constraint') || lower.includes('p2003')) return '关联数据不存在或尚未配置完成，请检查所选权限、门店或档案后重试。'
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) return '网络连接失败，请检查网络后重试。'
  if (lower.includes('unauthorized') || lower.includes('token is invalid') || lower.includes('bearer token')) return '登录状态已失效，请重新登录。'
  if (lower.includes('forbidden')) return '当前账号没有执行此操作的权限。'
  if (lower.includes('timeout')) return '请求超时，请稍后重试。'
  return `操作未成功，具体原因：${raw}`
}

function show(el: HTMLElement, message: unknown) {
  if (typeof message !== 'string' || !message.trim() || el.dataset.errorDialog === message) return
  el.dataset.errorDialog = message
  el.style.display = 'none'
  const backdrop = document.createElement('div')
  backdrop.className = 'app-error-backdrop'
  backdrop.setAttribute('role', 'presentation')
  const dialog = document.createElement('section')
  dialog.className = 'app-error-dialog'
  dialog.setAttribute('role', 'alertdialog')
  dialog.setAttribute('aria-modal', 'true')
  const heading = document.createElement('h2'); heading.textContent = '操作提醒'
  const text = document.createElement('p'); text.textContent = friendlyError(message)
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '我知道了'
  close.addEventListener('click', () => backdrop.remove())
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove() })
  dialog.append(heading, text, close); backdrop.append(dialog); document.body.append(backdrop)
  close.focus()
}

export const popupErrorDirective: Directive<HTMLElement, string> = {
  mounted: (el, binding) => show(el, binding.value),
  updated: (el, binding) => {
    if (binding.value !== binding.oldValue) {
      if (!binding.value) { delete el.dataset.errorDialog; el.style.display = '' }
      else show(el, binding.value)
    }
  },
}
