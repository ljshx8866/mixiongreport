<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import TimeRangeEditor from '../../components/TimeRangeEditor.vue'
import { request } from '../../utils/api'
import { formatChinaClock } from '../../utils/china-time'
import { errorMessage } from '../../utils/session'
import { hrStatusLabel } from '../../utils/hr-labels'

type BreakPeriod = { start: string; end: string }
type RecordRow = { recordId: number; employeeName: string; version: number;
  actualStart: string; actualEnd: string; scheduledMinutes: number; statisticalMinutes: number;
  breaks?: BreakPeriod[]; breakMinutes?: number }
type Correction = { id: number; recordId: number; action: 'ADJUST' | 'DELETE'; status: string; reason: string; proposedStatisticalMinutes: number }
type Store = { id: number; permissionCodes: string[] }
const storeId = ref(0)
const date = ref('')
const permissions = ref<string[]>([])
const records = ref<RecordRow[]>([])
const corrections = ref<Correction[]>([])
const selected = ref<RecordRow | null>(null)
const start = ref('09:00')
const end = ref('17:00')
const breakStart = ref('')
const breakEnd = ref('')
const breakEdited = ref(false)
const reason = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const canManage = computed(() => permissions.value.includes('HR_TIME_CORRECTION_EDIT') || permissions.value.includes('HR_TIME_CORRECTION_DELETE'))
const yesterday = () => new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10)
const clock = (value: string) => formatChinaClock(value)
const statusName = (status: string) => ({ APPLIED: '已生效', PENDING: '旧流程待处理',
  REJECTED: '已关闭', APPLY_FAILED: '应用失败' }[status] ?? hrStatusLabel(status))

onLoad((options) => { storeId.value = Number(options?.storeId || 0); date.value = yesterday() })
onShow(() => { if (storeId.value) void load() })
async function load() {
  loading.value = true; message.value = ''
  try {
    const access = await request<{ stores: Store[] }>('/api/hr/current-access')
    permissions.value = access.stores.find((store) => store.id === storeId.value)?.permissionCodes ?? []
    corrections.value = await request<Correction[]>(`/api/hr/time-corrections?storeId=${storeId.value}`)
    if (canManage.value) {
      const day = await request<{ confirmed: RecordRow[] }>(
        `/api/hr/timesheets?storeId=${storeId.value}&date=${date.value}`)
      records.value = day.confirmed
    } else records.value = []
  } catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}
