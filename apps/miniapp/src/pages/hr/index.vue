<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import ModuleTile from '../../components/ModuleTile.vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { currentStoreId, errorMessage } from '../../utils/session'

type Store = { id: number; storeName: string; permissionCodes: string[] }
const stores = ref<Store[]>([])
const storeId = ref(0)
const loading = ref(false)
const loggedIn = ref(false)
const message = ref('')
const permissions = ref<string[]>([])
const isEmployee = ref(false)

const hasScheduleTools = computed(() => permissions.value.some((item) =>
  ['HR_SCHEDULE_LIST_READ', 'HR_SCHEDULE_DRAFT_EDIT', 'HR_SCHEDULE_PUBLISH', 'HR_SCHEDULE_REVISE', 'HR_TIME_LIST_READ', 'HR_TIME_CONFIRM_ONE', 'HR_TIME_BULK_CONFIRM', 'HR_TIME_CORRECTION_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE'].includes(item)))
const hasPersonnelTools = computed(() => permissions.value.some((item) =>
  ['HR_TRIAL_MANAGE', 'HR_EMPLOYEE_LIST_READ', 'HR_TRANSFER_REQUEST', 'HR_TRANSFER_LIST_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE', 'HR_SALARY_CHANGE_REQUEST', 'HR_SALARY_CHANGE_LIST_READ', 'HR_SALARY_CHANGE_APPROVE', 'HR_MONTH_APPROVE',
    'HR_ONBOARDING_APPROVE', 'HR_OFFBOARDING_APPROVE', 'HR_BANK_CHANGE_APPROVE', 'HR_BANK_CHANGE_VERIFY', 'HR_EMPLOYEE_EDIT',
    'HR_ONBOARDING_CREATE', 'HR_ONBOARDING_VERIFY', 'HR_OFFBOARDING_REQUEST', 'HR_APPROVAL_LIST_READ'].includes(item) ||
  item.startsWith('HR_TRANSFER_APPROVE_')))
const hasBusinessInput = computed(() => permissions.value.includes('HR_DAILY_INPUT_WRITE'))

