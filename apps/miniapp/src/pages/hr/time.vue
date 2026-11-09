<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import TimeRangeEditor from '../../components/TimeRangeEditor.vue'
import { request } from '../../utils/api'
import { formatChinaClock } from '../../utils/china-time'
import { errorMessage } from '../../utils/session'

type Pending = { scheduleId: number; employeeId: number; employeeName: string; plannedStart: string | null;
  plannedEnd: string | null; breakMinutes: number; isSelf?: boolean }
type Confirmed = { recordId: number; scheduleId: number; employeeId: number; employeeName: string;
  scheduledMinutes: number; statisticalMinutes: number; actualStart: string; actualEnd: string; isSelf?: boolean }
type DayEmployee = { employeeId: number; employeeName: string; isSelf: boolean; pending: Pending[]; confirmed: Confirmed[] }
type ShiftInput = Pending & { adjusted: boolean; start: string; end: string; breakStart: string; breakEnd: string;
  useScheduledBreak?: boolean }
const storeId = ref(0)
const date = ref('')
const pending = ref<Pending[]>([])
const confirmed = ref<Confirmed[]>([])
const allFormOpen = ref(false)
const allFormShifts = ref<ShiftInput[]>([])
const allReason = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const employeeGroups = computed<DayEmployee[]>(() => {
  const byId = new Map<number, DayEmployee>()
  const groupFor = (employeeId: number, employeeName: string, isSelf = false) => {
    let group = byId.get(employeeId)
    if (!group) { group = { employeeId, employeeName, isSelf, pending: [], confirmed: [] }; byId.set(employeeId, group) }
    else group.isSelf ||= isSelf
    return group
  }
  for (const shift of pending.value) groupFor(shift.employeeId, shift.employeeName, shift.isSelf).pending.push(shift)
  for (const shift of confirmed.value) groupFor(shift.employeeId, shift.employeeName, shift.isSelf).confirmed.push(shift)
  return Array.from(byId.values()).sort((a, b) => Number(b.isSelf) - Number(a.isSelf) ||
    a.employeeName.localeCompare(b.employeeName, 'zh-CN'))
})
function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }
function localTime(value: string) { return formatChinaClock(value) }
function plannedTime(item: { plannedStart: string | null; plannedEnd: string | null }) {
  return `${item.plannedStart ? localTime(item.plannedStart) : '--:--'}–${item.plannedEnd ? localTime(item.plannedEnd) : '--:--'}`
}
const hours = (minutes: number) => (minutes / 60).toFixed(2)
onLoad((options) => { storeId.value = Number(options?.storeId || 0); date.value = today() })
onShow(() => { date.value = today(); if (storeId.value) load() })
async function load() {
  loading.value = true; message.value = ''
  try {
    const day = await request<{ pending: Pending[]; confirmed: Confirmed[] }>(
      `/api/hr/timesheets?storeId=${storeId.value}&date=${date.value}`)
    pending.value = day.pending; confirmed.value = day.confirmed
  } catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}
