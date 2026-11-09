<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { apiUrl, publicRequest, request } from '../../utils/api'
import { businessDate, currentStoreId, errorMessage } from '../../utils/session'

type Store = { id: number; storeName: string }
type HrStore = Store & { permissionCodes: string[] }
type Report = {
  store?: { name: string }
  sales?: { total?: { amount: number | null; customers: number | null; avgOrderValue: number | null } }
  status?: { manualInputReady?: boolean }
}
type Decoration = { homeTitle: string; homeSubtitle: string; defaultHomeModules: string[]; bannerUrl: string | null }

const report = ref<Report | null>(null)
const stores = ref<Store[]>([])
const homePermissionCodes = ref<string[]>([])
const canViewHomeSales = computed(() => homePermissionCodes.value.includes('HR_HOME_SALES_READ'))
const selectedStore = ref<number | null>(currentStoreId())
const date = ref(businessDate())
const loading = ref(false)
const hasSession = ref(false)
const unreadCount = ref(0)
const message = ref('')
const hrEnabled = import.meta.env.VITE_HR_FEATURES_ENABLED === 'true'
const decoration = ref<Decoration>({ homeTitle: '米熊 · 经营工作台', homeSubtitle: '常用功能一目了然', defaultHomeModules: ['input', 'report', 'history', 'reminders'], bannerUrl: null })
const bannerUrl = computed(() => decoration.value.bannerUrl ? apiUrl(decoration.value.bannerUrl) : '')
type HomeModule = { id: string; title: string; icon: string; tone: string; path: string; hrPage?: boolean; hrInput?: boolean }
const favoriteModules: HomeModule[] = [
  { id: 'input', title: '每日填报', icon: 'input', tone: 'orange', path: '/pages/input/index' },
  { id: 'report', title: '经营日报', icon: 'report', tone: 'blue', path: `/pages/report/index?date=${date.value}` },
  { id: 'history', title: '历史日报', icon: 'history', tone: 'mint', path: '/pages/history/index' },
  { id: 'reminders', title: '填报提醒', icon: 'reminder', tone: 'purple', path: '/pages/reminders/index' },
]
type HrHomeModule = HomeModule
const hrFavoriteModules = ref<HrHomeModule[]>([])
const favoritePermission: Record<string, string> = {
  input: 'HR_DAILY_INPUT_WRITE', report: 'HR_DAILY_REPORT_READ',
  history: 'HR_HISTORY_REPORT_READ',
}
const hasFavoritePermission = (item: HomeModule) => {
  if (item.id === 'reminders') return homePermissionCodes.value.includes('HR_REMINDER_READ') || homePermissionCodes.value.includes('HR_REMINDER_PROCESS')
  const permission = favoritePermission[item.id]
  return !permission || homePermissionCodes.value.includes(permission)
}
const hrTargetStoreId = ref<number | null>(null)
const favorites = ref<string[]>(['input', 'report', 'history', 'reminders'])
const editingFavorites = ref(false)
const showAddPanel = ref(false)
const favoriteSettingsReady = ref(false)
const savingFavorites = ref(false)
const availableFavorites = computed<HomeModule[]>(() => [...favoriteModules, ...hrFavoriteModules.value].filter(hasFavoritePermission))
const shownFavorites = computed(() => availableFavorites.value.filter((item) => favorites.value.includes(item.id)))
const addableFavorites = computed(() => availableFavorites.value.filter((item) => !favorites.value.includes(item.id)))

