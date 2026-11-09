<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, reactive, ref } from 'vue'
import ModuleTile from '../../components/ModuleTile.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'
import { loginWithPassword, loginWithWechatPhone } from '../../utils/wechat'

type Account = { id: number; name: string | null; role: string; source?: 'LOCAL' | 'POS'; mustChangePassword?: boolean }

const message = ref('')
const binding = ref(false)
const passwordLoading = ref(false)
const usePassword = ref(false)
const credentials = reactive({ mobile: '', password: '' })
const passwordChange = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const passwordChangeSaving = ref(false)
const user = ref<Account | null>(uni.getStorageSync('user') || null)
const hrRoleNames = ref<string[]>([])
const accountStores = ref<Array<{ id: number; storeName: string }>>([])
const isEmployee = ref(false)
const hrAccessMessage = ref('')
const hrEnabled = import.meta.env.VITE_HR_FEATURES_ENABLED === 'true'
const profileStoreName = computed(() =>
  accountStores.value.length === 1 ? accountStores.value[0].storeName : accountStores.value.length > 1 ? '多门店' : '—')
const profileRole = computed(() => {
  if (hrRoleNames.value.length) return hrRoleNames.value.join('、')
  if (user.value?.source === 'LOCAL') return ({ ADMIN: '总部管理员', REGION_MANAGER: '区域经理', STORE_MANAGER: '门店账号' } as Record<string, string>)[user.value.role] || '本地账号'
  return isEmployee.value ? '员工' : '—'
})

async function loadAccountInfo() {
  user.value = uni.getStorageSync('user') || null
  hrRoleNames.value = []
  accountStores.value = []
  isEmployee.value = false
  hrAccessMessage.value = ''
  if (!user.value || !uni.getStorageSync('accessToken')) return
  try {
    user.value = await request<Account>('/api/auth/me')
    uni.setStorageSync('user', user.value)
    if (user.value.mustChangePassword) return
    try { accountStores.value = await request<Array<{ id: number; storeName: string }>>('/api/auth/stores') } catch { /* Keep the profile page usable if store names are unavailable. */ }
    if (hrEnabled) {
      try {
        const access = await request<{ isEmployee?: boolean; roleNames?: string[] }>('/api/hr/current-access')
        isEmployee.value = Boolean(access.isEmployee)
        hrRoleNames.value = [...new Set((access.roleNames || []).filter((name) => typeof name === 'string' && name.trim()))]
      } catch (error) {
        // Explain why the personal schedule and hours shortcuts are unavailable.
        if (user.value && error) {
          hrAccessMessage.value = '暂时无法读取员工档案关联信息，请联系管理员检查账号与员工档案的关联状态。'
          console.warn('Unable to load the signed-in HR role')
        }
      }
    }
  } catch (error) {
    message.value = errorMessage(error)
  }
}

onShow(() => { message.value = ''; void loadAccountInfo() })

async function authorizePhone(event: any) {
  if (binding.value) return
  const phoneCode = event?.detail?.code
  if (!phoneCode) { message.value = '未完成手机号验证，可改用用户名密码登录'; usePassword.value = true; return }
  binding.value = true; message.value = ''; uni.showLoading({ title: '正在授权登录' })
  try {
    await loginWithWechatPhone(phoneCode)
    user.value = uni.getStorageSync('user')
    void loadAccountInfo()
    uni.showToast({ title: '登录成功' })
    returnHome()
  } catch (error) { message.value = errorMessage(error); usePassword.value = true }
  finally { uni.hideLoading(); binding.value = false }
}

async function passwordLogin() {
  if (passwordLoading.value) return
  if (!credentials.mobile || !credentials.password) { message.value = '请填写用户名和密码'; return }
  passwordLoading.value = true; message.value = ''; uni.showLoading({ title: '正在登录' })
  try {
    const loginPassword = credentials.password
    await loginWithPassword(credentials.mobile.trim(), credentials.password)
    user.value = uni.getStorageSync('user'); credentials.password = ''
    if (user.value?.mustChangePassword) {
      passwordChange.currentPassword = loginPassword
      return
    }
    void loadAccountInfo()
    uni.showToast({ title: '登录成功' })
    returnHome()
  } catch (error) { message.value = errorMessage(error) }
  finally { uni.hideLoading(); passwordLoading.value = false }
}

