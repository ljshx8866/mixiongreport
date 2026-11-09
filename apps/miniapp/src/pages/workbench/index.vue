<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import ModuleTile from '../../components/ModuleTile.vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { businessDate, errorMessage } from '../../utils/session'

type HrStore = { id: number; storeName: string; permissionCodes: string[] }
type WorkModule = { id: string; title: string; caption: string; icon: 'input' | 'report' | 'history' | 'reminder' | 'people' | 'my-schedule' | 'my-work' | 'schedule' | 'time' | 'correction' | 'transfer'; tone: 'orange' | 'blue' | 'mint' | 'purple' | 'rose'; path: string }

const hrEnabled = import.meta.env.VITE_HR_FEATURES_ENABLED === 'true'
const loggedIn = ref(false)
const loading = ref(false)
const message = ref('')
const hrStores = ref<HrStore[]>([])
const permissions = ref<string[]>([])
const hasPermission = (code: string) => permissions.value.includes(code)
const dailyModules = computed<WorkModule[]>(() => {
  const result: WorkModule[] = []
  if (hasPermission('HR_DAILY_INPUT_WRITE')) result.push(
    { id: 'input', title: '每日填报', caption: '填写门店经营数据', icon: 'input', tone: 'orange', path: '/pages/input/index' },
  )
  if (hasPermission('HR_DAILY_REPORT_READ')) result.push(
    { id: 'report', title: '经营日报', caption: '查看今日经营情况', icon: 'report', tone: 'blue', path: '/pages/report/index' },
  )
  if (hasPermission('HR_HISTORY_REPORT_READ')) result.push(
    { id: 'history', title: '历史日报', caption: '按日期查看日报', icon: 'history', tone: 'mint', path: '/pages/history/index' },
  )
  if (hasPermission('HR_REMINDER_READ') || hasPermission('HR_REMINDER_PROCESS')) result.push(
    { id: 'reminders', title: '填报提醒', caption: '查看和处理提醒', icon: 'reminder', tone: 'purple', path: '/pages/reminders/index' },
  )
  return result
})
const scheduleModules = computed<WorkModule[]>(() => {
  if (!hrEnabled || !loggedIn.value) return []
  const has = (code: string) => permissions.value.includes(code)
  const hasAny = (...codes: string[]) => codes.some(has)
  const result: WorkModule[] = []
  if (['HR_SCHEDULE_LIST_READ', 'HR_SCHEDULE_DRAFT_EDIT', 'HR_SCHEDULE_PUBLISH', 'HR_SCHEDULE_REVISE'].some(has))
    result.push({ id: 'schedule', title: '门店排班', caption: '多人排班并统一发布', icon: 'schedule', tone: 'orange', path: 'schedule' })
  if (['HR_SHIFT_TEMPLATE_READ', 'HR_SHIFT_TEMPLATE_EDIT', 'HR_SHIFT_TEMPLATE_DELETE'].some(has))
    result.push({ id: 'shift-templates', title: '班次设置', caption: '维护本门店班次模板', icon: 'schedule', tone: 'blue', path: 'shift-templates' })
  if (['HR_SCHEDULE_POINT_READ', 'HR_SCHEDULE_POINT_EDIT', 'HR_SCHEDULE_POINT_DELETE'].some(has))
    result.push({ id: 'schedule-points', title: '点位设置', caption: '维护本门店排班点位', icon: 'schedule', tone: 'mint', path: 'schedule-points' })
  if (['HR_TIME_LIST_READ', 'HR_TIME_ADJUST', 'HR_TIME_CONFIRM_ONE', 'HR_TIME_BULK_CONFIRM'].some(has)) result.push({ id: 'time', title: '当日工时', caption: '确认当日实际出勤', icon: 'time', tone: 'blue', path: 'time' })
  if (has('HR_WORK_STATISTICS_READ')) result.push({ id: 'work-statistics', title: '工时统计', caption: '按人员和日期筛选汇总工时', icon: 'time', tone: 'mint', path: 'work-statistics' })
  if (['HR_TIME_CORRECTION_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE'].some(has)) result.push({ id: 'correction', title: '工时更正', caption: '按权限直接调整已确认工时', icon: 'correction', tone: 'purple', path: 'correction' })
  return result
})
const personnelModules = computed<WorkModule[]>(() => {
  if (!hrEnabled || !loggedIn.value) return []
  const result: WorkModule[] = []
  if (hasPermission('HR_TRIAL_MANAGE')) result.push({ id: 'trials', title: '试岗管理', caption: '录入试岗人员并安排班次', icon: 'people', tone: 'mint', path: 'trials' })
  if (hasPermission('HR_EMPLOYEE_LIST_READ')) result.push({ id: 'employees', title: '员工列表', caption: '查看授权门店员工名册', icon: 'people', tone: 'blue', path: 'employees' })
  if (['HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE', 'HR_SALARY_CHANGE_APPROVE', 'HR_MONTH_APPROVE',
    'HR_ONBOARDING_APPROVE', 'HR_OFFBOARDING_APPROVE', 'HR_BANK_CHANGE_APPROVE', 'HR_BANK_CHANGE_VERIFY'].some(hasPermission) ||
    permissions.value.some((code) => code.startsWith('HR_TRANSFER_APPROVE_'))) {
    result.push({ id: 'approvals', title: '审批列表', caption: '集中处理当前待办审批', icon: 'correction', tone: 'purple', path: 'approvals' })
  }
  if (hasPermission('HR_TRANSFER_REQUEST') || permissions.value.some((code) => code.startsWith('HR_TRANSFER_APPROVE_'))) result.push({ id: 'transfer', title: '员工转店', caption: '发起与审批转店', icon: 'transfer', tone: 'rose', path: 'transfer' })
  if (['HR_ONBOARDING_CREATE', 'HR_ONBOARDING_LIST_READ', 'HR_ONBOARDING_VERIFY', 'HR_ONBOARDING_APPROVE'].some(hasPermission)) result.push({ id: 'onboarding', title: '员工入职', caption: '资料核验与审批', icon: 'people', tone: 'mint', path: 'onboarding' })
  if (['HR_OFFBOARDING_REQUEST', 'HR_OFFBOARDING_LIST_READ', 'HR_OFFBOARDING_APPROVE'].some(hasPermission)) result.push({ id: 'offboarding', title: '员工离职', caption: '办理离职申请', icon: 'people', tone: 'purple', path: 'offboarding' })
  if (['HR_SALARY_CHANGE_REQUEST', 'HR_SALARY_CHANGE_LIST_READ', 'HR_SALARY_CHANGE_APPROVE'].some(hasPermission))
    result.push({ id: 'salary-change', title: '调薪申请', caption: '提交或查看薪资变更', icon: 'correction', tone: 'orange', path: 'salary-change' })
  if (['HR_BANK_CHANGE_SUBMIT', 'HR_BANK_CHANGE_LIST_READ', 'HR_BANK_CHANGE_VERIFY', 'HR_BANK_CHANGE_APPROVE'].some(hasPermission))
    result.push({ id: 'bank-change', title: '银行卡变更', caption: '提交变更、核验或审批', icon: 'people', tone: 'blue', path: 'bank-change' })
  return result
})

