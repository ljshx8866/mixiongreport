<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type StoreAccess = { id: number; storeName: string; permissionCodes: string[] }
type Employee = {
  id: number
  displayName: string
  status: 'DRAFT' | 'ACTIVE' | 'TERMINATED'
  userId: number | null
  appointments: { storeId: number; effectiveFrom: string; effectiveToExclusive: string | null }[]
}

const storeId = ref(0)
const storeName = ref('')
const status = ref<'ACTIVE' | 'DRAFT' | 'TERMINATED' | 'ALL'>('ACTIVE')
const keyword = ref('')
const employees = ref<Employee[]>([])
const loading = ref(false)
const message = ref('')
const canRead = ref(false)
const canReadDetail = ref(false)
const statusOptions = [
  { value: 'ACTIVE' as const, label: '在职' },
  { value: 'DRAFT' as const, label: '入职资料' },
  { value: 'TERMINATED' as const, label: '已离职' },
  { value: 'ALL' as const, label: '全部' },
]

onLoad((options) => { storeId.value = Number(options?.storeId || 0) })
onShow(() => { if (storeId.value) void load() })

async function load() {
  if (!storeId.value) { message.value = '未指定门店，请从人事工作台进入员工列表。'; return }
  loading.value = true
  message.value = ''
  try {
    const access = await request<{ stores: StoreAccess[] }>('/api/hr/current-access')
    const store = (access.stores ?? []).find((item) => item.id === storeId.value)
    storeName.value = store?.storeName ?? ''
    canRead.value = Boolean(store?.permissionCodes.includes('HR_EMPLOYEE_LIST_READ'))
    canReadDetail.value = Boolean(store?.permissionCodes.includes('HR_EMPLOYEE_DETAIL_READ'))
    if (!canRead.value) {
      employees.value = []
      message.value = '当前账号没有此门店的员工查看权限，请联系总部检查功能角色和管理门店。'
      return
    }
    // URLSearchParams is missing in some WeChat mini-program runtime versions.
    const query = `storeId=${encodeURIComponent(String(storeId.value))}` +
      `&status=${encodeURIComponent(status.value)}` +
      `&q=${encodeURIComponent(keyword.value.trim())}`
    employees.value = await request<Employee[]>(`/api/hr/employees?${query}`)
  } catch (error) {
    message.value = errorMessage(error)
    employees.value = []
  } finally { loading.value = false }
}

function selectStatus(value: 'ACTIVE' | 'DRAFT' | 'TERMINATED' | 'ALL') {
  status.value = value
  void load()
}

function statusName(value: Employee['status']) {
  return value === 'ACTIVE' ? '在职' : value === 'TERMINATED' ? '已离职' : '入职资料'
}

function appointmentText(employee: Employee) {
  const appointment = employee.appointments[0]
  if (!appointment) return '尚无生效任职记录'
  return `${appointment.effectiveFrom} 起${appointment.effectiveToExclusive ? `，至 ${appointment.effectiveToExclusive}` : ''}`
}
function openEmployee(employee: Employee) {
  uni.navigateTo({ url: `/pages/hr/employee-detail?id=${employee.id}` })
}
</script>