function chooseAll() {
  if (!pending.value.length) return
  allFormShifts.value = pending.value.map((item) => ({ ...item,
    adjusted: false,
    start: item.plannedStart ? localTime(item.plannedStart) : '09:00',
    end: item.plannedEnd ? localTime(item.plannedEnd) : '17:00', breakStart: '', breakEnd: '' }))
  allReason.value = ''
  allFormOpen.value = true
}
function allShift(scheduleId: number) {
  return allFormShifts.value.find((shift) => shift.scheduleId === scheduleId)
}
async function confirmAllAsScheduled() {
  if (!pending.value.length) return
  if (pending.value.some((shift) => !shift.plannedStart || !shift.plannedEnd)) {
    chooseAll()
    message.value = '部分班次缺少排班时间，已展开对应记录，请补充后统一确认'
    return
  }
  await submitStoreDay(pending.value.map((shift) => ({ ...shift, adjusted: false,
    start: localTime(shift.plannedStart!), end: localTime(shift.plannedEnd!), breakStart: '', breakEnd: '',
    useScheduledBreak: true })))
}
async function submitStoreDay(shifts: ShiftInput[]) {
  if (!shifts.length) return
  if (shifts.some((shift) => Boolean(shift.breakStart) !== Boolean(shift.breakEnd))) {
    message.value = '每个班次的休息开始和结束时间需同时填写'; return
  }
  saving.value = true; message.value = ''
  const count = shifts.length
  try {
    await request('/api/hr/timesheets/confirm-store-day', 'POST', {
      storeId: storeId.value, date: date.value,
      shifts: shifts.map((shift) => ({ scheduleId: shift.scheduleId,
        actualStart: `${date.value}T${shift.start}:00+08:00`, actualEnd: `${date.value}T${shift.end}:00+08:00`,
        breaks: shift.breakStart ? [{ start: `${date.value}T${shift.breakStart}:00+08:00`,
          end: `${date.value}T${shift.breakEnd}:00+08:00` }] : [],
        useScheduledBreak: shift.useScheduledBreak ?? !shift.breakStart,
        reason: allReason.value.trim() })),
    })
    allFormOpen.value = false; allFormShifts.value = []; await load()
    message.value = `全店 ${count} 个班次已一次确认，后续修改需提交工时更正`
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
async function confirmAll() {
  if (!allFormShifts.value.length) return
  const effective = allFormShifts.value.map((shift) => shift.adjusted ? shift : ({ ...shift,
    start: shift.plannedStart ? localTime(shift.plannedStart) : shift.start,
    end: shift.plannedEnd ? localTime(shift.plannedEnd) : shift.end, breakStart: '', breakEnd: '' }))
  await submitStoreDay(effective)
}
</script>

<template>
  <view class="page detail-page">
    <PageLoading v-if="loading" />
    <view class="store-context-heading"><view class="heading">当日工时确认</view>
      <StoreSelector v-model="storeId" source="hr" :permission="['HR_TIME_LIST_READ','HR_TIME_ADJUST','HR_TIME_CONFIRM_ONE','HR_TIME_BULK_CONFIRM']" @ready="load" @change="load" /></view>
    <view class="subheading">{{ date }} · 同一员工当天班次合并确认，时间按排班预填</view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view v-if="pending.length" class="card store-confirm-card">
      <text class="store-confirm-title">全店批量确认 · {{ pending.length }} 个待确认班次</text>
      <text class="form-hint">可以按当前排班直接确认全部人员，也可以展开班次记录调整部分时间后统一提交。</text>
      <view class="group-actions store-actions">
        <button class="button confirm-button" :disabled="saving" @click="confirmAllAsScheduled">全店按当前排班一键确认</button>
        <button v-if="!allFormOpen" class="button secondary adjust-button" :disabled="saving" @click="chooseAll">调整个别班次后统一确认</button>
        <view v-else class="form-actions store-form-actions">
          <button class="button secondary" :disabled="saving" @click="allFormOpen = false; allFormShifts = []">取消调整</button>
          <button class="button" :disabled="saving" @click="confirmAll">确认全店 {{ allFormShifts.length }} 个班次</button>
        </view>
      </view>
      <view v-if="allFormOpen" class="field reason-field"><text>全店统一说明（可选）</text><input v-model="allReason" /></view>
    </view>
    <view class="section-title list-title">当日员工 {{ employeeGroups.length }} 人</view>
    <view v-for="group in employeeGroups" :key="group.employeeId" class="card employee-card">
      <view class="employee-head">
        <view class="employee-name"><text>{{ group.employeeName }}</text><text v-if="group.isSelf" class="self-badge">本人</text></view>
        <text class="status">{{ group.pending.length ? `待确认 ${group.pending.length} 个班次` : `已确认 ${group.confirmed.length} 个班次` }}</text>
      </view>
      <view v-for="item in group.pending" :key="`pending-${item.scheduleId}`" class="shift-row pending-row">
        <text class="shift-label">待确认 · 排班 {{ plannedTime(item) }} · 休息 {{ item.breakMinutes }} 分钟</text>
        <view v-if="allFormOpen && allShift(item.scheduleId)" class="inline-shift-form">
          <view class="shift-form-head">
            <text class="shift-form-title">{{ group.employeeName }} · 班次调整</text>
            <label class="adjust-toggle"><text>需要调整</text><switch :checked="allShift(item.scheduleId)!.adjusted"
              @change="(event) => allShift(item.scheduleId)!.adjusted = Boolean(event.detail.value)" /></label>
          </view>
          <view v-if="allShift(item.scheduleId)!.adjusted" class="adjust-fields">
            <TimeRangeEditor title="排班与实际时间" start-label="实际上班" end-label="实际下班"
              :start="allShift(item.scheduleId)!.start" :end="allShift(item.scheduleId)!.end"
              :baseline-start="item.plannedStart ? localTime(item.plannedStart) : ''"
              :baseline-end="item.plannedEnd ? localTime(item.plannedEnd) : ''" baseline-label="排班时间"
              :break-start="allShift(item.scheduleId)!.breakStart" :break-end="allShift(item.scheduleId)!.breakEnd"
              show-break @update:start="allShift(item.scheduleId)!.start = $event"
              @update:end="allShift(item.scheduleId)!.end = $event"
              @update:break-start="allShift(item.scheduleId)!.breakStart = $event"
              @update:break-end="allShift(item.scheduleId)!.breakEnd = $event" />
          </view>
          <text v-else class="unchanged-hint">此班次按当前排班时间确认</text>
        </view>
      </view>
      <view v-for="item in group.confirmed" :key="`confirmed-${item.recordId}`" class="shift-row">
        <text class="shift-label">已确认 · 实际 {{ localTime(item.actualStart) }}–{{ localTime(item.actualEnd) }}</text>
        <text class="shift-meta">排班 {{ hours(item.scheduledMinutes) }} 小时 · 统计 {{ hours(item.statisticalMinutes) }} 小时</text>
      </view>
      <view v-if="group.pending.length && group.confirmed.length" class="day-total">
        已确认统计工时 {{ hours(group.confirmed.reduce((sum, item) => sum + item.statisticalMinutes, 0)) }} 小时
      </view>
    </view>
    <view v-if="!loading && !employeeGroups.length" class="card empty">今天暂无需要确认的工时</view>
  </view>
</template>

<style scoped>
.heading{font-size:38rpx;font-weight:700;color:#172033}.subheading{display:block;margin-top:8rpx;color:#8490a5;font-size:23rpx;line-height:1.5}
.notice{margin-top:20rpx;color:#b45309}.list-title{margin:28rpx 0 14rpx}.employee-card{margin-bottom:14rpx}.employee-head{display:flex;align-items:center;justify-content:space-between;gap:12rpx}
.employee-name{display:flex;align-items:center;gap:10rpx;color:#172033;font-size:29rpx;font-weight:700}.self-badge{padding:3rpx 10rpx;border-radius:999rpx;background:#e9f3ff;color:#2563a8;font-size:19rpx;font-weight:600}.status{color:#df591b;font-size:22rpx}.shift-row{display:flex;flex-direction:column;gap:5rpx;margin-top:14rpx;padding:12rpx 14rpx;border-radius:12rpx;background:#f7f8fa}.pending-row{background:#fff7f0}
.shift-label{color:#334155;font-size:22rpx}.shift-meta,.day-total{color:#8490a5;font-size:21rpx}.day-total{margin-top:12rpx}.confirm-button{width:100%;margin-top:16rpx}.button{min-height:72rpx;padding:0 20rpx;border:0;border-radius:14rpx;background:#f15b16;color:#fff;font-size:24rpx;font-weight:600}.button.secondary{background:#fff4ed;color:#e75311;box-shadow:none}.button[disabled]{opacity:.5}
.form-card{margin-top:20rpx}.form-hint{display:block;margin-top:8rpx;color:#8490a5;font-size:22rpx}.shift-form{margin-top:18rpx;padding-top:16rpx;border-top:1rpx solid #edf0f4}.shift-form-title{display:block;color:#26344b;font-size:23rpx;font-weight:700}.field{margin:12rpx 0;padding:16rpx;border:1rpx solid #e2e8f0;border-radius:12rpx;color:#334155;font-size:23rpx}.field input{margin-top:8rpx}.reason-field{margin-top:18rpx}.form-actions{display:flex;gap:14rpx;margin-top:18rpx}.form-actions .button{flex:1;padding:0 10rpx;font-size:22rpx}.empty{text-align:center;color:#8490a5}
.group-actions{display:flex;flex-direction:column;gap:10rpx;margin-top:16rpx}.group-actions .confirm-button{margin-top:0}.adjust-button{background:#f3f5f8!important;color:#475569!important}.shift-form-head{display:flex;align-items:center;justify-content:space-between;gap:12rpx}.shift-form-title{flex:1}.adjust-toggle{display:flex;align-items:center;gap:8rpx;color:#64748b;font-size:20rpx}.unchanged-hint{display:block;margin-top:10rpx;color:#15906b;font-size:21rpx}
.store-confirm-card{margin-top:18rpx;border:1rpx solid #fed7aa;background:#fffaf5}.store-confirm-title{display:block;color:#9a3412;font-size:27rpx;font-weight:700}.store-actions{margin-top:14rpx}.store-form-actions{width:100%;margin-top:0}.store-form-actions .button{min-height:76rpx}.inline-shift-form{margin-top:14rpx;padding:14rpx;border:1rpx solid #fed7aa;border-radius:12rpx;background:#fff}.inline-shift-form .adjust-fields{margin-top:8rpx}.inline-shift-form .field{margin:8rpx 0}
</style>
