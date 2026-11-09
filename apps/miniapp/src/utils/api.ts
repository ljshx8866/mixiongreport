import { returnToLoginAfterSessionExpiry } from './auth-session'

const baseUrl = import.meta.env.VITE_API_BASE ?? 'https://mixiong6.com'
const requestTimeout = 20000
export const apiUrl = (path: string) => `${baseUrl}${path}`

function normalizeResponse<T>(value: unknown): T {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text) {
      try { return JSON.parse(text) as T } catch { /* Keep non-JSON response text unchanged. */ }
    }
  }
  return value as T
}

export const publicRequest = <T>(path: string) => new Promise<T>((resolve, reject) => {
  let settled = false
  const finish = (callback: () => void) => {
    if (settled) return
    settled = true
    clearTimeout(watchdog)
    callback()
  }
  const watchdog = setTimeout(() => finish(() => reject(new Error('request timeout'))), requestTimeout)
  try {
    uni.request({
      url: apiUrl(path),
      method: 'GET',
      timeout: requestTimeout,
      // HarmonyOS WeChat runtimes can stall while decoding JSON natively.
      // Receive text and parse it here so callback behavior is consistent.
      dataType: 'text',
      success: ({ statusCode, data }) => {
        const result = normalizeResponse<T>(data)
        if (statusCode >= 200 && statusCode < 300) { finish(() => resolve(result)); return }
        finish(() => reject({ statusCode, data: result }))
      },
      fail: (error) => finish(() => reject(error)),
      // On some Harmony builds complete receives the response even when the
      // success/fail callback is skipped. Use it as a fallback, with the
      // settled guard preventing duplicate callback handling.
      complete: (response) => {
        if (settled) return
        const statusCode = Number(response?.statusCode)
        if (statusCode >= 200) {
          const result = normalizeResponse<T>(response.data)
          if (statusCode < 300) finish(() => resolve(result))
          else finish(() => reject({ statusCode, data: result }))
          return
        }
        const errMsg = typeof response?.errMsg === 'string' ? response.errMsg : ''
        if (errMsg.toLowerCase().includes('fail')) finish(() => reject({ errMsg }))
      },
    })
  } catch (error) {
    finish(() => reject(error))
  }
})

export const request = <T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET', data?: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
  const token = uni.getStorageSync('accessToken')
  if (!token) { reject(new Error('请先在“我的”页面绑定并登录')); return }
  let settled = false
  const finish = (callback: () => void) => {
    if (settled) return
    settled = true
    clearTimeout(watchdog)
    callback()
  }
  const watchdog = setTimeout(() => finish(() => reject(new Error('request timeout'))), requestTimeout)
  try {
    uni.request({
      url: apiUrl(path),
      method,
      data,
      timeout: requestTimeout,
      header: { Authorization: `Bearer ${token}` },
      // HarmonyOS WeChat runtimes can stall while decoding JSON natively.
      // Receive text and parse it here so callback behavior is consistent.
      dataType: 'text',
      success: ({ statusCode, data: responseData }) => settleResponse(statusCode, responseData),
      fail: (error) => finish(() => reject(error)),
      // Harmony can report the HTTP result in complete without invoking
      // success. Treat that result as a fallback so the page's finally runs.
      complete: (response) => {
        if (settled) return
        const statusCode = Number(response?.statusCode)
        if (statusCode >= 200) { settleResponse(statusCode, response.data); return }
        const errMsg = typeof response?.errMsg === 'string' ? response.errMsg : ''
        if (errMsg.toLowerCase().includes('fail')) finish(() => reject({ errMsg }))
      },
    })
  } catch (error) {
    finish(() => reject(error))
  }

  function settleResponse(statusCode: number, responseData: unknown) {
    const result = normalizeResponse<T>(responseData)
    if (statusCode >= 200 && statusCode < 300) { finish(() => resolve(result)); return }
    if (statusCode === 403 && (result as { code?: string } | null)?.code === 'PASSWORD_CHANGE_REQUIRED') {
      uni.switchTab({ url: '/pages/profile/index' })
    }
    if (statusCode === 401) returnToLoginAfterSessionExpiry()
    finish(() => reject({ statusCode, data: result }))
  }
})
