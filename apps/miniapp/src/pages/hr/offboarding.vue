<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'
import { hrFailureLabel, hrStatusLabel } from '../../utils/hr-labels'

type Employee = { id: number; displayName: string; status: string }
type Application = { id: number; employeeName: string; effectiveDate: string; reason: string;
  status: string; failureCode: string | null; rejectionReason?: string | null; deleteAccountOnEffective: boolean }
type Store = { id: number; permissionCodes: string[] }

const storeId = ref(0)
const permissions = ref<string[]>([])
const employees = ref<Employee[]>([])
const applications = ref<Application[]>([])
const employeeId = ref(0)
const effectiveDate = ref('')
const reason = ref('')
const deleteAccountOnEffective = ref(true)
const rejectionReason = ref('')
const editingId = ref(0)
const editEffectiveDate = ref('')
const editReason = ref('')
const editDeleteAccount = ref(true)
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const canRequest = computed(() => permissions.value.includes('HR_OFFBOARDING_REQUEST'))
const canApprove = computed(() => permissions.value.includes('HR_OFFBOARDING_APPROVE'))

onLoad((options) => {
  storeId.value = Number(options?.storeId || 0)
  const today = new Date()
  effectiveDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
})
onShow(() => { if (storeId.value) void load() })

async function load() {
  loading.value = true
  message.value = ''
  try {
    const access = await request<{ stores: Store[] }>('/api/hr/current-access')
    permissions.value = access.stores.find((store) => store.id === storeId.value)?.permissionCodes ?? []
    if (!canRequest.value && !canApprove.value) { message.value = '当前门店没有离职申请或审批权限'; return }
    const [people, rows] = await Promise.all([
      canRequest.value && permissions.value.includes('HR_EMPLOYEE_LIST_READ')
        ? request<Employee[]>(`/api/hr/employees?storeId=${storeId.value}`) : Promise.resolve([]),
      request<Application[]>(`/api/hr/offboarding?storeId=${storeId.value}`),
    ])
    employees.value = people.filter((person) => person.status === 'ACTIVE')
    applications.value = rows
  } catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}

