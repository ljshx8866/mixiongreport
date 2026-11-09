<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'
import { hrFailureLabel, hrStatusLabel } from '../../utils/hr-labels'

type Store = { id: number; storeName: string; permissionCodes: string[] }
type Employee = { id: number; displayName: string }
type Change = { id: number; employeeId: number; employeeName: string; status: string; revision: number;
  accountName: string; bankName: string; branchName: string; cardNumber: string; createdAt: string;
  appliedAt: string | null; failureCode: string | null }

const stores = ref<Store[]>([])
const storeId = ref(0)
const employees = ref<Employee[]>([])
const changes = ref<Change[]>([])
const employeeId = ref(0)
const cardNumber = ref('')
const bankName = ref('')
const branchName = ref('')
const confirmedOriginals = ref(false)
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const eligibleStores = computed(() => stores.value.filter((item) => ['HR_BANK_CHANGE_SUBMIT', 'HR_BANK_CHANGE_VERIFY'].every((permission) => item.permissionCodes.includes(permission)) ||
  item.permissionCodes.includes('HR_BANK_CHANGE_LIST_READ') || item.permissionCodes.includes('HR_BANK_CHANGE_APPROVE')))
const selectedStore = computed(() => stores.value.find((item) => item.id === storeId.value))
const canRequest = computed(() => Boolean(selectedStore.value?.permissionCodes.includes('HR_BANK_CHANGE_SUBMIT') &&
  selectedStore.value.permissionCodes.includes('HR_BANK_CHANGE_VERIFY')))
const selectedEmployee = computed(() => employees.value.find((item) => item.id === employeeId.value))
const employeeNames = computed(() => employees.value.map((item) => item.displayName))

onLoad((options) => { storeId.value = Number(options?.storeId || 0) })
onShow(() => { void load() })

async function load() {
  loading.value = true
  message.value = ''
  try {
    const access = await request<{ stores: Store[] }>('/api/hr/current-access')
    stores.value = access.stores ?? []
    if (!eligibleStores.value.some((item) => item.id === storeId.value))
      storeId.value = eligibleStores.value[0]?.id ?? 0
    employees.value = []
    changes.value = []
    if (!storeId.value) { message.value = '当前账号没有银行卡变更申请、记录查看或审批权限'; return }
    const [people, rows] = await Promise.all([
      canRequest.value ? request<Employee[]>(`/api/hr/bank-changes/employees?storeId=${storeId.value}`) : Promise.resolve([]),
      request<Change[]>(`/api/hr/bank-changes?storeId=${storeId.value}`),
    ])
    employees.value = people
    changes.value = rows
    if (employeeId.value && !people.some((item) => item.id === employeeId.value)) employeeId.value = 0
  } catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}

function selectStore(event: { detail: { value: string } }) {
  storeId.value = eligibleStores.value[Number(event.detail.value)]?.id ?? 0
  employeeId.value = 0
  void load()
}
function selectEmployee(event: { detail: { value: string } }) {
  employeeId.value = employees.value[Number(event.detail.value)]?.id ?? 0
}
function confirmOriginals(event: { detail: { value: string[] } }) {
  confirmedOriginals.value = event.detail.value.includes('verified')
}
function statusText(status: string) {
  const extra: Record<string, string> = { EFFECTIVE: '已生效', EFFECTIVE_FAILED: '生效异常' }
  return extra[status] ?? hrStatusLabel(status)
}
function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function submit() {
  if (!canRequest.value || !employeeId.value || !cardNumber.value.trim() || !bankName.value.trim() || !confirmedOriginals.value) return
  saving.value = true
  message.value = ''
  try {
    await request(`/api/hr/bank-changes/employees/${employeeId.value}/submit`, 'POST', {
      accountName: selectedEmployee.value?.displayName,
      cardNumber: cardNumber.value.replace(/\s/g, ''), bankName: bankName.value.trim(),
      branchName: branchName.value.trim(), confirmedOriginals: true,
    })
    employeeId.value = 0; cardNumber.value = ''; bankName.value = ''; branchName.value = ''; confirmedOriginals.value = false
    await load()
    message.value = '银行卡变更申请已加密保存并提交审批，审批通过后新账户生效。'
    uni.showToast({ title: '提交成功', icon: 'success' })
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false; cardNumber.value = '' }
}
</script>

