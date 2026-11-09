<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'
import { hrFailureLabel, hrStatusLabel } from '../../utils/hr-labels'

type Store = { id: number; storeName: string; permissionCodes: string[] }
type Employee = { id: number; displayName: string }
type Change = { id: number; employeeId: number; employeeName: string; effectiveDate: string;
  hourlyRate: string; status: string; failureCode: string | null; agreementReference: string | null }

const stores = ref<Store[]>([])
const storeId = ref(0)
const employees = ref<Employee[]>([])
const changes = ref<Change[]>([])
const employeeId = ref(0)
const effectiveDate = ref(today())
const hourlyRate = ref('')
const reason = ref('')
const agreementReference = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const selectedStore = computed(() => stores.value.find((item) => item.id === storeId.value))
const eligibleStores = computed(() => stores.value.filter((item) => item.permissionCodes.includes('HR_SALARY_CHANGE_REQUEST')))
const canRequest = computed(() => selectedStore.value?.permissionCodes.includes('HR_SALARY_CHANGE_REQUEST') ?? false)
const employeeNames = computed(() => employees.value.map((item) => item.displayName))
const selectedEmployeeName = computed(() => employees.value.find((item) => item.id === employeeId.value)?.displayName ?? '请选择员工')

function today() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

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
    if (!storeId.value) { message.value = '当前账号没有调薪申请权限'; return }
    const [people, rows] = await Promise.all([
      canRequest ? request<Employee[]>(`/api/hr/salary-changes/employees?storeId=${storeId.value}`) : Promise.resolve([]),
      request<Change[]>(`/api/hr/salary-changes?storeId=${storeId.value}`),
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
function selectDate(event: { detail: { value: string } }) { effectiveDate.value = String(event.detail.value) }

async function submit() {
  if (!canRequest.value || !employeeId.value || !effectiveDate.value || !hourlyRate.value.trim() || !reason.value.trim()) return
  saving.value = true
  message.value = ''
  try {
    await request('/api/hr/salary-changes', 'POST', { employeeId: employeeId.value, storeId: storeId.value,
      effectiveDate: effectiveDate.value, hourlyRate: hourlyRate.value.trim(), reason: reason.value.trim(),
      agreementReference: agreementReference.value.trim() })
    hourlyRate.value = ''; reason.value = ''; agreementReference.value = ''; employeeId.value = 0
    await load()
    message.value = '调薪申请已提交，审批通过后按生效日期更新时薪。'
    uni.showToast({ title: '提交成功', icon: 'success' })
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
</script>

<template>
  <view class="page application-page">
    <PageLoading v-if="loading" text="正在读取调薪申请" />
    <view class="page-heading">
      <text class="eyebrow">人事申请</text>
      <text class="title">调薪申请</text>
      <text class="subtitle">填写新时薪、生效日期和调整原因，提交后进入已配置的审批流程。</text>
    </view>
    <view v-if="eligibleStores.length > 1" class="card store-card">
      <text class="field-label">申请门店</text>
      <picker mode="selector" :range="eligibleStores.map((item) => item.storeName)" @change="selectStore">
        <view class="picker-value">{{ selectedStore?.storeName || '请选择门店' }}<text>切换</text></view>
      </picker>
    </view>
    <view v-if="message" class="notice">{{ message }}</view>
    <view v-if="canRequest" class="card form-card">
      <text class="card-title">填写申请</text>
      <view class="field">
        <text class="field-label">员工</text>
        <picker mode="selector" :range="employeeNames" @change="selectEmployee">
          <view class="picker-value">{{ selectedEmployeeName }}<text>选择</text></view>
        </picker>
      </view>
      <view class="field"><text class="field-label">生效日期</text>
        <picker mode="date" :value="effectiveDate" @change="selectDate">
          <view class="picker-value">{{ effectiveDate }}<text>选择日期</text></view>
        </picker>
      </view>
      <label class="field"><text class="field-label">调整后时薪（元/小时）</text>
        <input v-model="hourlyRate" type="digit" inputmode="decimal" placeholder="例如 18.50" /></label>
      <label class="field"><text class="field-label">调整原因</text>
        <textarea v-model="reason" maxlength="1000" placeholder="请填写调整原因" /></label>
      <label class="field"><text class="field-label">书面协议编号</text>
        <input v-model="agreementReference" maxlength="200" placeholder="降薪时必填" /></label>
      <text class="form-hint">新时薪低于当前标准时，必须填写书面协议编号。</text>
      <button class="primary" :disabled="saving || !employeeId || !effectiveDate || !hourlyRate.trim() || !reason.trim()" @click="submit">
        {{ saving ? '正在提交…' : '提交调薪申请' }}
      </button>
    </view>
    <view class="section-title">申请记录</view>
    <view v-if="!changes.length && !loading" class="card empty">暂无调薪申请记录</view>
    <view v-for="item in changes" :key="item.id" class="card record">
      <view class="record-head"><text class="record-name">{{ item.employeeName }}</text><text class="status">{{ hrStatusLabel(item.status) }}</text></view>
      <view class="record-row"><text>生效日期</text><text>{{ item.effectiveDate }}</text></view>
      <view class="record-row"><text>新时薪</text><text>¥{{ item.hourlyRate }}/小时</text></view>
      <view v-if="item.agreementReference" class="record-row"><text>协议编号</text><text>{{ item.agreementReference }}</text></view>
      <view v-if="item.failureCode" class="record-row"><text>处理说明</text><text>{{ hrFailureLabel(item.failureCode) }}</text></view>
    </view>
  </view>
</template>

<style scoped>
.application-page{padding:28rpx 26rpx 70rpx}.page-heading{margin-bottom:22rpx}.eyebrow{display:block;color:#d46a36;font-size:21rpx;font-weight:700}.title{display:block;margin-top:8rpx;color:#1b2b45;font-size:40rpx;font-weight:750}.subtitle{display:block;margin-top:10rpx;color:#8490a3;font-size:23rpx;line-height:1.5}.card{margin-top:18rpx;padding:26rpx;border:1rpx solid #edf0f5;border-radius:22rpx;background:#fff;box-shadow:0 8rpx 24rpx rgba(27,43,70,.04)}.store-card{margin-top:0}.field{display:block;margin-top:22rpx}.field-label{display:block;margin-bottom:10rpx;color:#536176;font-size:22rpx}.picker-value,.field input,.field textarea{box-sizing:border-box;width:100%;min-height:82rpx;padding:22rpx;border:1rpx solid #e5eaf1;border-radius:14rpx;background:#fbfcfe;color:#26364d;font-size:24rpx}.picker-value{display:flex;align-items:center;justify-content:space-between}.picker-value text{color:#d76832;font-size:21rpx}.field textarea{min-height:140rpx}.card-title,.section-title{display:block;color:#1d2b40;font-size:29rpx;font-weight:700}.section-title{margin:30rpx 4rpx 14rpx}.form-hint{display:block;margin-top:14rpx;color:#8994a5;font-size:20rpx;line-height:1.5}.primary{margin-top:24rpx;border:0;border-radius:15rpx;background:#ed6427;color:#fff;font-size:25rpx}.primary[disabled]{opacity:.48}.notice,.empty{margin-top:18rpx;padding:22rpx;border-radius:16rpx;background:#fff8f2;color:#9a5c39;font-size:22rpx}.empty{text-align:center;background:#fff;color:#8b96a7}.record-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10rpx}.record-name{color:#1d2b40;font-size:26rpx;font-weight:700}.status{padding:7rpx 12rpx;border-radius:20rpx;background:#fff1e8;color:#c95720;font-size:20rpx}.record-row{display:flex;justify-content:space-between;gap:20rpx;padding:12rpx 0;border-top:1rpx solid #f0f2f6;color:#7d899b;font-size:22rpx}.record-row text:last-child{color:#33435b;text-align:right;overflow-wrap:anywhere}
</style>