async function submitRequiredPasswordChange() {
  if (passwordChangeSaving.value) return
  if (!passwordChange.currentPassword || !passwordChange.newPassword || !passwordChange.confirmPassword) {
    message.value = '请填写当前密码和两次新密码'; return
  }
  if (passwordChange.newPassword.length < 8) { message.value = '新密码至少需要 8 位'; return }
  if (passwordChange.newPassword !== passwordChange.confirmPassword) { message.value = '两次输入的新密码不一致'; return }
  passwordChangeSaving.value = true; message.value = ''
  try {
    const result = await request<{ accessToken: string; user: Account }>('/api/auth/change-password', 'POST', {
      currentPassword: passwordChange.currentPassword, newPassword: passwordChange.newPassword,
    })
    uni.setStorageSync('accessToken', result.accessToken)
    uni.setStorageSync('user', result.user)
    user.value = result.user
    passwordChange.currentPassword = ''; passwordChange.newPassword = ''; passwordChange.confirmPassword = ''
    uni.showToast({ title: '密码修改成功' })
    returnHome()
  } catch (error) { message.value = errorMessage(error) }
  finally { passwordChangeSaving.value = false }
}

function returnHome() { uni.switchTab({ url: '/pages/index/index' }) }

function logout() {
  for (const key of ['accessToken', 'user', 'storeId']) uni.removeStorageSync(key)
  user.value = null
}
</script>

<template>
  <view class="page profile-page">
    <template v-if="user">
      <view v-if="user.mustChangePassword" class="card required-password-card">
        <text class="section-title">首次登录，请修改默认密码</text>
        <text class="required-password-note">为保护账号安全，请先设置新密码，完成后即可继续使用。</text>
        <view class="field"><text>当前默认密码</text><input v-model="passwordChange.currentPassword" password placeholder="请输入当前密码" /></view>
        <view class="field"><text>新密码</text><input v-model="passwordChange.newPassword" password placeholder="至少 8 位" /></view>
        <view class="field"><text>确认新密码</text><input v-model="passwordChange.confirmPassword" password placeholder="再次输入新密码" @confirm="submitRequiredPasswordChange" /></view>
        <text v-if="message" class="error-text">{{ message }}</text>
        <button class="button auth-button" :loading="passwordChangeSaving" :disabled="passwordChangeSaving" @click="submitRequiredPasswordChange">{{ passwordChangeSaving ? '正在保存…' : '修改密码并继续' }}</button>
      </view>
      <template v-else>
      <view class="card profile-card">
        <view class="profile-hero">
          <view class="avatar">{{ (user.name || '员').slice(0, 1) }}</view>
          <text class="profile-name">{{ user.name || `账号 ${user.id}` }}</text>
        </view>
        <view class="profile-meta">
          <view class="profile-meta-item"><text>门店</text><text>{{ profileStoreName }}</text></view>
          <view class="profile-meta-item"><text>角色</text><text>{{ profileRole }}</text></view>
        </view>
      </view>

      <view v-if="hrEnabled && isEmployee" class="card personal-tools">
        <view class="personal-tools-heading"><text class="section-title">我的工作</text>
          <text class="personal-tools-note">个人资料、排班和工时</text></view>
        <view class="personal-tools-grid">
          <ModuleTile title="我的资料" caption="查看个人档案" icon="people" tone="orange"
            @activate="uni.navigateTo({ url: '/pages/hr/my-profile' })" />
          <ModuleTile title="我的排班" caption="查看已发布班次" icon="my-schedule" tone="blue"
            @activate="uni.navigateTo({ url: '/pages/hr/my-schedule' })" />
          <ModuleTile title="我的工时" caption="查看个人工时统计" icon="my-work" tone="mint"
            @activate="uni.navigateTo({ url: '/pages/hr/my-work' })" />
        </view>
      </view>
      <view v-else-if="hrEnabled && !hrAccessMessage" class="card hr-access-hint">
        当前账号尚未关联在职员工档案，无法显示个人资料、排班和工时。请联系管理员检查员工在职状态及员工档案关联。
      </view>
      <view v-else-if="hrEnabled" class="card hr-access-hint">{{ hrAccessMessage }}</view>

      <view class="button dark" @click="logout">退出当前账号</view>
      </template>
    </template>

    <template v-else>
      <view class="login-hero">
        <text class="eyebrow">米熊经营工作台</text>
        <text class="login-title">{{ usePassword ? '账号密码登录' : '手机号快捷登录' }}</text>
        <text class="login-subtitle">{{ usePassword ? '使用总部创建的手机号和密码登录。' : '验证手机号后，系统将自动匹配总部已创建的门店账号。' }}</text>
      </view>
      <view class="card login-card">
        <template v-if="!usePassword">
          <view class="phone-icon">手</view><text class="auth-title">手机号快捷登录</text>
          <text class="auth-desc">验证失败时，可切换为用户名密码登录。</text>
          <text v-if="message" class="error-text">{{ message }}</text>
          <button class="button auth-button" open-type="getPhoneNumber" :loading="binding" :disabled="binding" @getphonenumber="authorizePhone">{{ binding ? '正在验证…' : '手机号快捷登录' }}</button>
          <view class="switch-login" @click="usePassword = true">改用用户名密码登录</view>
        </template>
        <template v-else>
          <view class="phone-icon">账</view><text class="auth-title">用户名密码登录</text>
          <view class="field"><text>手机号</text><input v-model="credentials.mobile" type="number" maxlength="11" placeholder="请输入手机号" /></view>
          <view class="field"><text>密码</text><input v-model="credentials.password" password placeholder="请输入密码" @confirm="passwordLogin" /></view>
          <text v-if="message" class="error-text">{{ message }}</text>
          <button class="button auth-button" :loading="passwordLoading" :disabled="passwordLoading" @click="passwordLogin">{{ passwordLoading ? '正在登录…' : '登录' }}</button>
          <view class="switch-login" @click="usePassword = false">返回手机号快捷登录</view>
        </template>
      </view>
    </template>
  </view>
