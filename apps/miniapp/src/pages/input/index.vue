<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { request } from '../../utils/api'
import StoreSelector from '../../components/StoreSelector.vue'
import { businessDate, currentStoreId, errorMessage } from '../../utils/session'

const date = businessDate()
const targetStoreId = ref<number | null>(null)
const employeeInput = ref(false)
onLoad((options: Record<string, string>) => {
  const id = Number(options?.storeId)
  if (Number.isSafeInteger(id) && id > 0) targetStoreId.value = id
  employeeInput.value = options?.employee === '1'
})

const fields = [
  { key: 'totalPower', label: '用电度数', unit: '度', required: true },
  { key: 'kitchenPower', label: '厨房用电', unit: '度', required: true },
  { key: 'diningPower', label: '前厅用电', unit: '度', required: true },
  { key: 'waterUsage', label: '用水吨数', unit: '吨', required: true },
] as const
type Field = typeof fields[number]['key']
const form = reactive<Record<Field | 'remark', string>>({
  totalPower: '', kitchenPower: '', diningPower: '', waterUsage: '', remark: '',
})
type LaborSummary = {
  scheduledShiftCount: number; confirmedShiftCount: number; pendingShiftCount: number;
  statisticalMinutes: number; laborHours: number
}
const laborSummary = ref<LaborSummary>({ scheduledShiftCount: 0, confirmedShiftCount: 0,
  pendingShiftCount: 0, statisticalMinutes: 0, laborHours: 0 })
const laborHoursText = computed(() => Number(laborSummary.value.laborHours || 0).toFixed(2))
const status = ref('DRAFT')
const loadingPage = ref(false)
const message = ref('')
const syncPending = ref(false)
const saving = ref(false)
type ReminderTask = { id: number; storeId: number; date: string; status: string }
type StoreUser = { id: number; name: string }
const reminderTask = ref<ReminderTask | null>(null)
const reminderUsers = ref<StoreUser[]>([])
const reminderTarget = ref('')
const reminderMessage = ref('')

const statusLabel = () => status.value === 'DRAFT' ? '草稿' : status.value === 'SUBMITTED' ? '已提交' : '已锁定'
const update = (key: Field | 'remark', event: any) => { form[key] = event.detail.value }

async function loadInput() {
  loadingPage.value = true
  const storeId = targetStoreId.value || currentStoreId()
  if (!storeId) { message.value = '请先登录并选择门店'; loadingPage.value = false; return }
  try {
    const [input, summary, tasks] = await Promise.all([
      request<Record<string, any> | null>(`/api/daily-inputs?storeId=${storeId}&date=${date}`),
      request<LaborSummary>(`/api/daily-inputs/labor-hours?storeId=${storeId}&date=${date}`),
      employeeInput.value ? Promise.resolve([] as ReminderTask[]) : request<ReminderTask[]>('/api/reminders/mine'),
    ])
    laborSummary.value = summary
    for (const field of fields) form[field.key] = input?.[field.key] == null ? '' : String(input[field.key])
    form.remark = input?.remark ?? ''
    status.value = input?.status ?? 'DRAFT'
    reminderTask.value = tasks.find((task) => task.storeId === storeId && String(task.date).slice(0, 10) === date) ?? null
    reminderUsers.value = reminderTask.value ? await request<StoreUser[]>(`/api/reminders/${reminderTask.value.id}/users`) : []
    message.value = ''
  } catch (error) { message.value = errorMessage(error) }
  finally { loadingPage.value = false }
}
onShow(() => { void loadInput() })

function goToTimeConfirmation() {
  const storeId = targetStoreId.value || currentStoreId()
  if (!storeId) return
  uni.navigateTo({ url: `/pages/hr/time?storeId=${storeId}&date=${date}` })
}

async function remindNext() {
  if (!reminderTask.value) return
  try {
    await request(`/api/reminders/${reminderTask.value.id}/next`, 'POST')
    reminderMessage.value = '已提醒下一顺位人员'
    reminderTask.value = null
  } catch (error) { reminderMessage.value = errorMessage(error) }
}

async function delegateReminder() {
  if (!reminderTask.value || !reminderTarget.value) { reminderMessage.value = '请选择同门店人员'; return }
  try {
    await request(`/api/reminders/${reminderTask.value.id}/delegate`, 'POST', { userId: Number(reminderTarget.value) })
    reminderMessage.value = '已发送指定提醒'
    reminderTask.value = null
  } catch (error) { reminderMessage.value = errorMessage(error) }
}

