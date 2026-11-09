<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type Message = { id: number; category: string; title: string; summary: string; page: string; createdAt: string; readAt: string | null }
type Inbox = { items: Message[]; total: number; unreadCount: number; page: number; pageSize: number }
type TemplateSetting = { key: string; title: string; description: string; templateId: string; enabled: boolean }
const messages = ref<Message[]>([])
const filter = ref<'ALL' | 'UNREAD'>('UNREAD')
const unreadCount = ref(0)
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const templateSettings = ref<TemplateSetting[]>([])
const loggedIn = ref(Boolean(uni.getStorageSync('accessToken')))
const settingsLoading = ref(false)
const settingsError = ref('')
const settingsExpanded = ref(false)
const savingSettingKey = ref('')
const authorizationBusy = ref(false)
const authorizationMessage = ref('')
const authorizationOffset = ref(0)
const authorizationQueueKeys = ref<string[]>([])
const subscriptionSettingsLoaded = ref(false)
const subscriptionMainSwitchOff = ref(false)
const rejectedTemplateIds = ref<string[]>([])
const hasMore = computed(() => messages.value.length < total.value)
const filterOptions = [{ value: 'ALL', label: '全部' }, { value: 'UNREAD', label: '未读' }] as const
const enabledTemplateSettings = computed(() => templateSettings.value.filter((item) => item.enabled && item.templateId))
const templatesWithRememberedReject = computed(() => templateSettings.value
  .filter((item) => rejectedTemplateIds.value.includes(item.templateId)))
const enabledTemplatesWithRememberedReject = computed(() => enabledTemplateSettings.value
  .filter((item) => rejectedTemplateIds.value.includes(item.templateId)))

async function load(reset = true) {
  if (loading.value || loadingMore.value) return
  if (reset) { page.value = 1; loading.value = true } else loadingMore.value = true
  error.value = ''
  try {
    const nextPage = reset ? 1 : page.value + 1
    const result = await request<Inbox>(`/api/notifications?filter=${filter.value}&page=${nextPage}&pageSize=20`)
    messages.value = reset ? result.items : [...messages.value, ...result.items]
    page.value = result.page
    total.value = result.total
    unreadCount.value = result.unreadCount
  } catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false; loadingMore.value = false }
}

async function loadTemplateSettings() {
  loggedIn.value = Boolean(uni.getStorageSync('accessToken'))
  if (!uni.getStorageSync('accessToken')) {
    templateSettings.value = []
    settingsError.value = ''
    return
  }
  settingsLoading.value = true
  settingsError.value = ''
  try {
    const result = await request<{ items: TemplateSetting[] }>('/api/notifications/settings')
    templateSettings.value = result.items ?? []
  } catch (cause) {
    settingsError.value = errorMessage(cause)
  } finally { settingsLoading.value = false }
}

function loadWechatSubscriptionState() {
  subscriptionSettingsLoaded.value = false
  uni.getSetting({
    withSubscriptions: true,
    success: (result: { subscriptionsSetting?: { mainSwitch?: boolean; itemSettings?: Record<string, string> } }) => {
      const state = result.subscriptionsSetting
      subscriptionMainSwitchOff.value = state?.mainSwitch === false
      rejectedTemplateIds.value = Object.entries(state?.itemSettings ?? {})
        .filter(([, value]) => value === 'reject').map(([templateId]) => templateId)
      subscriptionSettingsLoaded.value = true
    },
    fail: () => { subscriptionSettingsLoaded.value = true },
  })
}

async function updateTemplateSetting(item: TemplateSetting, enabled: boolean) {
  if (savingSettingKey.value) return
  const previous = item.enabled
  item.enabled = enabled
  savingSettingKey.value = item.key
  authorizationOffset.value = 0
  authorizationQueueKeys.value = []
  authorizationMessage.value = ''
  try {
    await request('/api/notifications/settings', 'PATCH', { key: item.key, enabled })
  } catch (cause) {
    item.enabled = previous
    uni.showModal({ title: '通知设置未保存', content: errorMessage(cause), showCancel: false })
  } finally { savingSettingKey.value = '' }
}

