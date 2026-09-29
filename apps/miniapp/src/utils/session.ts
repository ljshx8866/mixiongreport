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
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string') return message
    if (Array.isArray(message)) return message.join('；')
  }
  return '请求失败，请稍后重试'
}
