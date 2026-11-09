let loginRedirectPending = false

/** Clear an expired session and return to the profile tab where sign-in lives. */
export function returnToLoginAfterSessionExpiry() {
  for (const key of ['accessToken', 'user', 'storeId']) uni.removeStorageSync(key)
  if (loginRedirectPending) return

  loginRedirectPending = true
  uni.showToast({ title: '登录已失效，请重新登录', icon: 'none', duration: 1200 })
  setTimeout(() => {
    uni.switchTab({
      url: '/pages/profile/index',
      complete: () => setTimeout(() => { loginRedirectPending = false }, 500),
    })
  }, 250)
}