async function submit() {
  if (!canRequest.value || !employeeId.value || !effectiveDate.value || !reason.value.trim()) return
  saving.value = true; message.value = ''
  try {
    await request('/api/hr/offboarding', 'POST', { employeeId: employeeId.value, storeId: storeId.value,
      effectiveDate: effectiveDate.value, reason: reason.value.trim(),
      deleteAccountOnEffective: deleteAccountOnEffective.value })
    employeeId.value = 0; reason.value = ''; deleteAccountOnEffective.value = true
    await load(); message.value = '离职申请已提交'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
function changeDeleteAccount(event: { detail: { value: string[] } }) {
  deleteAccountOnEffective.value = event.detail.value.length > 0
}

function editRejected(item: Application) {
  editingId.value = item.id; editEffectiveDate.value = item.effectiveDate
  editReason.value = item.reason; editDeleteAccount.value = item.deleteAccountOnEffective
}
function changeEditDeleteAccount(event: { detail: { value: string[] } }) {
  editDeleteAccount.value = event.detail.value.length > 0
}
async function resubmit(item: Application) {
  if (!editEffectiveDate.value || !editReason.value.trim()) { message.value = '请填写生效日期和离职原因'; return }
  saving.value = true; message.value = ''
  try {
    await request(`/api/hr/offboarding/${item.id}/resubmit`, 'POST', { effectiveDate: editEffectiveDate.value,
      reason: editReason.value.trim(), deleteAccountOnEffective: editDeleteAccount.value })
    editingId.value = 0; await load(); message.value = '原离职申请已更正并重新提交审批'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}

async function decide(item: Application, decision: 'APPROVE' | 'REJECT') {
  if (!canApprove.value || item.status !== 'SUBMITTED') return
  if (decision === 'REJECT' && !rejectionReason.value.trim()) { message.value = '请填写拒绝原因'; return }
  saving.value = true; message.value = ''
  try {
    await request(`/api/hr/offboarding/${item.id}/decisions`, 'POST',
      { decision, reason: rejectionReason.value.trim() })
    rejectionReason.value = ''
    await load(); message.value = '审批决定已记录'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
</script>

<template>
  <view class="page detail-page">
    <PageLoading v-if="loading" />
    <view class="store-context-heading"><view class="heading">员工离职</view>
      <StoreSelector v-model="storeId" source="hr" :permission="['HR_OFFBOARDING_REQUEST','HR_OFFBOARDING_APPROVE']" @ready="load" @change="load" /></view>
    <view class="subheading">申请和审批按当前门店人事权限办理，历史任职与工时继续保留。</view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view v-if="canRequest" class="card section">
      <text class="section-title">发起离职申请</text>
      <view v-if="!permissions.includes('HR_EMPLOYEE_LIST_READ')" class="hint">当前角色还需“查看员工列表”权限才能选择员工。</view>
      <picker :range="employees" range-key="displayName" @change="(event) => employeeId = employees[Number(event.detail.value)]?.id || 0">
        <view class="field">员工：{{ employees.find((person) => person.id === employeeId)?.displayName || '请选择' }}</view>
      </picker>
      <picker mode="date" :value="effectiveDate" @change="(event) => effectiveDate = String(event.detail.value)">
        <view class="field">离职生效日：{{ effectiveDate }}</view>
      </picker>
      <view class="field"><text>离职原因</text><input v-model="reason" maxlength="1000" placeholder="请填写原因" /></view>
      <label class="account-choice"><checkbox :checked="deleteAccountOnEffective" @change="changeDeleteAccount" />
        <text>离职生效时删除登录账号（默认勾选）</text></label>
      <button class="button" :disabled="saving || !employeeId || !effectiveDate || !reason.trim()" @click="submit">提交审批</button>
    </view>
    <view class="section-title list-title">申请记录</view>
    <view v-if="!applications.length && !loading" class="card hint">暂无离职申请</view>
    <view v-for="item in applications" :key="item.id" class="card record">
      <text class="name">{{ item.employeeName }}</text>
      <text class="detail">生效日 {{ item.effectiveDate }} · {{ hrStatusLabel(item.status) }}</text>
      <text class="detail">离职生效时{{ item.deleteAccountOnEffective ? '删除' : '保留' }}登录账号</text>
      <text class="detail">原因：{{ item.reason }}</text>
      <text v-if="item.rejectionReason" class="rejection">驳回原因：{{ item.rejectionReason }}</text>
      <text v-if="item.failureCode" class="detail">处理提示：{{ hrFailureLabel(item.failureCode) }}</text>
      <view v-if="canRequest && item.status === 'REJECTED' && editingId !== item.id" class="actions">
        <button :disabled="saving" @click="editRejected(item)">修改并重新提交</button></view>
      <view v-if="canRequest && item.status === 'REJECTED' && editingId === item.id" class="resubmit-form">
        <picker mode="date" :value="editEffectiveDate" @change="(event) => editEffectiveDate = String(event.detail.value)">
          <view class="field">离职生效日：{{ editEffectiveDate }}</view></picker>
        <view class="field"><text>离职原因</text><input v-model="editReason" maxlength="1000" /></view>
        <label class="account-choice"><checkbox :checked="editDeleteAccount" @change="changeEditDeleteAccount" />
          <text>生效时删除登录账号</text></label>
        <view class="actions"><button :disabled="saving" @click="editingId = 0">取消</button>
          <button :disabled="saving || !editReason.trim() || !editEffectiveDate" @click="resubmit(item)">保存并重新提交</button></view>
      </view>
      <template v-if="canApprove && item.status === 'SUBMITTED'">
        <input v-model="rejectionReason" class="field" maxlength="1000" placeholder="拒绝时填写原因" />
        <view class="actions"><button :disabled="saving" @click="decide(item, 'APPROVE')">通过</button>
          <button :disabled="saving" @click="decide(item, 'REJECT')">拒绝</button></view>
      </template>
    </view>
  </view>
</template>

<style scoped>
.heading{font-size:38rpx;font-weight:700;color:#172033}.subheading{margin-top:10rpx;color:#7f8a9c;font-size:23rpx}
.notice{margin-top:20rpx;color:#b45309}.section{margin-top:24rpx}.section-title{display:block;font-size:29rpx;font-weight:700;color:#25334a}
.field{display:block;margin:16rpx 0;padding:18rpx;border:1rpx solid #e2e8f0;border-radius:14rpx;color:#334155}
.field input{margin-top:10rpx}.hint{color:#8794a5;font-size:23rpx;line-height:1.5}.list-title{margin:30rpx 0 14rpx}
.record{margin-bottom:16rpx}.name{display:block;font-size:28rpx;font-weight:700}.detail{display:block;margin-top:8rpx;color:#64748b;font-size:23rpx}
.actions{display:flex;gap:12rpx}.actions button{flex:1;border:0;border-radius:12rpx;background:#fff0e7;color:#df591b}
.account-choice{display:flex;align-items:center;gap:10rpx;margin:18rpx 0;padding:16rpx;border-radius:14rpx;background:#fff5ef;color:#46536a;font-size:22rpx}.account-choice checkbox{transform:scale(.8)}
.rejection{display:block;margin-top:8rpx;padding:12rpx;border-radius:10rpx;background:#fff2ef;color:#b54708;font-size:22rpx;line-height:1.5;overflow-wrap:anywhere}.resubmit-form{margin-top:14rpx;padding:12rpx;border-radius:14rpx;background:#f7f9fc}
</style>