async function handleAuthorizationResult(batch: TemplateSetting[], result: Record<string, string>, start: number) {
  const accepted = batch.filter((item) => result[item.templateId] === 'accept').length
  const notAccepted = batch.filter((item) => result[item.templateId] !== 'accept')
  const failedToSync: string[] = []

  await Promise.all(notAccepted.map(async (item) => {
    try {
      await request('/api/notifications/settings', 'PATCH', { key: item.key, enabled: false })
      item.enabled = false
    } catch {
      failedToSync.push(item.title)
    }
  }))

  const nextOffset = start + batch.length
  authorizationOffset.value = nextOffset
  const remaining = authorizationQueueKeys.value.length - nextOffset
  const resultSummary = `本批授权成功 ${accepted} 项，未授权 ${notAccepted.length} 项；未授权类型已关闭对应开关。`
  const syncWarning = failedToSync.length
    ? ` ${failedToSync.join('、')}的开关同步失败，请检查网络后重试。`
    : ''
  const outcomes = batch.map((item) => {
    const status = result[item.templateId]
    return `${item.title}：${status === 'accept' ? '已获得本次发送许可' : status === 'ban' ? '模板已被微信限制' : status === 'reject' ? '微信记住了拒绝选择，已关闭开关' : status === 'filter' ? '模板标题重复，被微信过滤' : '微信未返回授权结果'}`
  }).join('\n')

  if (remaining > 0) {
    authorizationMessage.value = `${resultSummary}还有 ${remaining} 项，请点击下方按钮继续授权。${syncWarning}`
  } else {
    authorizationOffset.value = 0
    authorizationQueueKeys.value = []
    authorizationMessage.value = `${resultSummary}一次授权只提供本次模板消息的发送许可，之后的新消息需要再次授权。${syncWarning}`
  }
  uni.showModal({
    title: accepted ? '授权结果' : '授权未完成',
    content: `${outcomes}${remaining > 0 ? `\n\n还有 ${remaining} 项待授权，请点击按钮继续。` : ''}${syncWarning}`,
    showCancel: false,
  })
  authorizationBusy.value = false
}

function showAuthorizationFailure(cause: unknown) {
  const detail = typeof cause === 'object' && cause !== null && 'errMsg' in cause
    ? String((cause as { errMsg?: unknown }).errMsg ?? '')
    : cause instanceof Error ? cause.message : String(cause ?? '')
  const code = typeof cause === 'object' && cause !== null && 'errCode' in cause
    ? Number((cause as { errCode?: unknown }).errCode)
    : typeof cause === 'object' && cause !== null && 'errno' in cause
      ? Number((cause as { errno?: unknown }).errno) : 0
  const lower = detail.toLowerCase()
  const guidance = code === 20004
    ? '微信的订阅消息总开关已关闭。请到小程序右上角“…”→“设置”→“订阅消息”打开后再试。'
    : code === 20002
      ? '微信检测到模板类型不一致。系统已改为逐个模板申请；请更新到最新开发版后重试。'
    : lower.includes('invalid template') || lower.includes('template_id') || code === 20001 || code === 10004
    ? '微信没有识别当前模板，请检查小程序后台是否已添加并审核通过这些订阅消息模板。'
    : lower.includes('tap gesture')
      ? '请在此页面直接点击授权按钮后重试。'
      : '微信没有打开授权窗口，请确认当前使用的是微信小程序，并更新到较新的微信版本后重试。'
  authorizationMessage.value = `${guidance}${detail ? `（${detail}）` : ''}`
  uni.showModal({ title: '微信授权未完成', content: authorizationMessage.value, showCancel: false })
}