</template>

<style scoped>
.profile-card{margin-bottom:20rpx;padding:26rpx}.profile-hero{display:flex;align-items:center;gap:20rpx;padding:8rpx 2rpx 22rpx}.avatar{display:flex;align-items:center;justify-content:center;width:86rpx;height:86rpx;border-radius:28rpx;background:linear-gradient(135deg,#f47a34,#ed4d12);color:#fff;font-size:36rpx;font-weight:700}.profile-name,.login-title{display:block;color:#172033;font-size:38rpx;font-weight:700}.profile-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12rpx;padding-top:18rpx;border-top:1rpx solid #f0f2f6}.profile-meta-item{display:flex;flex-direction:column;gap:8rpx;min-width:0}.profile-meta-item>text:first-child{color:#8490a5;font-size:22rpx}.profile-meta-item>text:last-child{overflow:hidden;color:#26344a;font-size:25rpx;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.login-subtitle{display:block;margin-top:4rpx;color:#8490a5;font-size:24rpx}.info-card{margin-bottom:20rpx;padding:28rpx}.section-title{display:block;color:#172033;font-size:28rpx;font-weight:700}.info-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24rpx;padding:19rpx 0;border-bottom:1rpx solid #f0f2f6;font-size:24rpx;line-height:1.55}.info-row>text:first-child{flex:none;color:#8490a5}.info-row>text:last-child{color:#26344a;text-align:right;overflow-wrap:anywhere}.last-row{border-bottom:0;padding-bottom:0}.multiline{max-width:70%}.address-row{align-items:flex-start}.loading-note{display:block;margin-top:20rpx;color:#8b95a6;font-size:22rpx}.personal-tools{margin-bottom:20rpx;padding:24rpx}.personal-tools-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12rpx;margin-bottom:16rpx}.personal-tools-note{color:#8b96a7;font-size:20rpx}.personal-tools-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12rpx}.login-hero{padding:34rpx 10rpx 24rpx}.login-title{margin-top:6rpx;font-size:44rpx}.login-card{padding-top:30rpx;text-align:center}.phone-icon{display:flex;align-items:center;justify-content:center;width:92rpx;height:92rpx;margin:0 auto 20rpx;border-radius:28rpx;background:#fff1e9;color:#e75311;font-size:34rpx;font-weight:700}.auth-title{display:block;color:#172033;font-size:31rpx;font-weight:700}.auth-desc{display:block;margin:12rpx 10rpx 0;color:#8490a5;font-size:23rpx;line-height:1.7}.field{margin-top:20rpx;text-align:left}.field text{display:block;margin:0 0 8rpx;color:#425066;font-size:24rpx;font-weight:600}.field input{box-sizing:border-box;width:100%;height:82rpx;padding:0 20rpx;border:1rpx solid #dbe1ea;border-radius:14rpx;background:#fbfcfe;font-size:27rpx}.auth-button{width:100%;margin-top:28rpx;border:0;font-size:inherit;line-height:normal}.auth-button::after{border:0}.switch-login{display:inline-block;margin-top:25rpx;color:#df591b;font-size:24rpx}
.hr-access-hint{margin-bottom:20rpx;padding:20rpx;color:#7a5a31;font-size:22rpx;line-height:1.6}
.required-password-card{margin-top:22vh;padding:30rpx}.required-password-note{display:block;margin:12rpx 0 22rpx;color:#7d899b;font-size:23rpx;line-height:1.6}.required-password-card .field{margin-top:16rpx}
</style>