async function load() {
  loading.value = true
  date.value = businessDate()
  selectedStore.value = currentStoreId()
  hasSession.value = Boolean(uni.getStorageSync('accessToken'))
  void loadUnreadCount()
  report.value = null
  homePermissionCodes.value = []
  message.value = ''
  if (!hasSession.value) {
    stores.value = []
    message.value = '登录后即可查看门店经营数据和工作入口'
    loading.value = false
    return
  }
  if (!selectedStore.value) {
    stores.value = []
    message.value = '当前账号尚未配置经营门店，请联系总部管理员'
    loading.value = false
    return
  }
  try {
    stores.value = await request<Store[]>('/api/auth/stores')
    if (hrEnabled) {
      try {
        const access = await request<{ stores: HrStore[] }>('/api/hr/current-access')
        const target = access.stores.find((store) => store.id === selectedStore.value)
        homePermissionCodes.value = target?.permissionCodes ?? []
      } catch {
        homePermissionCodes.value = []
      }
    }
    if (canViewHomeSales.value)
      report.value = await request<Report>(`/api/reports/home-sales?storeId=${selectedStore.value}&date=${date.value}`)
  } catch (error) {
    message.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

async function loadUnreadCount() {
  if (!hasSession.value) { unreadCount.value = 0; return }
  try {
    const result = await request<{ count: number }>('/api/notifications/unread-count')
    unreadCount.value = result.count
  } catch { unreadCount.value = 0 }
}

async function loadFavorites() {
  uni.removeStorageSync('homeFavoriteModules')
  homePermissionCodes.value = []
  hrFavoriteModules.value = []
  hrTargetStoreId.value = null
  if (hrEnabled && uni.getStorageSync('accessToken')) {
    try {
      const access = await request<{ stores: HrStore[]; isEmployee?: boolean }>('/api/hr/current-access')
      const authorizedStores = access.stores ?? []
      const target = authorizedStores.find((store) => store.id === selectedStore.value) ?? authorizedStores[0]
      hrTargetStoreId.value = target?.id ?? null
      const permissions = target?.permissionCodes ?? []
      homePermissionCodes.value = permissions
      const has = (code: string) => permissions.includes(code)
      const hasAny = (...codes: string[]) => codes.some(has)
      const modules: HrHomeModule[] = []
      if (access.isEmployee) modules.push(
        { id: 'my-profile', title: '我的资料', icon: 'people', tone: 'orange', path: '/pages/hr/my-profile' },
        { id: 'my-schedule', title: '我的排班', icon: 'my-schedule', tone: 'blue', path: '/pages/hr/my-schedule' },
        { id: 'my-work', title: '我的工时', icon: 'my-work', tone: 'mint', path: '/pages/hr/my-work' },
      )
      if (hasAny('HR_SCHEDULE_LIST_READ', 'HR_SCHEDULE_DRAFT_EDIT', 'HR_SCHEDULE_PUBLISH', 'HR_SCHEDULE_REVISE'))
        modules.push({ id: 'schedule', title: '门店排班', icon: 'schedule', tone: 'orange', path: 'schedule', hrPage: true })
      if (hasAny('HR_SHIFT_TEMPLATE_READ', 'HR_SHIFT_TEMPLATE_EDIT', 'HR_SHIFT_TEMPLATE_DELETE'))
        modules.push({ id: 'shift-templates', title: '班次设置', icon: 'schedule', tone: 'blue', path: 'shift-templates', hrPage: true })
      if (hasAny('HR_SCHEDULE_POINT_READ', 'HR_SCHEDULE_POINT_EDIT', 'HR_SCHEDULE_POINT_DELETE'))
        modules.push({ id: 'schedule-points', title: '点位设置', icon: 'schedule', tone: 'mint', path: 'schedule-points', hrPage: true })
      if (has('HR_DAILY_INPUT_WRITE')) modules.push({ id: 'hr-input', title: '门店填报', icon: 'input', tone: 'mint', path: '/pages/input/index', hrInput: true })
      if (hasAny('HR_TIME_LIST_READ', 'HR_TIME_ADJUST', 'HR_TIME_CONFIRM_ONE', 'HR_TIME_BULK_CONFIRM'))
        modules.push({ id: 'time', title: '当日工时', icon: 'time', tone: 'blue', path: 'time', hrPage: true })
      if (has('HR_WORK_STATISTICS_READ')) modules.push({ id: 'work-statistics', title: '工时统计', icon: 'time', tone: 'mint', path: 'work-statistics', hrPage: true })
      if (has('HR_TRIAL_MANAGE')) modules.push({ id: 'trials', title: '试岗管理', icon: 'people', tone: 'mint', path: 'trials', hrPage: true })
      if (has('HR_EMPLOYEE_LIST_READ')) modules.push({ id: 'employees', title: '员工列表', icon: 'people', tone: 'blue', path: 'employees', hrPage: true })
      if (hasAny('HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE', 'HR_SALARY_CHANGE_APPROVE', 'HR_MONTH_APPROVE',
        'HR_ONBOARDING_APPROVE', 'HR_OFFBOARDING_APPROVE', 'HR_BANK_CHANGE_APPROVE', 'HR_BANK_CHANGE_VERIFY') ||
        permissions.some((code) => code.startsWith('HR_TRANSFER_APPROVE_'))) {
        modules.push({ id: 'approvals', title: '审批列表', icon: 'correction', tone: 'purple', path: 'approvals', hrPage: true })
      }
      if (hasAny('HR_TIME_CORRECTION_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE')) modules.push({ id: 'correction', title: '工时更正', icon: 'correction', tone: 'purple', path: 'correction', hrPage: true })
      if (has('HR_TRANSFER_REQUEST') || permissions.some((code) => code.startsWith('HR_TRANSFER_APPROVE_'))) modules.push({ id: 'transfer', title: '员工转店', icon: 'transfer', tone: 'rose', path: 'transfer', hrPage: true })
      if (hasAny('HR_ONBOARDING_CREATE', 'HR_ONBOARDING_LIST_READ', 'HR_ONBOARDING_VERIFY', 'HR_ONBOARDING_APPROVE')) modules.push({ id: 'onboarding', title: '员工入职', icon: 'people', tone: 'mint', path: 'onboarding', hrPage: true })
      if (hasAny('HR_OFFBOARDING_REQUEST', 'HR_OFFBOARDING_APPROVE')) modules.push({ id: 'offboarding', title: '员工离职', icon: 'people', tone: 'purple', path: 'offboarding', hrPage: true })
      if (hasAny('HR_SALARY_CHANGE_REQUEST', 'HR_SALARY_CHANGE_LIST_READ', 'HR_SALARY_CHANGE_APPROVE'))
        modules.push({ id: 'salary-change', title: '调薪申请', icon: 'correction', tone: 'orange', path: '/pages/hr/salary-change', hrPage: true })
      if (hasAny('HR_BANK_CHANGE_SUBMIT', 'HR_BANK_CHANGE_LIST_READ', 'HR_BANK_CHANGE_VERIFY', 'HR_BANK_CHANGE_APPROVE'))
        modules.push({ id: 'bank-change', title: '银行卡变更', icon: 'people', tone: 'blue', path: '/pages/hr/bank-change', hrPage: true })
      hrFavoriteModules.value = modules
    } catch {
      // Keep regular business shortcuts available if the account has no HR access.
    }
  }

  let defaultModules = ['input', 'report', 'history', 'reminders']
  try {
    const settings = await publicRequest<Decoration>('/api/miniapp/decoration')
    decoration.value = settings
    defaultModules = settings.defaultHomeModules
  } catch { /* use the bundled defaults when offline */ }

  if (hasSession.value) {
    try {
      const settings = await request<{ modules: string[]; customized: boolean }>('/api/miniapp/me/favorites')
      favorites.value = [...new Set((settings.modules ?? []).filter((id) => typeof id === 'string'))].slice(0, 8)
      favoriteSettingsReady.value = true
    } catch {
      favorites.value = defaultModules
      favoriteSettingsReady.value = false
    }
  } else {
    favorites.value = defaultModules
    favoriteSettingsReady.value = false
  }
}

async function saveFavorites(next: string[]) {
  if (!hasSession.value || !favoriteSettingsReady.value || savingFavorites.value) return false
  const previous = favorites.value
  favorites.value = next
  savingFavorites.value = true
  try {
    const saved = await request<{ modules: string[] }>('/api/miniapp/me/favorites', 'PUT', { modules: next })
    favorites.value = saved.modules
    return true
  } catch (cause) {
    favorites.value = previous
    errorMessage(cause)
    return false
  } finally {
    savingFavorites.value = false
  }
}

async function addFavorite(item: HomeModule) {
  if (savingFavorites.value) return
  // Old account settings may still contain entries that this account no longer
  // has permission to use. They are hidden from the page and must not consume
  // one of the eight visible slots.
  const availableIds = new Set(availableFavorites.value.map((module) => module.id))
  const visibleFavoriteIds = [...new Set(favorites.value.filter((id) => availableIds.has(id)))]
  if (visibleFavoriteIds.length >= 8) {
    uni.showToast({ title: '\u5e38\u7528\u529f\u80fd\u6700\u591a\u6dfb\u52a0 8 \u9879', icon: 'none' })
    return
  }
  if (await saveFavorites([...visibleFavoriteIds, item.id]))
    uni.showToast({ title: '已添加到常用功能', icon: 'success' })
}

function toggleFavoriteEditing() {
  if (!hasSession.value) {
    uni.showToast({ title: '\u8bf7\u5148\u767b\u5f55\uff0c\u5e38\u7528\u529f\u80fd\u6309\u8d26\u53f7\u4fdd\u5b58', icon: 'none' })
    uni.switchTab({ url: '/pages/profile/index' })
    return
  }
  if (!favoriteSettingsReady.value) {
    uni.showToast({ title: '\u8d26\u53f7\u8bbe\u7f6e\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5', icon: 'none' })
    return
  }
  editingFavorites.value = !editingFavorites.value
}

function openFavorite(item: HomeModule) {
  if (!hasSession.value) {
    uni.switchTab({ url: '/pages/profile/index' })
    return
  }
  if (editingFavorites.value) {
    if (!savingFavorites.value) void saveFavorites(favorites.value.filter((id) => id !== item.id))
    return
  }
  if (item.id === 'report') open(`/pages/report/index?date=${date.value}`)
  else if (item.hrInput) {
    if (!hrTargetStoreId.value) {
      uni.showToast({ title: '当前没有可填报的授权门店', icon: 'none' })
      return
    }
    open(`/pages/input/index?storeId=${hrTargetStoreId.value}&employee=1`)
  }
  else if (item.hrPage) {
    if (hrTargetStoreId.value) open(`/pages/hr/${item.path}?storeId=${hrTargetStoreId.value}`)
    else uni.showToast({ title: '当前没有对应的人事门店权限', icon: 'none' })
  }
  else open(item.path)
}

onShow(load)
onShow(() => { void loadFavorites() })

function selectStore(id: number) {
  if (id === selectedStore.value) return
  uni.setStorageSync('storeId', id)
  selectedStore.value = id
  load()
  void loadFavorites()
}

function open(path: string) {
  uni.navigateTo({ url: path })
}

function openNotifications() {
  if (!hasSession.value) {
    uni.switchTab({ url: '/pages/profile/index' })
    return
  }
  open('/pages/notifications/index')
}

const money = (value: number | null | undefined) => value == null
  ? '—' : Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
</script>

<template>
  <view class="page home-page">
    <view v-if="!hasSession" class="login-state">
      <view class="login-prompt" @click="uni.switchTab({ url: '/pages/profile/index' })">
        <view class="login-mark">米</view>
        <view class="login-copy"><text class="login-title">登录后开始使用</text>
          <text class="login-subtitle">查看门店经营数据、排班和待办消息</text></view>
        <button class="login-button" @click.stop="uni.switchTab({ url: '/pages/profile/index' })">立即登录</button>
      </view>
    </view>
    <view v-else class="authenticated-home">
    <view v-if="stores.length > 1 && !canViewHomeSales" class="store-switch standalone-store-switch">
      <text class="switch-label">当前门店</text>
      <scroll-view scroll-x class="store-scroll">
        <view class="store-options">
          <view v-for="store in stores" :key="store.id" class="store-option"
            :class="{ selected: selectedStore === store.id }" @click="selectStore(store.id)">{{ store.storeName }}</view>
        </view>
      </scroll-view>
    </view>
    <view v-if="canViewHomeSales" class="hero">
      <view class="hero-glow glow-one" /><view class="hero-glow glow-two" />
      <view class="hero-content">
        <view class="hero-top">
          <image v-if="bannerUrl" class="hero-banner" :src="bannerUrl" mode="aspectFill" />
          <view v-if="bannerUrl" class="hero-image-shade" />
          <view><text class="brand">{{ decoration.homeTitle }}</text>
            <text class="hero-subtitle">{{ decoration.homeSubtitle }}</text>
            <text class="hero-store">{{ report?.store?.name || stores.find(item => item.id === selectedStore)?.storeName || '米熊门店' }}</text>
          </view>
          <text class="hero-date">{{ date }}</text>
        </view>
        <view v-if="stores.length > 1" class="store-switch">
          <text class="switch-label">当前门店</text>
          <scroll-view scroll-x class="store-scroll">
            <view class="store-options">
              <view v-for="store in stores" :key="store.id" class="store-option"
                :class="{ selected: selectedStore === store.id }" @click="selectStore(store.id)">{{ store.storeName }}</view>
            </view>
          </scroll-view>
        </view>
        <view class="hero-amount">
          <text class="hero-caption">{{ loading ? '正在更新经营数据' : '今日总销售' }}</text>
          <view class="amount-line"><text class="currency">¥</text>
            <text class="hero-number">{{ money(report?.sales?.total?.amount) }}</text></view>
        </view>
        <view class="hero-metrics">
          <view><text class="metric-label">总入客</text><text class="metric-value">{{ report?.sales?.total?.customers ?? '—' }}</text></view>
          <view><text class="metric-label">客单价</text><text class="metric-value">¥{{ money(report?.sales?.total?.avgOrderValue) }}</text></view>
        </view>
      </view>
    </view>

    <view v-if="message && hasSession" class="notice-card">
      <text class="notice-title">经营数据暂不可用</text>
      <text class="notice-detail">{{ message }}</text>
      <view class="notice-action" @click="load()">
        重新加载 <text>›</text>
      </view>
    </view>

    <view v-if="hasSession" class="inbox-shortcut" @click="openNotifications">
      <view class="inbox-shortcut-icon">铃</view>
      <view class="inbox-shortcut-copy">
        <text class="inbox-shortcut-title">消息通知</text>
        <text class="inbox-shortcut-description">排班、审批和流程动态</text>
      </view>
      <view v-if="unreadCount" class="inbox-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</view>
      <text v-else class="inbox-read-state">查看</text>
      <text class="inbox-shortcut-arrow">›</text>
    </view>

    <view class="module-section favorites-section">
      <view class="section-heading"><view><text class="section-kicker">常用功能</text>
        <text class="section-name">常用功能</text></view>
        <text v-if="report" class="fill-status" :class="{ done: report.status?.manualInputReady }">
          {{ report.status?.manualInputReady ? '今日已填报' : '今日待填报' }}
        </text>
      </view>
      <view v-if="editingFavorites" class="favorite-edit-hint">编辑模式：点击已添加入口可移除；下方展示当前账号有权限使用的具体功能页面</view>
      <view class="favorite-grid">
        <view v-for="item in shownFavorites" :key="item.id" class="favorite-item" @click="openFavorite(item)">
          <view class="favorite-icon" :class="item.tone"><image :src="`/static/module-icons/${item.icon}.svg`" mode="aspectFit" /></view>
          <text>{{ item.title }}</text><text v-if="editingFavorites" class="remove-favorite">−</text>
        </view>
      </view>
      <view v-if="editingFavorites" class="available-functions">
        <view class="available-functions-heading"><text>可添加的具体功能</text><text>最多显示 8 个常用入口</text></view>
        <view v-if="addableFavorites.length" class="available-functions-grid">
          <view v-for="item in addableFavorites" :key="item.id" class="available-function" @click="addFavorite(item)">
            <view class="available-function-icon" :class="item.tone"><image :src="`/static/module-icons/${item.icon}.svg`" mode="aspectFit" /><text>＋</text></view>
            <text class="available-function-title">{{ item.title }}</text>
          </view>
        </view>
        <view v-else class="available-functions-empty">暂无可添加的功能</view>
      </view>
      <view class="favorite-edit-row" :class="{ editing: editingFavorites }">
        <view class="favorite-edit-copy">
          <text class="favorite-edit-title">{{ editingFavorites ? '正在编辑常用功能' : '自定义常用功能' }}</text>
          <text class="favorite-edit-description">{{ editingFavorites ? '从下方添加具体页面入口，或点上方入口移除' : '设置首页常用入口' }}</text>
        </view>
        <button class="favorite-edit" :class="{ 'is-done': editingFavorites }" :disabled="savingFavorites" @click="toggleFavoriteEditing">
          <text class="favorite-edit-icon">{{ editingFavorites ? '✓' : '✎' }}</text>
          <text>{{ editingFavorites ? '完成' : '编辑常用功能' }}</text>
        </button>
      </view>
    </view>
    </view>
  </view>
</template>

<style scoped>
.home-page{box-sizing:border-box;min-height:calc(100vh - 120rpx);padding-top:24rpx;padding-bottom:60rpx}
.login-state{display:flex;min-height:calc(100vh - 204rpx);align-items:center;justify-content:center;padding:24rpx;box-sizing:border-box}
.login-prompt{display:flex;width:100%;max-width:640rpx;align-items:center;flex-direction:column;gap:18rpx;padding:48rpx 34rpx;border:1rpx solid #f2c7a8;border-radius:30rpx;background:linear-gradient(145deg,#fff5ec,#fff);box-shadow:0 18rpx 44rpx rgba(192,91,37,.12);text-align:center}
.login-mark{display:flex;flex:none;width:88rpx;height:88rpx;align-items:center;justify-content:center;border-radius:28rpx;background:linear-gradient(145deg,#ed7835,#df4f1b);color:#fff;font-size:42rpx;font-weight:800}
.login-copy{display:flex;min-width:0;flex-direction:column;gap:9rpx}.login-title{color:#56351f;font-size:32rpx;font-weight:800}.login-subtitle{color:#886b56;font-size:23rpx;line-height:1.55}.login-button{width:100%;height:78rpx;margin:8rpx 0 0;padding:0 24rpx;border:0;border-radius:18rpx;background:#e85e20;color:#fff;font-size:27rpx;font-weight:700;line-height:78rpx}.login-button::after{border:0}
.authenticated-home{width:100%}
.favorites-section{margin-top:0;margin-bottom:26rpx}
.hero{position:relative;overflow:hidden;padding:34rpx;border-radius:30rpx;background:linear-gradient(135deg,#1a2b45 0%,#263d5f 100%);color:#fff;box-shadow:0 18rpx 40rpx rgba(24,37,61,.16)}.hero-banner{position:absolute;inset:0;width:100%;height:100%;z-index:0}.hero-image-shade{position:absolute;inset:0;z-index:0;background:linear-gradient(100deg,rgba(15,27,44,.86),rgba(15,27,44,.3))}
.hero-glow{position:absolute;border-radius:50%;pointer-events:none}.glow-one{width:310rpx;height:310rpx;right:-100rpx;top:-146rpx;background:rgba(248,132,71,.17)}.glow-two{width:210rpx;height:210rpx;right:54rpx;bottom:-140rpx;background:rgba(255,255,255,.06)}
.hero-content{position:relative;z-index:1}.hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16rpx}
.brand{display:block;color:#f7a779;font-size:22rpx;font-weight:700;letter-spacing:1rpx}.hero-subtitle{display:block;margin-top:4rpx;color:#d4deea;font-size:19rpx}.hero-store{display:block;margin-top:10rpx;font-size:37rpx;font-weight:700}
.hero-date{flex:none;padding:8rpx 14rpx;border:1rpx solid rgba(255,255,255,.14);border-radius:999rpx;background:rgba(255,255,255,.1);color:#e9eef5;font-size:22rpx}
.store-switch{margin-top:22rpx;padding-top:18rpx;border-top:1rpx solid rgba(255,255,255,.15)}.switch-label{display:block;margin-bottom:10rpx;color:#bdc9da;font-size:20rpx}
.store-scroll{width:100%;white-space:nowrap}.store-options{display:inline-flex;gap:10rpx}.store-option{padding:9rpx 16rpx;border:1rpx solid rgba(255,255,255,.2);border-radius:12rpx;color:#e7edf5;font-size:21rpx}.store-option.selected{border-color:#f7a779;background:#f7a779;color:#3c2b23;font-weight:700}
.standalone-store-switch{margin:0 0 24rpx;padding:18rpx 20rpx;border:1rpx solid #e7edf4;border-radius:20rpx;background:#fff}.standalone-store-switch .switch-label{color:#627086}.standalone-store-switch .store-option{border-color:#dfe6ef;color:#526176}.standalone-store-switch .store-option.selected{border-color:#f7a779;background:#fff0e7;color:#a94b1c}
.hero-amount{margin:38rpx 0 28rpx}.hero-caption{display:block;color:#bdc9da;font-size:23rpx}.amount-line{display:flex;align-items:baseline;gap:7rpx;margin-top:2rpx}.currency{font-size:31rpx;font-weight:700}.hero-number{font-size:62rpx;font-weight:750;letter-spacing:-1rpx}
.hero-metrics{display:flex;padding-top:22rpx;border-top:1rpx solid rgba(255,255,255,.18)}.hero-metrics>view{width:50%}.hero-metrics>view+view{padding-left:32rpx;border-left:1rpx solid rgba(255,255,255,.18)}.metric-label{display:block;color:#bdc9da;font-size:21rpx}.metric-value{display:block;margin-top:5rpx;color:#fff;font-size:30rpx;font-weight:700}
.notice-card{margin-top:20rpx;padding:24rpx 28rpx;border:1rpx solid #f3e5da;border-radius:22rpx;background:#fffaf6}.notice-title{display:block;color:#9a532e;font-size:27rpx;font-weight:700}.notice-detail{display:block;margin-top:8rpx;color:#806b5d;font-size:23rpx;line-height:1.55}.notice-action{display:flex;align-items:center;justify-content:space-between;margin-top:16rpx;color:#d86124;font-size:24rpx;font-weight:700}.notice-action text{font-size:36rpx;font-weight:400}
.inbox-shortcut{display:flex;align-items:center;gap:17rpx;margin-top:20rpx;padding:18rpx 20rpx;border:1rpx solid #f0e7e1;border-radius:20rpx;background:#fff;box-shadow:0 7rpx 20rpx rgba(33,48,76,.035)}.inbox-shortcut-icon{display:flex;flex:none;width:64rpx;height:64rpx;align-items:center;justify-content:center;border-radius:19rpx;background:#fff0e7;color:#db5d22;font-size:23rpx;font-weight:700}.inbox-shortcut-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:4rpx}.inbox-shortcut-title{color:#26364c;font-size:24rpx;font-weight:700}.inbox-shortcut-description{color:#8994a4;font-size:19rpx}.inbox-badge{display:flex;min-width:38rpx;height:36rpx;align-items:center;justify-content:center;padding:0 9rpx;border-radius:999rpx;background:#e9533b;color:#fff;font-size:19rpx;font-weight:700}.inbox-read-state{color:#8490a5;font-size:20rpx}.inbox-shortcut-arrow{color:#a0a9b6;font-size:38rpx;line-height:1}
.module-section{margin-top:34rpx}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:16rpx}.section-kicker{display:block;color:#d47543;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.section-name{display:block;margin-top:2rpx;color:#1a2b45;font-size:32rpx;font-weight:750}.fill-status{padding:7rpx 13rpx;border-radius:999rpx;background:#fff0e6;color:#c45620;font-size:20rpx;font-weight:700}.fill-status.done{background:#e5f6ee;color:#21845a}
.favorite-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18rpx 10rpx;padding:22rpx 14rpx;border:1rpx solid #edf0f5;border-radius:24rpx;background:#fff;box-shadow:0 8rpx 24rpx rgba(27,43,70,.045)}.favorite-item{position:relative;display:flex;min-width:0;flex-direction:column;align-items:center;gap:10rpx;color:#354258;font-size:22rpx}.favorite-icon{display:flex;width:76rpx;height:76rpx;align-items:center;justify-content:center;border-radius:22rpx;background:#fff0e7}.favorite-icon image{width:45rpx;height:45rpx}.favorite-icon.blue{background:#eaf1ff}.favorite-icon.mint{background:#e5f7f1}.favorite-icon.purple{background:#f0ecff}.favorite-icon.rose{background:#fff0f1}.remove-favorite{position:absolute;top:-8rpx;right:12rpx;display:flex;width:34rpx;height:34rpx;align-items:center;justify-content:center;border-radius:50%;background:#e9533b;color:#fff;font-size:28rpx;line-height:1}.available-functions{margin-top:16rpx;padding:20rpx 16rpx;border:1rpx solid #dcebe4;border-radius:20rpx;background:#f8fcfa}.available-functions-heading{display:flex;align-items:center;justify-content:space-between;gap:12rpx;margin:0 4rpx 18rpx;color:#253a31;font-size:23rpx;font-weight:700}.available-functions-heading text+text{color:#7b8c83;font-size:18rpx;font-weight:400}.available-functions-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20rpx 8rpx}.available-function{display:flex;min-width:0;flex-direction:column;align-items:center;gap:8rpx;padding:8rpx 2rpx;border-radius:14rpx;background:#fff}.available-function-icon{position:relative;display:flex;width:70rpx;height:70rpx;align-items:center;justify-content:center;border-radius:20rpx;background:#fff0e7}.available-function-icon image{width:42rpx;height:42rpx}.available-function-icon.blue{background:#eaf1ff}.available-function-icon.mint{background:#e5f7f1}.available-function-icon.purple{background:#f0ecff}.available-function-icon.rose{background:#fff0f1}.available-function-icon>text{position:absolute;right:-7rpx;top:-8rpx;display:flex;width:28rpx;height:28rpx;align-items:center;justify-content:center;border:2rpx solid #fff;border-radius:50%;background:#25976a;color:#fff;font-size:21rpx;line-height:1}.available-function-title{max-width:100%;overflow:hidden;color:#354258;font-size:20rpx;text-overflow:ellipsis;white-space:nowrap}.available-functions-empty{padding:22rpx 0;color:#8b98a9;font-size:21rpx;text-align:center}.favorite-edit-row{display:flex;align-items:center;justify-content:space-between;gap:16rpx;margin-top:18rpx;padding:18rpx 20rpx;border:1rpx solid #f0e4dc;border-radius:20rpx;background:#fff8f3}.favorite-edit-row.editing{border-color:#ccebdc;background:#f2fbf6}.favorite-edit-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:5rpx}.favorite-edit-title{color:#26364c;font-size:23rpx;font-weight:700}.favorite-edit-description{color:#778397;font-size:19rpx;line-height:1.35}.favorite-edit{display:flex;flex:none;align-items:center;justify-content:center;gap:8rpx;min-width:210rpx;height:76rpx;margin:0;padding:0 18rpx;border:0;border-radius:16rpx;background:linear-gradient(135deg,#ef762f,#e95d20);box-shadow:0 7rpx 16rpx rgba(220,92,34,.22);color:#fff;font-size:22rpx;font-weight:700;line-height:76rpx}.favorite-edit::after{border:0}.favorite-edit.is-done{background:linear-gradient(135deg,#25976a,#16845b);box-shadow:0 7rpx 16rpx rgba(22,132,91,.2)}.favorite-edit-icon{font-size:27rpx;line-height:1}.favorite-edit-hint{margin:-2rpx 4rpx 14rpx;padding:13rpx 16rpx;border-radius:14rpx;background:#fff5ec;color:#a34d21;font-size:20rpx;line-height:1.4}
</style>