function select(row: RecordRow) {
  selected.value = row; start.value = clock(row.actualStart); end.value = clock(row.actualEnd)
  const breaks = Array.isArray(row.breaks) ? row.breaks : []
  breakStart.value = breaks[0] ? clock(breaks[0].start) : ''
  breakEnd.value = breaks[0] ? clock(breaks[0].end) : ''
  breakEdited.value = false; reason.value = ''
}
function clearBreak() {
  breakStart.value = ''; breakEnd.value = ''; breakEdited.value = true
}
async function submit() {
  if (!selected.value || !reason.value.trim()) { message.value = '请填写更正原因'; return }
  if (Boolean(breakStart.value) !== Boolean(breakEnd.value)) {
    message.value = '休息开始和结束时间需同时填写'; return
  }
  saving.value = true; message.value = ''
  try {
    const payload: Record<string, unknown> = {
      recordId: selected.value.recordId, expectedVersion: selected.value.version,
      actualStart: `${date.value}T${start.value}:00+08:00`,
      actualEnd: `${date.value}T${end.value}:00+08:00`, reason: reason.value.trim(),
    }
    // Omit breaks unless the user edits them; the server then preserves the
    // confirmed break intervals and any scheduled break-minute deduction.
    if (breakEdited.value) payload.breaks = breakStart.value
      ? [{ start: `${date.value}T${breakStart.value}:00+08:00`,
        end: `${date.value}T${breakEnd.value}:00+08:00` }, ...(selected.value.breaks ?? []).slice(1)]
      : []
    await request('/api/hr/time-corrections', 'POST', payload)
    selected.value = null; await load(); message.value = '工时已直接更正，历史版本和操作日志已保留'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
function deleteRecord() {
  if (!selected.value || !reason.value.trim()) { message.value = '请填写删除原因'; return }
  const row = selected.value
  uni.showModal({ title: '删除已确认工时',
    content: `确认删除 ${row.employeeName} 的这条工时吗？删除后立即从当前统计中移除，历史版本仍保留。`,
    confirmText: '确认删除', confirmColor: '#c94135',
    success: async (result) => {
      if (!result.confirm) return
      saving.value = true; message.value = ''
      try {
        await request('/api/hr/time-corrections', 'POST', { recordId: row.recordId,
          expectedVersion: row.version, action: 'DELETE', reason: reason.value.trim() })
        selected.value = null; await load(); message.value = '工时已删除，历史版本和操作日志已保留'
      } catch (error) { message.value = errorMessage(error) }
      finally { saving.value = false }
    },
  })
}
</script>

<template>
  <view class="page detail-page"><PageLoading v-if="loading" /><view class="store-context-heading"><view class="heading">工时更正</view>
    <StoreSelector v-model="storeId" source="hr" :permission="['HR_TIME_CORRECTION_READ','HR_TIME_CORRECTION_EDIT','HR_TIME_CORRECTION_DELETE']" @ready="load" @change="load" /></view>
    <view class="card intro">授权人员可直接调整或删除已确认工时，无需审批；每次修改都会保留历史版本和操作日志。</view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view v-if="canManage" class="card">
      <picker mode="date" :value="date" @change="(event) => { date = String(event.detail.value); void load() }">
        <view class="field">选择已确认日期：{{ date }}</view></picker>
      <view class="section-title">选择员工记录</view>
      <view v-for="row in records" :key="row.recordId" class="row" @click="select(row)">
        <text>{{ row.employeeName }}</text><text>排班 {{ (row.scheduledMinutes / 60).toFixed(2) }} 小时 · 统计 {{ (row.statisticalMinutes / 60).toFixed(2) }} 小时 ›</text></view>
      <view v-if="!loading && !records.length" class="empty">该日没有已确认记录</view>
    </view>
    <view v-if="selected" class="card"><view class="section-title">更正 {{ selected.employeeName }}</view>
      <TimeRangeEditor title="已确认与更正时间对比" start-label="更正后开始" end-label="更正后结束"
        :start="start" :end="end" :baseline-start="clock(selected.actualStart)"
        :baseline-end="clock(selected.actualEnd)" baseline-label="已确认时间"
        :break-start="breakStart" :break-end="breakEnd" show-break
        @update:start="start = $event" @update:end="end = $event"
        @update:break-start="breakStart = $event; breakEdited = true"
        @update:break-end="breakEnd = $event; breakEdited = true" />
      <view class="detail">原休息扣除 {{ selected.breakMinutes ?? 0 }} 分钟，默认保持不变；需要调整时再修改。</view>
      <button class="button secondary clear-break" :disabled="saving" @click="clearBreak">清除休息扣除</button>
      <view class="field">更正原因<input v-model="reason" placeholder="必填" /></view>
      <button class="button" :disabled="saving || !reason.trim()" @click="submit">保存工时更正</button>
      <button class="button danger" :disabled="saving || !reason.trim()" @click="deleteRecord">直接删除该条已确认工时</button>
    </view>
    <view v-if="!canManage" class="card empty">当前账号没有直接调整工时的权限，请联系管理员配置“直接修改/删除工时”权限。</view>
    <view class="section-title list-title">工时更正日志</view>
    <view v-for="row in corrections" :key="row.id" class="card">
      <view>记录 #{{ row.recordId }} · {{ row.action === 'DELETE' ? '删除' : '时间更正' }} · {{ statusName(row.status) }} · {{ row.status === 'APPLIED' ? (row.action === 'DELETE' ? '已从当前统计移除' : `更正后统计工时 ${(row.proposedStatisticalMinutes / 60).toFixed(2)} 小时`) : '' }}</view>
      <view class="detail">{{ row.reason }}</view>
    </view>
  </view>
</template>

<style scoped>
.heading{font-size:38rpx;font-weight:700;color:#172033;margin-bottom:22rpx}.notice{color:#168252}.intro{margin-bottom:16rpx;color:#526176;line-height:1.55}
.card{margin-bottom:16rpx}.field{margin:14rpx 0;padding:16rpx;border:1rpx solid #e2e8f0;border-radius:12rpx}
.field input{margin-top:8rpx}.row{display:flex;justify-content:space-between;padding:20rpx 0;border-bottom:1rpx solid #edf1f6}
.row text:last-child{color:#df591b}.empty,.detail{color:#8490a5;font-size:24rpx;margin-top:12rpx}
.list-title{margin:24rpx 0 12rpx}.button.danger{margin-top:14rpx;background:#fff1f0;color:#c94135}
.button.secondary.clear-break{margin-top:10rpx;background:#f3f5f8;color:#475569}
</style>