function authorizeEnabledTemplates() {
  if (authorizationBusy.value || savingSettingKey.value) return
  const enabled = enabledTemplateSettings.value
  if (!subscriptionSettingsLoaded.value) {
    authorizationMessage.value = '正在读取微信订阅设置，请稍后再点授权。'
    uni.showModal({ title: '正在读取设置', content: authorizationMessage.value, showCancel: false })
    return
  }
  if (subscriptionMainSwitchOff.value || templatesWithRememberedReject.value.length) {
    const names = templatesWithRememberedReject.value.map((item) => item.title).join('、')
    const message = subscriptionMainSwitchOff.value
      ? '订阅消息总开关已关闭，授权窗口不会弹出。请打开小程序右上角“…”→“设置”→“订阅消息”，开启总开关和需要接收的通知。'
      : `微信已记住${names}的拒绝选择，所以不会再弹出授权窗口。请打开小程序右上角“…”→“设置”→“订阅消息”，开启对应通知后再回来授权。`
    authorizationMessage.value = message
    uni.showModal({ title: '请在微信设置中开启', content: message, showCancel: false })
    return
  }
  if (!enabled.length) {
    authorizationMessage.value = '请先打开至少一种通知，再申请微信订阅授权。'
    uni.showModal({ title: '还没有开启通知', content: authorizationMessage.value, showCancel: false })
    return
  }
  if (!authorizationQueueKeys.value.length || authorizationOffset.value >= authorizationQueueKeys.value.length) {
    authorizationQueueKeys.value = enabled.map((item) => item.key)
    authorizationOffset.value = 0
  }
  const start = authorizationOffset.value
  const batch = authorizationQueueKeys.value
    .slice(start, start + 1)
    .map((key) => templateSettings.value.find((item) => item.key === key))
    .filter((item): item is TemplateSetting => Boolean(item))
  if (!batch.length) {
    authorizationQueueKeys.value = []
    authorizationOffset.value = 0
    return
  }

  authorizationBusy.value = true
  authorizationMessage.value = ''
  try {
    uni.requestSubscribeMessage({
      tmplIds: batch.map((item) => item.templateId),
      success: (result: Record<string, string>) => { void handleAuthorizationResult(batch, result, start) },
      fail: (cause: unknown) => { showAuthorizationFailure(cause); authorizationBusy.value = false },
    })
  } catch (cause) {
    showAuthorizationFailure(cause)
    authorizationBusy.value = false
  }
}

function chooseFilter(value: 'ALL' | 'UNREAD') {
  if (filter.value === value) return
  filter.value = value
  void load()
}

async function markAllRead() {
  if (!unreadCount.value) return
  try {
    await request('/api/notifications/read-all', 'POST')
    uni.showToast({ title: '已全部标记为已读', icon: 'success' })
    await load()
  } catch (cause) { uni.showModal({ title: '操作未完成', content: errorMessage(cause), showCancel: false }) }
}