async function save(submit: boolean) {
  const storeId = targetStoreId.value || currentStoreId()
  if (!storeId || saving.value) return
  if (submit && fields.some((field) => field.required && form[field.key] === '')) {
    message.value = '请填写所有必填项'
    return
  }
  const payload: Record<string, unknown> = { storeId, date, remark: form.remark }
  for (const field of fields) {
    const value = form[field.key].trim()
    const number = value === '' ? null : Number(value)
    if (number !== null && (!Number.isFinite(number) || number < 0)) {
      message.value = `${field.label}请输入有效的非负数`
      return
    }
    payload[field.key] = number
  }
  saving.value = true
  message.value = ''
  syncPending.value = false
  try {
    const result = await request<{ id: number }>('/api/daily-inputs', 'POST', payload)
    if (submit) {
      const submitted = await request<{ status: string; posSync?: { status: string } }>(`/api/daily-inputs/${result.id}/submit`, 'POST')
      status.value = submitted.status
      syncPending.value = submitted.posSync?.status === 'PENDING'
    }
    uni.showToast({ title: submit ? '已提交' : '草稿已保存' })
    if (syncPending.value) message.value = '填报已提交，经营数据正在同步；完成后日报会自动更新。'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
</script>

<template>
  <view class="page">
    <PageLoading v-if="loadingPage" />
    <view class="form-hero">
      <view class="store-context-heading"><view class="store-context-title"><text class="eyebrow">每日填报</text><text class="hero-title">每日经营填报</text><text class="hero-date">{{ date }}</text></view>
        <view class="form-hero-actions"><StoreSelector v-model="targetStoreId" source="hr" permission="HR_DAILY_INPUT_WRITE" @ready="loadInput" @change="loadInput" />
          <text class="status-pill" :class="{ ok: status === 'SUBMITTED' }">{{ statusLabel() }}</text></view></view>
    </view>
    <view v-if="reminderTask && !employeeInput" class="card reminder-card">
      <text class="section-title">收到填报提醒</text><text class="section-subtitle">可直接完成填报，或转派给同门店人员。</text>
      <view class="reminder-actions">
        <view class="button secondary" @click="remindNext">顺位提醒</view>
        <picker mode="selector" :range="reminderUsers" range-key="name" @change="reminderTarget = String(reminderUsers[Number($event.detail.value)].id)">
          <view class="picker">{{ reminderUsers.find((user) => String(user.id) === reminderTarget)?.name || '选择转派人员' }}</view>
        </picker>
        <view class="button" @click="delegateReminder">指定转派</view>
      </view>
      <text v-if="reminderMessage" class="reminder-message">{{ reminderMessage }}</text>
    </view>
    <view class="notice"><text class="notice-icon">i</text><text>带 * 的项目为提交日报必填数据</text></view>
    <view class="card">
      <text class="section-title">能源数据</text>
      <view class="input-grid">
        <view v-for="field in fields" :key="field.key" class="field">
          <view class="field-head"><text>{{ field.label }}<text v-if="field.required" class="required"> *</text></text><text class="unit">{{ field.unit }}</text></view>
          <input :value="form[field.key]" type="digit" :disabled="status !== 'DRAFT'" placeholder="请输入数值" placeholder-class="placeholder" @input="update(field.key, $event)" />
        </view>
      </view>
    </view>

    <view v-if="laborSummary.pendingShiftCount > 0" class="card labor-card labor-pending" @click="goToTimeConfirmation">
      <view class="labor-head"><view><text class="section-title">工时数量</text><text class="labor-value">{{ laborHoursText }}<small> 小时</small></text></view><text class="labor-icon">›</text></view>
      <text class="labor-hint">还有 {{ laborSummary.pendingShiftCount }} 个班次待确认。点击这里前往工时确认，完成后将自动更新本门店总工时。</text>
      <view class="labor-action">去确认工时</view>
    </view>
    <view v-else class="card labor-card labor-ready">
      <view class="labor-head"><view><text class="section-title">工时数量</text><text class="labor-value">{{ laborHoursText }}<small> 小时</small></text></view><text class="confirmed-mark">已自动计算</text></view>
      <text class="labor-hint">{{ laborSummary.scheduledShiftCount > 0 ? `已确认 ${laborSummary.confirmedShiftCount} 个可统计班次，工时按确认记录自动汇总。` : '当天暂无可统计排班，工时按 0 小时计算。' }}</text>
    </view>

    <view class="card remark-field">
      <view class="field-head"><text>备注</text><text class="unit">选填</text></view>
      <textarea :value="form.remark" :disabled="status !== 'DRAFT'" placeholder="填写需要说明的情况" placeholder-class="placeholder" @input="update('remark', $event)" />
    </view>
    <text v-if="message && !syncPending" class="error-text">{{ message }}</text>
    <text v-if="syncPending" class="sync-note">{{ message }}</text>
    <template v-if="status === 'DRAFT'">
      <view class="action-row"><view class="button secondary" @click="save(false)">保存草稿</view><view class="button" @click="save(true)">{{ saving ? '处理中…' : '提交日报' }}</view></view>
    </template>
  </view>
</template>

<style scoped>
.form-hero{display:flex;justify-content:space-between;align-items:flex-start;padding:16rpx 4rpx 22rpx}.hero-title{display:block;margin-top:4rpx;font-size:40rpx;font-weight:700}.hero-date{display:block;margin-top:4rpx;color:#8490a5;font-size:24rpx}.notice{display:flex;align-items:center;gap:12rpx;margin-bottom:16rpx;padding:16rpx 18rpx;border-radius:16rpx;background:#fff4ed;color:#a74113;font-size:22rpx}.notice-icon{display:flex;align-items:center;justify-content:center;width:28rpx;height:28rpx;border-radius:50%;background:#f15b16;color:white;font-size:19rpx;font-weight:bold}.reminder-card{margin-bottom:16rpx}.reminder-actions{display:grid;grid-template-columns:1fr 1.25fr 1fr;gap:12rpx;margin-top:16rpx}.reminder-actions .button{min-height:66rpx;padding:0 10rpx;font-size:22rpx}.picker{display:flex;align-items:center;height:66rpx;padding:0 12rpx;border:1rpx solid #dbe1ea;border-radius:12rpx;background:#fbfcfe;color:#55637a;font-size:22rpx}.reminder-message{display:block;margin-top:12rpx;color:#df591b;font-size:22rpx}.input-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16rpx}.input-grid .field{margin:0;padding:16rpx;border:1rpx solid #edf0f4;border-radius:14rpx;background:#fbfcfe}.field-head{display:flex;justify-content:space-between;align-items:center}.field-head text{margin-bottom:8rpx;font-size:24rpx}.input-grid input{height:64rpx;padding:0 12rpx;border:0;border-radius:10rpx;background:#fff;font-size:28rpx}.field textarea{box-sizing:border-box;width:100%;min-height:120rpx;margin-top:10rpx;padding:12rpx;border:0;border-radius:10rpx;background:#fbfcfe;font-size:26rpx}.remark-field{margin-top:16rpx}.required{color:#e55322}.unit{color:#a4adbb!important;font-size:21rpx!important;font-weight:400!important}.placeholder{color:#b5becb}.action-row{display:flex;gap:18rpx}.action-row .button{flex:1}.button{display:flex;align-items:center;justify-content:center;min-height:72rpx;padding:0 20rpx;border:0;border-radius:14rpx;background:#f15b16;color:#fff;font-size:24rpx;font-weight:600}.button.secondary{background:#fff4ed;color:#e75311;box-shadow:none}.labor-card{margin-top:16rpx;border:1rpx solid #e5eaf1}.labor-pending{border-color:#fed7aa;background:#fffaf5}.labor-head{display:flex;align-items:center;justify-content:space-between}.labor-value{display:block;margin-top:8rpx;color:#172033;font-size:42rpx;font-weight:700}.labor-value small{font-size:22rpx;font-weight:500;color:#8490a5}.labor-hint{display:block;margin-top:12rpx;color:#748198;font-size:22rpx;line-height:1.55}.labor-pending .labor-hint{color:#9a4a19}.labor-icon{color:#e75311;font-size:48rpx}.labor-action{display:inline-flex;margin-top:16rpx;padding:10rpx 20rpx;border-radius:999rpx;background:#f15b16;color:#fff;font-size:22rpx;font-weight:600}.confirmed-mark{padding:8rpx 14rpx;border-radius:999rpx;background:#e9f8f1;color:#14805f;font-size:20rpx}.sync-note{display:block;margin-top:14rpx;padding:14rpx;border-radius:12rpx;background:#fff6eb;color:#a35c23;font-size:22rpx;line-height:1.5}
.form-hero-actions{display:flex;flex-direction:column;align-items:flex-end;gap:8rpx}
</style>
