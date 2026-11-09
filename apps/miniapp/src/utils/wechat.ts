const baseUrl = import.meta.env.VITE_API_BASE ?? 'https://mixiong6.com'

const wxCode = () => new Promise<string>((resolve, reject) => uni.login({ provider: 'weixin', success: ({ code }) => code ? resolve(code) : reject(new Error('登录凭证获取失败')), fail: reject }))

function persistLogin(result: any) {
  uni.setStorageSync('accessToken', result.accessToken)
  uni.setStorageSync('user', result.user)
  if (result.user?.storeIds?.length) uni.setStorageSync('storeId', result.user.storeIds[0]); else uni.removeStorageSync('storeId')
}

function postLogin(path: string, data: Record<string, unknown>, fallbackMessage: string) {
  return new Promise<void>((resolve, reject) => uni.request({
    url: `${baseUrl}${path}`, method: 'POST', data,
    success: ({ statusCode, data }) => { const result = data as any; if (statusCode < 200 || statusCode >= 300) { reject(new Error(result?.message ?? fallbackMessage)); return }; persistLogin(result); resolve() },
    fail: reject,
  }))
}

export async function loginWithWechatPhone(phoneCode: string) { return postLogin('/api/auth/wechat-phone', { code: await wxCode(), phoneCode }, '手机号验证登录失败') }
export async function loginWithPassword(mobile: string, password: string) { return postLogin('/api/auth/login', { mobile, password }, '用户名或密码错误') }