async function load() {
  loggedIn.value = Boolean(uni.getStorageSync('accessToken'))
  message.value = ''
  if (!loggedIn.value) {
    hrStores.value = []
    permissions.value = []
    uni.switchTab({ url: '/pages/index/index' })
    return
  }
  loading.value = true
  try {
    if (hrEnabled) {
      try {
        const access = await request<{ stores: HrStore[] }>('/api/hr/current-access')
        hrStores.value = access.stores ?? []
      } catch {
        hrStores.value = []
      }
    } else {
      hrStores.value = []
    }
    permissions.value = [...new Set(hrStores.value.flatMap((store) => store.permissionCodes ?? []))]
  } catch (error) {
    message.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

onShow(load)

function open(item: WorkModule) {
  if (item.id === 'input' && hasPermission('HR_DAILY_INPUT_WRITE')) {
    uni.navigateTo({ url: '/pages/input/index?employee=1' })
    return
  }
  if (item.id === 'report') {
    uni.navigateTo({ url: `/pages/report/index?date=${businessDate()}` })
    return
  }
  if (item.id === 'history') {
    uni.navigateTo({ url: item.path })
    return
  }
  if (item.path.startsWith('/')) {
    uni.navigateTo({ url: item.path })
    return
  }
  if (item.id === 'salary-change' || item.id === 'bank-change') {
    uni.navigateTo({ url: `/pages/hr/${item.path}` })
    return
  }
  uni.navigateTo({ url: `/pages/hr/${item.path}` })
}
</script>

<template>
  <view class="page workbench-page">
    <PageLoading v-if="loading" />
    <view class="workbench-head">
      <text class="eyebrow">功能中心</text>
      <text class="title">工作台</text>
      <text class="subtitle">经营、排班与人事功能集中在一个工作台</text>
    </view>
    <view v-if="dailyModules.length" class="section">
      <view class="section-title">经营管理</view>
      <view class="module-grid">
        <ModuleTile v-for="item in dailyModules" :key="item.id" :title="item.title" :caption="item.caption" :icon="item.icon" :tone="item.tone" @activate="open(item)" />
      </view>
    </view>
    <view v-if="hrEnabled" class="section">
      <view class="section-heading">
        <view><view class="section-title">门店运营与人事</view><text class="section-caption">按账号权限显示可用操作</text></view>
      </view>
      <view v-if="!loggedIn" class="empty-tip" @click="uni.switchTab({ url: '/pages/profile/index' })">登录后查看授权的门店功能 ›</view>
      <view v-else-if="loading" class="empty-tip">正在读取门店权限…</view>
      <view v-else-if="message" class="empty-tip error" @click="load">{{ message }}　点击重试</view>
      <template v-else>
        <view v-if="scheduleModules.length" class="feature-group">
          <view class="section-title">排班与工时</view>
          <view class="module-grid">
            <ModuleTile v-for="item in scheduleModules" :key="item.id" :title="item.title" :caption="item.caption" :icon="item.icon" :tone="item.tone" @activate="open(item)" />
          </view>
        </view>
        <view v-if="personnelModules.length" class="feature-group">
          <view class="section-title">人事管理</view>
          <view class="module-grid">
            <ModuleTile v-for="item in personnelModules" :key="item.id" :title="item.title" :caption="item.caption" :icon="item.icon" :tone="item.tone" @activate="open(item)" />
          </view>
        </view>
        <view v-if="!scheduleModules.length && !personnelModules.length" class="empty-tip">当前门店暂无已授权功能</view>
      </template>
    </view>
  </view>
</template>

<style scoped>
.workbench-page{padding-top:28rpx;padding-bottom:64rpx}.workbench-head{padding:0 8rpx 28rpx}.title{display:block;margin-top:5rpx;color:#172033;font-size:42rpx;font-weight:750}.subtitle{display:block;margin-top:6rpx;color:#8490a5;font-size:24rpx}.section{margin-top:18rpx;padding:24rpx 22rpx;border:1rpx solid #edf0f5;border-radius:24rpx;background:#fff;box-shadow:0 10rpx 30rpx rgba(33,48,76,.045)}.section-title{color:#1a2b45;font-size:30rpx;font-weight:750}.section-caption{display:block;margin-top:6rpx;color:#8490a5;font-size:21rpx}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12rpx;margin-bottom:20rpx}.feature-group+.feature-group{margin-top:28rpx;padding-top:22rpx;border-top:1rpx solid #edf0f5}.module-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14rpx;margin-top:18rpx}.store-picker{padding:9rpx 14rpx;border-radius:12rpx;background:#fff3eb;color:#c45620;font-size:22rpx}.empty-tip{margin-top:16rpx;padding:20rpx;border-radius:14rpx;background:#f5f7fa;color:#8490a5;font-size:23rpx}.empty-tip.error{background:#fff4f0;color:#c45620}
</style>