async function load() {
  loggedIn.value = Boolean(uni.getStorageSync('accessToken'))
  message.value = ''
  stores.value = []
  permissions.value = []
  isEmployee.value = false
  if (!loggedIn.value) {
    message.value = '请先登录，再查看人事功能'
    return
  }
  loading.value = true
  try {
    const access = await request<{ stores: Store[]; isEmployee?: boolean }>('/api/hr/current-access')
    stores.value = access.stores
    isEmployee.value = Boolean(access.isEmployee)
    const preferred = currentStoreId()
    if (!stores.value.some((store) => store.id === storeId.value)) {
      storeId.value = stores.value.find((store) => store.id === preferred)?.id ?? stores.value[0]?.id ?? 0
    }
    permissions.value = stores.value.find((store) => store.id === storeId.value)?.permissionCodes ?? []
    if (!stores.value.length && !isEmployee.value) message.value = '当前账号尚未获授管理门店和功能角色，请联系总部检查账号权限'
  } catch (error) {
    message.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

onShow(load)

function choose(id: number) {
  storeId.value = id
  permissions.value = stores.value.find((store) => store.id === id)?.permissionCodes ?? []
}

function open(page: string) {
  const query = page.startsWith('my-') ? '' : `?storeId=${storeId.value}`
  uni.navigateTo({ url: `/pages/hr/${page}${query}` })
}

</script>

<template>
  <view class="page hr-page">
    <PageLoading v-if="loading" />
    <view class="hr-hero">
      <view class="hero-decoration" />
      <text class="hero-eyebrow">门店管理</text>
      <text class="hero-title">门店管理</text>
      <text class="hero-subtitle">排班工时与人事事务分区管理</text>
    </view>

    <view v-if="message" class="notice">
      <text>{{ message }}</text>
      <view v-if="!loggedIn" class="notice-link" @click="uni.switchTab({ url: '/pages/profile/index' })">前往登录 ›</view>
    </view>

    <template v-if="loggedIn">
      <view v-if="stores.length" class="store-panel">
        <text class="store-label">当前管理门店</text>
        <view v-if="stores.length === 1" class="single-store">{{ stores[0].storeName }}</view>
        <scroll-view v-else scroll-x class="store-scroll">
          <view class="store-options">
            <view v-for="store in stores" :key="store.id" class="store-option"
              :class="{ selected: store.id === storeId }" @click="choose(store.id)">{{ store.storeName }}</view>
          </view>
        </scroll-view>
      </view>

      <view v-if="hasScheduleTools" class="section">
        <view class="section-heading"><view><text class="section-kicker">排班与工时</text>
          <text class="section-name">排班与工时</text></view></view>
        <view class="module-grid">
          <ModuleTile v-if="permissions.some(item => ['HR_SCHEDULE_LIST_READ','HR_SCHEDULE_DRAFT_EDIT','HR_SCHEDULE_PUBLISH','HR_SCHEDULE_REVISE'].includes(item))" title="门店排班" caption="多人排班并统一发布"
            icon="schedule" tone="orange" @activate="open('schedule')" />
          <ModuleTile v-if="permissions.some(item => ['HR_SHIFT_TEMPLATE_READ','HR_SHIFT_TEMPLATE_EDIT','HR_SHIFT_TEMPLATE_DELETE'].includes(item))" title="班次设置" caption="维护本门店班次模板"
            icon="schedule" tone="blue" @activate="open('shift-templates')" />
          <ModuleTile v-if="permissions.some(item => ['HR_SCHEDULE_POINT_READ','HR_SCHEDULE_POINT_EDIT','HR_SCHEDULE_POINT_DELETE'].includes(item))" title="点位设置" caption="维护本门店排班点位"
            icon="schedule" tone="mint" @activate="open('schedule-points')" />
          <ModuleTile v-if="permissions.some(item => ['HR_TIME_LIST_READ','HR_TIME_ADJUST','HR_TIME_CONFIRM_ONE','HR_TIME_BULK_CONFIRM'].includes(item))" title="当日工时" caption="确认当日实际出勤"
            icon="time" tone="blue" @activate="open('time')" />
          <ModuleTile v-if="permissions.includes('HR_WORK_STATISTICS_READ')" title="工时统计" caption="按人员和日期筛选汇总工时"
            icon="time" tone="mint" @activate="open('work-statistics')" />
          <ModuleTile v-if="permissions.some(item => ['HR_TIME_CORRECTION_READ','HR_TIME_CORRECTION_EDIT','HR_TIME_CORRECTION_DELETE'].includes(item))"
            title="工时更正" caption="按权限调整已确认工时" icon="correction" tone="purple" @activate="open('correction')" />
        </view>
      </view>

      <view v-if="hasPersonnelTools" class="section">
        <view class="section-heading"><view><text class="section-kicker">人事管理</text>
          <text class="section-name">人事管理</text></view></view>
        <view class="module-grid">
          <ModuleTile v-if="permissions.includes('HR_TRIAL_MANAGE')" title="试岗管理" caption="录入试岗人员并安排班次"
            icon="people" tone="mint" @activate="open('trials')" />
          <ModuleTile v-if="permissions.includes('HR_EMPLOYEE_LIST_READ')" title="员工列表" caption="查看授权门店员工名册"
            icon="people" tone="blue" @activate="open('employees')" />
          <ModuleTile v-if="permissions.includes('HR_SALARY_CHANGE_REQUEST')" title="调薪申请" caption="申请调整员工时薪"
            icon="correction" tone="orange" @activate="open('salary-change')" />
          <ModuleTile v-if="permissions.includes('HR_BANK_CHANGE_VERIFY') || permissions.includes('HR_BANK_CHANGE_SUBMIT')" title="银行卡变更申请" caption="现场核验并提交变更"
            icon="people" tone="mint" @activate="open('bank-change')" />
          <ModuleTile v-if="permissions.some(item => ['HR_APPROVAL_LIST_READ','HR_APPROVAL_DETAIL_READ','HR_TIME_CORRECTION_EDIT','HR_TIME_CORRECTION_DELETE','HR_SALARY_CHANGE_APPROVE', 'HR_MONTH_APPROVE', 'HR_ONBOARDING_APPROVE', 'HR_OFFBOARDING_APPROVE', 'HR_BANK_CHANGE_APPROVE', 'HR_BANK_CHANGE_VERIFY'].includes(item) || item.startsWith('HR_TRANSFER_APPROVE_'))"
            title="审批列表" caption="查看和处理审批记录" icon="correction" tone="purple" @activate="open('approvals')" />
          <ModuleTile v-if="permissions.includes('HR_TRANSFER_REQUEST') || permissions.some(item => item.startsWith('HR_TRANSFER_APPROVE_'))"
            title="员工转店" caption="发起与审批转店" icon="transfer" tone="rose" @activate="open('transfer')" />
          <ModuleTile v-if="permissions.some(item => ['HR_ONBOARDING_CREATE', 'HR_ONBOARDING_VERIFY', 'HR_ONBOARDING_APPROVE'].includes(item))"
            title="员工入职" caption="资料核验与审批" icon="people" tone="mint" @activate="open('onboarding')" />
          <ModuleTile v-if="permissions.includes('HR_OFFBOARDING_REQUEST') || permissions.includes('HR_OFFBOARDING_APPROVE')"
            title="员工离职" caption="办理员工离职流程" icon="people" tone="purple" @activate="open('offboarding')" />
        </view>
      </view>

      <view v-if="hasBusinessInput" class="section">
        <view class="section-heading"><view><text class="section-kicker">经营管理</text>
          <text class="section-name">经营填报</text></view></view>
        <view class="module-grid">
          <ModuleTile title="每日填报" caption="填报门店经营数据" icon="input" tone="mint"
            @activate="uni.navigateTo({ url: `/pages/input/index?storeId=${storeId}&employee=1` })" />
        </view>
      </view>

      <view v-if="!hasScheduleTools && !hasPersonnelTools && !hasBusinessInput && !message" class="notice">当前账号暂无门店管理功能权限；个人资料、排班和工时可在「我的」查看。</view>
    </template>
  </view>
</template>

<style scoped>
.hr-page{padding-top:24rpx;padding-bottom:64rpx}
.hr-hero{position:relative;overflow:hidden;padding:36rpx 34rpx 42rpx;border-radius:30rpx;background:linear-gradient(135deg,#fff4ec 0%,#fce7d7 100%);border:1rpx solid #f7dfce}
.hero-decoration{position:absolute;width:220rpx;height:220rpx;right:-46rpx;top:-96rpx;border:36rpx solid rgba(236,110,51,.09);border-radius:50%}
.hero-eyebrow{position:relative;display:block;color:#c96a35;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.hero-title{position:relative;display:block;margin-top:10rpx;color:#2a3447;font-size:43rpx;font-weight:750}.hero-subtitle{position:relative;display:block;margin-top:10rpx;color:#785f52;font-size:23rpx}
.notice{margin-top:20rpx;padding:24rpx;border-radius:20rpx;background:#fff;color:#8a5135;font-size:24rpx}.notice-link{margin-top:14rpx;color:#dd6225;font-weight:700}
.section{margin-top:34rpx}.section-heading{margin-bottom:16rpx}.section-kicker{display:block;color:#d47543;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.section-name{display:block;margin-top:2rpx;color:#1a2b45;font-size:32rpx;font-weight:750}
.module-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14rpx}
.subscribe-card{display:flex;flex-wrap:wrap;align-items:center;gap:12rpx;margin-top:20rpx;padding:22rpx;border:1rpx solid #f2dfd2;border-radius:20rpx;background:#fffaf6}.subscribe-copy{flex:1;min-width:0}.subscribe-title{display:block;color:#27364d;font-size:25rpx;font-weight:700}.subscribe-description{display:block;margin-top:6rpx;color:#8994a5;font-size:20rpx;line-height:1.45}.subscribe-button{flex:none;margin:0;padding:0 22rpx;height:64rpx;line-height:64rpx;border:0;border-radius:13rpx;background:#ed6427;color:#fff;font-size:22rpx}.subscribe-button::after{border:0}.subscribe-note{flex-basis:100%;color:#a0a9b6;font-size:19rpx}
.store-panel{margin-bottom:16rpx;padding:18rpx 20rpx;border:1rpx solid #edf0f5;border-radius:20rpx;background:#fff}.store-label{display:block;margin-bottom:10rpx;color:#8794a5;font-size:21rpx}.single-store{color:#25334a;font-size:25rpx;font-weight:700}.store-scroll{width:100%;white-space:nowrap}.store-options{display:inline-flex;gap:10rpx}.store-option{padding:10rpx 16rpx;border-radius:12rpx;background:#f2f5f9;color:#627086;font-size:22rpx}.store-option.selected{background:#fff0e7;color:#d45a1d;font-weight:700}
</style>