<template>
  <view class="page application-page">
    <PageLoading v-if="loading" text="正在读取银行卡变更记录" />
    <view class="page-heading">
      <text class="eyebrow">人事申请</text>
      <text class="title">银行卡变更申请</text>
      <text class="subtitle">请在门店现场核验员工本人和银行卡原件。卡号加密保存，审批通过后新账户生效。</text>
    </view>
    <view v-if="eligibleStores.length > 1" class="card store-card">
      <text class="field-label">申请门店</text>
      <picker mode="selector" :range="eligibleStores.map((item) => item.storeName)" @change="selectStore">
        <view class="picker-value">{{ selectedStore?.storeName || '请选择门店' }}<text>切换</text></view>
      </picker>
    </view>
    <view v-if="message" class="notice">{{ message }}</view>
    <view v-if="canRequest" class="card form-card">
      <text class="card-title">填写变更资料</text>
      <view class="field"><text class="field-label">员工</text>
        <picker mode="selector" :range="employeeNames" @change="selectEmployee">
          <view class="picker-value">{{ selectedEmployee?.displayName || '请选择员工' }}<text>选择</text></view>
        </picker>
      </view>
      <view class="field"><text class="field-label">开户人</text>
        <view class="read-only">{{ selectedEmployee?.displayName || '选择员工后自动带入' }}</view></view>
      <label class="field"><text class="field-label">银行卡号</text>
        <input v-model="cardNumber" type="text" inputmode="numeric" autocomplete="off" placeholder="请输入完整银行卡号" /></label>
      <label class="field"><text class="field-label">开户银行</text>
        <input v-model="bankName" maxlength="100" placeholder="例如：中国工商银行" /></label>
      <label class="field"><text class="field-label">支行（选填）</text>
        <input v-model="branchName" maxlength="200" placeholder="请输入开户支行" /></label>
      <checkbox-group class="verify-box" @change="confirmOriginals">
        <label><checkbox value="verified" color="#ed6427" />
          <text>我已在门店现场核验员工本人及银行卡原件</text></label>
      </checkbox-group>
      <button class="primary" :disabled="saving || !employeeId || !cardNumber.trim() || !bankName.trim() || !confirmedOriginals" @click="submit">
        {{ saving ? '正在提交…' : '提交银行卡变更申请' }}
      </button>
    </view>
    <view class="section-title">申请记录</view>
    <view v-if="!changes.length && !loading" class="card empty">暂无银行卡变更记录</view>
    <view v-for="item in changes" :key="item.id" class="card record">
      <view class="record-head"><text class="record-name">{{ item.employeeName }}</text><text class="status">{{ statusText(item.status) }}</text></view>
      <view class="record-row"><text>开户人</text><text>{{ item.accountName }}</text></view>
      <view class="record-row"><text>开户银行</text><text>{{ item.bankName }}{{ item.branchName ? ` · ${item.branchName}` : '' }}</text></view>
      <view class="record-row"><text>银行卡号</text><text>{{ item.cardNumber }}</text></view>
      <view class="record-row"><text>申请时间</text><text>{{ formatTime(item.createdAt) }}</text></view>
      <view v-if="item.failureCode" class="record-row"><text>处理说明</text><text>{{ hrFailureLabel(item.failureCode) }}</text></view>
    </view>
  </view>
</template>

<style scoped>
.application-page{padding:28rpx 26rpx 70rpx}.page-heading{margin-bottom:22rpx}.eyebrow{display:block;color:#d46a36;font-size:21rpx;font-weight:700}.title{display:block;margin-top:8rpx;color:#1b2b45;font-size:40rpx;font-weight:750}.subtitle{display:block;margin-top:10rpx;color:#8490a3;font-size:23rpx;line-height:1.5}.card{margin-top:18rpx;padding:26rpx;border:1rpx solid #edf0f5;border-radius:22rpx;background:#fff;box-shadow:0 8rpx 24rpx rgba(27,43,70,.04)}.store-card{margin-top:0}.field{display:block;margin-top:22rpx}.field-label{display:block;margin-bottom:10rpx;color:#536176;font-size:22rpx}.picker-value,.read-only,.field input{box-sizing:border-box;width:100%;min-height:82rpx;padding:22rpx;border:1rpx solid #e5eaf1;border-radius:14rpx;background:#fbfcfe;color:#26364d;font-size:24rpx}.picker-value{display:flex;align-items:center;justify-content:space-between}.picker-value text{color:#d76832;font-size:21rpx}.verify-box{margin-top:22rpx;padding:18rpx;border:1rpx solid #f1d3bd;border-radius:14rpx;background:#fff8f2}.verify-box label{display:flex;align-items:center;gap:10rpx;color:#8d4c28;font-size:23rpx}.verify-box checkbox{transform:scale(.9)}.card-title,.section-title{display:block;color:#1d2b40;font-size:29rpx;font-weight:700}.section-title{margin:30rpx 4rpx 14rpx}.primary{margin-top:24rpx;border:0;border-radius:15rpx;background:#ed6427;color:#fff;font-size:25rpx}.primary[disabled]{opacity:.48}.notice,.empty{margin-top:18rpx;padding:22rpx;border-radius:16rpx;background:#fff8f2;color:#9a5c39;font-size:22rpx}.empty{text-align:center;background:#fff;color:#8b96a7}.record-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10rpx}.record-name{color:#1d2b40;font-size:26rpx;font-weight:700}.status{padding:7rpx 12rpx;border-radius:20rpx;background:#fff1e8;color:#c95720;font-size:20rpx}.record-row{display:flex;justify-content:space-between;gap:20rpx;padding:12rpx 0;border-top:1rpx solid #f0f2f6;color:#7d899b;font-size:22rpx}.record-row text:last-child{max-width:70%;color:#33435b;text-align:right;overflow-wrap:anywhere}
</style>
