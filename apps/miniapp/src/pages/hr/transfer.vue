<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'
import { hrStatusLabel } from '../../utils/hr-labels'

type Employee = { id: number; displayName: string }
type Store = { id: number; storeName: string }
type Transfer = { id: number; employeeName: string; fromStoreId: number; toStoreId: number;
  requestedEffectiveDate: string; status: string; nextStep: string | null }
const storeId = ref(0)
const permissions = ref<string[]>([])
const employees = ref<Employee[]>([])
const destinations = ref<Store[]>([])
const transfers = ref<Transfer[]>([])
const employeeId = ref(0)
const toStoreId = ref(0)
const effectiveDate = ref('')
const reason = ref('')
const decisionReason = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
onLoad((options) => { storeId.value = Number(options?.storeId || 0)
  effectiveDate.value = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) })
onShow(() => { if (storeId.value) load() })
async function load() {
  loading.value = true; message.value = ''
  try {
    const access = await request<{ stores: Array<Store & { permissionCodes: string[] }> }>('/api/hr/current-access')
    permissions.value = access.stores.find((store) => store.id === storeId.value)?.permissionCodes ?? []
    transfers.value = await request<Transfer[]>(`/api/hr/transfers?storeId=${storeId.value}`)
    if (permissions.value.includes('HR_TRANSFER_REQUEST')) {
      const [people, stores] = await Promise.all([
        request<Employee[]>(`/api/hr/employees/candidates?storeId=${storeId.value}`),
        request<Store[]>(`/api/hr/transfers/destinations?fromStoreId=${storeId.value}`),
      ])
      employees.value = people
      destinations.value = stores
    }
  } catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}
async function submit() {
  saving.value = true; message.value = ''
  try {
    await request('/api/hr/transfers', 'POST', { employeeId: employeeId.value,
      fromStoreId: storeId.value, toStoreId: toStoreId.value,
      requestedEffectiveDate: effectiveDate.value, reason: reason.value.trim() })
    employeeId.value = 0; toStoreId.value = 0; reason.value = ''
    await load(); message.value = '转店申请已提交，等待调入店店长和人事总监依次审批'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
function canDecide(item: Transfer) {
  if (item.status !== 'PENDING') return false
  if (item.nextStep === 'SOURCE_STORE') return item.fromStoreId === storeId.value &&
    permissions.value.includes('HR_TRANSFER_APPROVE_SOURCE')
  if (item.nextStep === 'DESTINATION_STORE') return item.toStoreId === storeId.value &&
    permissions.value.includes('HR_TRANSFER_APPROVE_DESTINATION')
  return item.nextStep === 'HR' && item.toStoreId === storeId.value &&
    permissions.value.includes('HR_TRANSFER_APPROVE_HR')
}
function stepName(value: string | null) {
  if (!value) return ''
  const labels: Record<string, string> = { SOURCE_STORE: '调出店店长审批', DESTINATION_STORE: '调入店店长审批', HR: '人事总监审批' }
  return labels[value] ?? '流程处理中'
}
async function decide(item: Transfer, decision: 'APPROVE' | 'REJECT') {
  if (decision === 'REJECT' && !decisionReason.value.trim()) { message.value = '请填写拒绝原因'; return }
  saving.value = true; message.value = ''
  try {
    await request(`/api/hr/transfers/${item.id}/decisions`, 'POST',
      { decision, reason: decisionReason.value.trim() })
    decisionReason.value = ''; await load(); message.value = '审批决定已记录'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
</script>

<template>
  <view class="page detail-page"><PageLoading v-if="loading" /><view class="store-context-heading"><view class="heading">员工转店</view>
    <StoreSelector v-model="storeId" source="hr" :permission="['HR_TRANSFER_REQUEST','HR_TRANSFER_APPROVE_SOURCE','HR_TRANSFER_APPROVE_DESTINATION','HR_TRANSFER_APPROVE_HR']" @ready="load" @change="load" /></view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view v-if="permissions.includes('HR_TRANSFER_REQUEST')" class="card"><text class="section-title">发起申请</text>
      <picker :range="employees" range-key="displayName" @change="(event) => employeeId = employees[Number(event.detail.value)]?.id || 0">
        <view class="field">员工：{{ employees.find(item => item.id === employeeId)?.displayName || '请选择' }}</view></picker>
      <picker :range="destinations" range-key="storeName" @change="(event) => toStoreId = destinations[Number(event.detail.value)]?.id || 0">
        <view class="field">转入门店：{{ destinations.find(item => item.id === toStoreId)?.storeName || '请选择' }}</view></picker>
      <picker mode="date" :value="effectiveDate" @change="(event) => effectiveDate = String(event.detail.value)">
        <view class="field">生效日期：{{ effectiveDate }}</view></picker>
      <view class="field"><text>转店原因</text><input v-model="reason" /></view>
      <button class="button" :disabled="saving || !employeeId || !toStoreId || !reason.trim()" @click="submit">提交转店申请</button></view>
    <view class="section-title list-title">申请与审批</view>
    <view v-for="item in transfers" :key="item.id" class="card transfer">
      <text class="name">{{ item.employeeName }}</text><text class="subheading">{{ item.fromStoreId }} → {{ item.toStoreId }} · {{ item.requestedEffectiveDate }}</text>
      <text class="subheading">{{ hrStatusLabel(item.status) }}{{ item.nextStep ? ` · ${stepName(item.nextStep)}` : '' }}</text>
      <view v-if="canDecide(item)"><input v-model="decisionReason" class="field" placeholder="拒绝时填写原因" />
        <view class="actions"><button :disabled="saving" @click="decide(item, 'APPROVE')">通过</button>
          <button :disabled="saving" @click="decide(item, 'REJECT')">拒绝</button></view></view></view>
  </view>
</template>

<style scoped>
.heading{font-size:38rpx;font-weight:700;color:#172033}.notice{color:#b45309}.field{margin:16rpx 0;padding:16rpx;border:1rpx solid #e2e8f0;border-radius:12rpx}
.list-title{margin:28rpx 0 14rpx}.transfer{margin-bottom:16rpx}.name{display:block;font-size:28rpx;font-weight:700}
.subheading{display:block;margin-top:8rpx;color:#8490a5;font-size:23rpx}.actions{display:flex;gap:12rpx}
.actions button{flex:1;border:0;border-radius:12rpx;background:#fff0e7;color:#df591b}
</style>
