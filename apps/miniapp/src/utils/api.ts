const baseUrl = import.meta.env.VITE_API_BASE ?? 'https://replace-with-domain.example.com'

export const request = <T>(path: string, method: 'GET' | 'POST' = 'GET', data?: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
  const token = uni.getStorageSync('accessToken')
  if (!token) { reject(new Error('请先在“我的”页面绑定并登录')); return }
  uni.request({
    url: `${baseUrl}${path}`,
    method,
    data,
    header: { Authorization: `Bearer ${token}` },
    success: ({ statusCode, data: result }) => {
      if (statusCode >= 200 && statusCode < 300) { resolve(result as T); return }
      if (statusCode === 401) { uni.removeStorageSync('accessToken'); uni.removeStorageSync('user'); uni.removeStorageSync('storeId') }
      reject(result)
    },
    fail: reject,
  })
})