<template>
  <view class="page employee-page">
    <PageLoading v-if="loading" />
    <view class="page-heading">
      <view class="store-context-heading"><view class="store-context-title"><text class="eyebrow">人员管理</text>
      <text class="title">员工列表</text></view>
      <StoreSelector v-model="storeId" source="hr" permission="HR_EMPLOYEE_LIST_READ" @ready="load" @change="load" /></view>
      <text class="subtitle">{{ storeName || '授权门店' }} · 查看员工任职状态</text>
    </view>

    <view v-if="message" class="card notice">{{ message }}</view>

    <template v-if="canRead">
      <view class="card search-card">
        <input v-model="keyword" class="search-input" confirm-type="search" placeholder="搜索员工姓名" @confirm="load" />
        <button class="search-button" :disabled="loading" @click="load">搜索</button>
      </view>
      <scroll-view scroll-x class="status-scroll">
        <view class="status-options">
          <view v-for="option in statusOptions" :key="option.value" class="status-option"
            :class="{ selected: status === option.value }" @click="selectStatus(option.value)">{{ option.label }}</view>
        </view>
      </scroll-view>

      <view class="result-heading"><text>员工名册</text><text class="result-count">{{ employees.length }} 人</text></view>
      <view v-if="!employees.length && !loading" class="card empty-state">
        <text class="empty-title">暂无员工记录</text>
        <text class="empty-copy">可以调整状态筛选或搜索条件。</text>
      </view>
      <view v-for="employee in employees" :key="employee.id" class="card employee-card" :class="{ clickable: canReadDetail }" @click="canReadDetail && openEmployee(employee)">
        <view class="employee-top">
          <view class="avatar">{{ employee.displayName.slice(0, 1) }}</view>
          <view class="employee-main">
            <text class="employee-name">{{ employee.displayName }}</text>
            <text class="employee-id">员工编号 {{ employee.id }}</text>
          </view>
          <text class="status-tag" :class="employee.status.toLowerCase()">{{ statusName(employee.status) }}</text>
        </view>
        <view class="employee-meta">
          <text>任职时间</text><text>{{ appointmentText(employee) }}</text>
        </view>
        <view class="employee-meta">
          <text>小程序账号</text><text>{{ employee.userId == null ? '未关联' : '已关联' }}</text>
        </view>
        <view v-if="canReadDetail" class="detail-hint">点击查看详细资料 <text>›</text></view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.employee-page{padding-top:26rpx;padding-bottom:60rpx}.page-heading{padding:0 6rpx 20rpx}.eyebrow{display:block;color:#d47543;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.title{display:block;margin-top:8rpx;color:#172033;font-size:40rpx;font-weight:750}.subtitle{display:block;margin-top:7rpx;color:#8490a5;font-size:23rpx}.notice{margin:12rpx 0;padding:22rpx;color:#9a5a30;font-size:23rpx;line-height:1.55}.search-card{display:flex;align-items:center;gap:12rpx;padding:12rpx 14rpx}.search-input{flex:1;min-width:0;height:68rpx;padding:0 16rpx;border-radius:14rpx;background:#f5f7fa;color:#26344b;font-size:24rpx}.search-button{flex:none;margin:0;padding:0 24rpx;height:68rpx;line-height:68rpx;border:0;border-radius:14rpx;background:#ed6427;color:#fff;font-size:23rpx}.status-scroll{margin-top:18rpx;white-space:nowrap}.status-options{display:inline-flex;gap:12rpx}.status-option{padding:13rpx 22rpx;border-radius:999rpx;background:#fff;color:#68758a;font-size:22rpx}.status-option.selected{background:#fff0e7;color:#d45a1d;font-weight:700}.result-heading{display:flex;justify-content:space-between;align-items:center;margin:28rpx 4rpx 14rpx;color:#1d2b40;font-size:28rpx;font-weight:700}.result-count{color:#d45a1d;font-size:23rpx}.employee-card{margin-bottom:14rpx;padding:22rpx}.employee-top{display:flex;align-items:center;gap:14rpx}.avatar{display:flex;align-items:center;justify-content:center;width:68rpx;height:68rpx;border-radius:22rpx;background:#fff0e7;color:#d45a1d;font-size:30rpx;font-weight:700}.employee-main{flex:1;min-width:0}.employee-name{display:block;color:#1d2b40;font-size:28rpx;font-weight:700}.employee-id{display:block;margin-top:4rpx;color:#8a95a6;font-size:20rpx}.status-tag{padding:8rpx 14rpx;border-radius:999rpx;background:#eef2f6;color:#66758b;font-size:20rpx;white-space:nowrap}.status-tag.active{background:#e8f7ef;color:#208150}.status-tag.draft{background:#fff3e8;color:#b56427}.status-tag.terminated{background:#f1f2f5;color:#778397}.employee-meta{display:flex;justify-content:space-between;gap:18rpx;margin-top:16rpx;padding-top:14rpx;border-top:1rpx solid #f0f2f5;color:#8591a3;font-size:21rpx}.employee-meta text:last-child{color:#40506a;text-align:right}.detail-hint{display:flex;justify-content:flex-end;gap:8rpx;margin-top:16rpx;color:#d45a1d;font-size:21rpx}.detail-hint text{font-size:28rpx;line-height:20rpx}.empty-state{display:flex;flex-direction:column;align-items:center;padding:46rpx 20rpx}.empty-title{color:#34445d;font-size:27rpx;font-weight:700}.empty-copy{margin-top:8rpx;color:#8a95a6;font-size:22rpx}
</style>
