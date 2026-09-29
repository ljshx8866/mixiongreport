const baseUrl = import.meta.env.VITE_API_BASE ?? 'https://replace-with-domain.example.com'
const wxCode = () => new Promise<string>((resolve, reject) => uni.login({ provider: 'weixin', success: ({ code }) => code ? resolve(code) : reject(new Error('微信登录失败')), fail: reject }))
export async function loginWithWechat(credentials?: { mobile: string; password: string }) {
  const code = await wxCode()
  return new Promise<void>((resolve, reject) => uni.request({ url: `${baseUrl}/api/auth/wechat`, method: 'POST', data: { code, ...credentials }, success: ({ statusCode, data }) => { const result = data as any; if (statusCode < 200 || statusCode >= 300) { uni.setStorageSync('wechatBindRequired', statusCode === 403); reject(new Error(result?.message ?? '微信登录失败')); return } uni.setStorageSync('accessToken', result.accessToken); uni.setStorageSync('user', result.user); if (result.user?.storeIds?.length) uni.setStorageSync('storeId', result.user.storeIds[0]); else uni.removeStorageSync('storeId'); uni.removeStorageSync('wechatBindRequired'); resolve() }, fail: reject }))
}

let pendingLogin: Promise<void> | null = null
export function ensureWechatLogin() {
  if (uni.getStorageSync('accessToken')) return Promise.resolve()
  if (!pendingLogin) pendingLogin = loginWithWechat().finally(() => { pendingLogin = null })
  return pendingLogin
}