async function openMessage(message: Message) {
  if (!message.readAt) {
    message.readAt = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
    void request<{ readAt: string }>(`/api/notifications/${message.id}/read`, 'PATCH')
      .then((result) => { message.readAt = result.readAt })
      .catch(() => { message.readAt = null; unreadCount.value += 1 })
  }
  if (message.page) {
    const url = message.page.startsWith('/') ? message.page : `/${message.page}`
    uni.navigateTo({ url, fail: () => uni.showModal({ title: '页面暂时无法打开',
      content: '目标页面无法打开，请返回后重试。', showCancel: false }) })
  }
  else uni.showToast({ title: '已标记为已读', icon: 'none' })
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

onShow(() => { filter.value = 'UNREAD'; settingsExpanded.value = false; void load(); void loadTemplateSettings(); loadWechatSubscriptionState() })
</script>

<template>
  <view class="page detail-page inbox-page">
    <view class="inbox-hero">
      <view>
        <text class="inbox-kicker">消息中心</text>
        <text class="inbox-title">消息通知</text>
        <text class="inbox-caption">排班、审批及流程动态都会显示在这里</text>
      </view>
      <view class="hero-actions">
        <view class="settings-toggle" :class="{ active: settingsExpanded }" @click="settingsExpanded = !settingsExpanded">
          <text class="settings-icon">{{ settingsExpanded ? '×' : '⚙' }}</text>
          <text>{{ settingsExpanded ? '收起' : '设置' }}</text>
        </view>
        <view class="unread-count"><text>{{ unreadCount }}</text><text>条未读</text></view>
      </view>
    </view>

    <view v-if="settingsExpanded" class="settings-card">
      <view class="settings-heading">
        <view><text class="settings-title">通知授权与开关</text>
          <text class="settings-description">开关控制系统发送偏好；微信模板授权按次生效</text></view>
        <text class="settings-badge">一次性订阅</text>
      </view>
      <PageLoading v-if="settingsLoading && !templateSettings.length" text="正在读取通知设置" />
      <view v-else-if="settingsError" class="settings-error">
        <text>{{ settingsError }}</text><text class="settings-retry" @click="loadTemplateSettings">重新加载</text>
      </view>
      <view v-else-if="!templateSettings.length" class="settings-login" @click="!loggedIn && uni.switchTab({ url: '/pages/profile/index' })">
        {{ loggedIn ? '当前账号没有需要设置的通知类型' : '登录后可以设置通知开关和授权 ›' }}
      </view>
      <template v-else>
        <view v-if="subscriptionMainSwitchOff || templatesWithRememberedReject.length" class="authorization-warning">
          系统已记住拒绝选择或消息通知总开关已关闭，因此不会弹出授权框。请到小程序右上角“…”→“设置”→“订阅消息”开启后再回来操作。
        </view>
        <view v-for="item in templateSettings" :key="item.key" class="setting-row">
          <view class="setting-copy"><text class="setting-name">{{ item.title }}</text>
            <text class="setting-note">{{ item.description }}</text></view>
          <switch :checked="item.enabled" :disabled="savingSettingKey === item.key || authorizationBusy"
            color="#ed6427" @change="updateTemplateSetting(item, $event.detail.value)" />
        </view>
        <button class="authorize-button" :loading="authorizationBusy" :disabled="authorizationBusy || Boolean(savingSettingKey)"
          @click="authorizeEnabledTemplates">
          {{ authorizationBusy ? '正在打开授权…' : authorizationOffset ? '继续授权下一批' : '申请微信订阅授权' }}
        </button>
        <text class="authorization-hint">开关表示允许系统发送对应类型，不代表永久授权。每次授权只许可本次模板消息发送；之后的新排班、审批或填报提醒需要再次授权。拒绝授权会自动关闭对应开关；站内通知不受影响。</text>
        <text v-if="authorizationMessage" class="authorization-result">{{ authorizationMessage }}</text>
      </template>
    </view>

    <view class="inbox-toolbar">
      <view class="filter-tabs">
        <view v-for="option in filterOptions" :key="option.value" class="filter-tab"
          :class="{ active: filter === option.value }" @click="chooseFilter(option.value)">{{ option.label }}</view>
      </view>
      <text v-if="unreadCount" class="mark-all" @click="markAllRead">全部已读</text>
    </view>

    <PageLoading v-if="loading && !messages.length" text="正在加载通知" />
    <view v-else-if="error && !messages.length" class="card empty-state">
      <text class="empty-title">通知加载失败</text><text class="empty-copy">{{ error }}</text>
      <button class="button secondary retry-button" @click="load()">重新加载</button>
    </view>
    <view v-else-if="!messages.length" class="card empty-state">
      <view class="empty-icon">✓</view><text class="empty-title">暂时没有{{ filter === 'UNREAD' ? '未读' : '' }}通知</text>
      <text class="empty-copy">有新的排班、审批或修改提醒时，会自动显示在这里</text>
    </view>

    <view v-else class="message-list">
      <view v-for="item in messages" :key="item.id" class="message-card" :class="{ unread: !item.readAt }" @click="openMessage(item)">
        <view class="message-icon" :class="item.category.toLowerCase()">
          <text>{{ item.category === 'SCHEDULE' ? '班' : item.category === 'REMINDER' ? '填' : item.category === 'CORRECTION' ? '改' : item.category === 'RESULT' ? '✓' : '审' }}</text>
        </view>
        <view class="message-main">
          <view class="message-heading"><text class="message-title">{{ item.title }}</text><view v-if="!item.readAt" class="unread-dot" /></view>
          <text class="message-summary">{{ item.summary }}</text>
          <text class="message-time">{{ formatTime(item.createdAt) }}</text>
        </view>
        <text class="message-arrow">›</text>
      </view>
      <button v-if="hasMore" class="load-more" :disabled="loadingMore" @click="load(false)">
        {{ loadingMore ? '正在加载…' : '加载更多' }}
      </button>
      <text v-else class="list-end">共 {{ total }} 条通知</text>
    </view>
  </view>
</template>

<style scoped>
.inbox-page{padding-top:22rpx}.inbox-hero{display:flex;align-items:center;justify-content:space-between;gap:16rpx;margin-bottom:24rpx;padding:28rpx;border-radius:24rpx;background:linear-gradient(135deg,#192c48,#2c4669);color:#fff}.inbox-hero>view:first-child{min-width:0;flex:1}.inbox-kicker,.inbox-title,.inbox-caption{display:block}.inbox-kicker{color:#ffc29e;font-size:18rpx;font-weight:700;letter-spacing:2rpx}.inbox-title{margin-top:5rpx;font-size:37rpx;font-weight:750}.inbox-caption{margin-top:8rpx;color:#d0d9e6;font-size:21rpx}.hero-actions{display:flex;flex:none;align-items:center;gap:12rpx}.settings-toggle{display:flex;width:74rpx;height:94rpx;flex:none;flex-direction:column;align-items:center;justify-content:center;border:1rpx solid rgba(255,255,255,.2);border-radius:18rpx;background:rgba(255,255,255,.08);color:#eaf0f8;font-size:17rpx}.settings-toggle.active{border-color:rgba(255,194,158,.55);background:rgba(255,255,255,.17);color:#ffd3b8}.settings-icon{margin-bottom:4rpx;font-size:33rpx;line-height:1}.unread-count{display:flex;flex:none;flex-direction:column;align-items:center;justify-content:center;width:106rpx;height:106rpx;border:1rpx solid rgba(255,255,255,.18);border-radius:50%;background:rgba(255,255,255,.1)}.unread-count text:first-child{font-size:36rpx;font-weight:750}.unread-count text:last-child{color:#dce4ed;font-size:18rpx}.inbox-toolbar{display:flex;align-items:center;justify-content:space-between;margin:2rpx 2rpx 16rpx}.filter-tabs{display:flex;gap:8rpx;padding:6rpx;border-radius:15rpx;background:#e8edf4}.filter-tab{padding:11rpx 24rpx;border-radius:11rpx;color:#728096;font-size:22rpx}.filter-tab.active{background:#fff;color:#e65d21;font-weight:700;box-shadow:0 3rpx 10rpx rgba(29,45,72,.08)}.mark-all{padding:10rpx 14rpx;color:#d95e25;font-size:21rpx}.message-list{display:flex;flex-direction:column;gap:13rpx}.message-card{display:flex;align-items:flex-start;gap:16rpx;padding:22rpx 20rpx;border:1rpx solid #edf0f5;border-radius:20rpx;background:#fff;box-shadow:0 6rpx 18rpx rgba(33,48,76,.035)}.message-card.unread{border-color:#f1ded2;background:#fffdfa}.message-icon{display:flex;flex:none;width:68rpx;height:68rpx;align-items:center;justify-content:center;border-radius:20rpx;background:#eaf1ff;color:#446eb7;font-size:26rpx;font-weight:700}.message-icon.schedule{background:#e5f7f1;color:#208662}.message-icon.correction{background:#fff0e7;color:#d65c23}.message-icon.result{background:#ebf7ee;color:#218652}.message-main{min-width:0;flex:1}.message-heading{display:flex;align-items:center;gap:10rpx}.message-title{overflow:hidden;color:#1c2a40;font-size:25rpx;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.unread-dot{flex:none;width:13rpx;height:13rpx;border-radius:50%;background:#ed5b31}.message-summary{display:block;margin-top:8rpx;color:#637087;font-size:22rpx;line-height:1.5}.message-time{display:block;margin-top:11rpx;color:#9ba5b3;font-size:19rpx}.message-arrow{padding:14rpx 0;color:#a3adba;font-size:42rpx;line-height:1}.empty-state{display:flex;min-height:300rpx;flex-direction:column;align-items:center;justify-content:center;text-align:center}.empty-icon{display:flex;width:78rpx;height:78rpx;align-items:center;justify-content:center;border-radius:50%;background:#e5f7ef;color:#27966a;font-size:38rpx}.empty-title{margin-top:16rpx;color:#27374e;font-size:28rpx;font-weight:700}.empty-copy{max-width:560rpx;margin-top:8rpx;color:#8793a4;font-size:22rpx;line-height:1.5}.retry-button{margin-top:20rpx}.load-more{margin-top:6rpx;border:1rpx solid #e7ebf1;border-radius:15rpx;background:#fff;color:#66748a;font-size:23rpx}.load-more::after{border:0}.list-end{padding:16rpx;color:#a1aab7;font-size:20rpx;text-align:center}
</style>

<style>
.settings-card{margin-bottom:22rpx;padding:23rpx 22rpx;border:1rpx solid #e8edf3;border-radius:22rpx;background:#fff;box-shadow:0 7rpx 20rpx rgba(33,48,76,.035)}.settings-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12rpx;margin-bottom:12rpx}.settings-title,.settings-description{display:block}.settings-title{color:#1d2c43;font-size:27rpx;font-weight:750}.settings-description{margin-top:6rpx;color:#8994a5;font-size:20rpx;line-height:1.5}.settings-badge{flex:none;padding:7rpx 12rpx;border-radius:999rpx;background:#fff1e8;color:#d95e25;font-size:18rpx}.authorization-warning{margin:10rpx 0 14rpx;padding:14rpx 16rpx;border:1rpx solid #f5d7b8;border-radius:14rpx;background:#fff8ef;color:#9a4b17;font-size:20rpx;line-height:1.55}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:12rpx;padding:17rpx 0;border-top:1rpx solid #f0f2f6}.setting-copy{min-width:0;flex:1}.setting-name,.setting-note{display:block}.setting-name{color:#26354b;font-size:24rpx;font-weight:650}.setting-note{margin-top:5rpx;color:#8792a2;font-size:19rpx;line-height:1.45}.setting-row switch{flex:none;transform:scale(.86);transform-origin:right center}.authorize-button{margin:17rpx 0 0;border:0;border-radius:14rpx;background:#e85e22;color:#fff;font-size:23rpx}.authorize-button::after{border:0}.authorize-button[disabled]{background:#c9ced6;color:#fff}.authorization-hint,.authorization-result{display:block;margin-top:11rpx;color:#9099a7;font-size:19rpx;line-height:1.55}.authorization-result{padding:12rpx;border-radius:12rpx;background:#f3f7fb;color:#4e6077}.settings-error,.settings-login{padding:20rpx 0;color:#b45309;font-size:21rpx}.settings-retry{display:inline-block;margin-left:15rpx;color:#d95e25}.settings-login{color:#65748a}
</style>
