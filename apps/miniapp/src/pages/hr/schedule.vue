<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import TimeRangeEditor from '../../components/TimeRangeEditor.vue'
import { request } from '../../utils/api'
import { chinaClockMinutes, formatChinaClock } from '../../utils/china-time'
import { errorMessage } from '../../utils/session'
import { hrFailureLabel, hrStatusLabel } from '../../utils/hr-labels'

type Employee = { id: number; displayName: string }
type ShiftTemplate = { id: number; name: string; startTime: string; endTime: string; breakMinutes: number; enabled: boolean }
type SchedulePoint = { id: number; name: string; sortOrder: number; enabled: boolean }
type Shift = { id: number; employeeId: number; employeeName: string; shiftTemplateName: string | null;
  pointId: number | null; pointName: string | null;
  status: string; version: number; shiftTemplateId: number | null;
  plannedStart: string | null; plannedEnd: string | null; breakMinutes: number;
  deliveryStatus: string | null; deliveryReasonCode: string | null }
type EmployeeScheduleGroup = { employeeId: number; employeeName: string; pointName: string; shifts: Shift[] }
const storeId = ref(0)
const date = ref(shanghaiDate(1))
const employees = ref<Employee[]>([])
const templates = ref<ShiftTemplate[]>([])
const points = ref<SchedulePoint[]>([])
const shifts = ref<Shift[]>([])
const selectedEmployeeIds = ref<number[]>([])
const selectedTemplates = ref<Record<string, number[]>>({})
const selectedPoints = ref<Record<string, number>>({})
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const editingScheduleId = ref<number | null>(null)
const editingTemplateId = ref<number | null>(null)
const activeTemplates = computed(() => templates.value.filter((item) => item.enabled))
const activePoints = computed(() => points.value.filter((item) => item.enabled))
const selectedAssignmentCount = computed(() => Object.values(selectedTemplates.value).reduce((sum, ids) => sum + ids.length, 0))
const draftShifts = computed(() => shifts.value.filter((item) => item.status === 'DRAFT'))
const publishedShifts = computed(() => shifts.value.filter((item) => item.status === 'PUBLISHED'))
const dateDisplay = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(date.value)
  ? `${date.value.slice(0, 4)}年${date.value.slice(5, 7)}月${date.value.slice(8, 10)}日` : '请选择日期')
const groupedShifts = computed<EmployeeScheduleGroup[]>(() => {
  const groups = new Map<number, EmployeeScheduleGroup>()
  for (const shift of shifts.value) {
    let group = groups.get(shift.employeeId)
    if (!group) {
      group = { employeeId: shift.employeeId, employeeName: shift.employeeName, pointName: '', shifts: [] }
      groups.set(shift.employeeId, group)
    }
    group.shifts.push(shift)
  }
  for (const group of groups.values()) {
    const names = [...new Set(group.shifts.map((item) => item.pointName).filter((item): item is string => !!item))]
    group.pointName = names.length === 1 ? names[0] : names.length > 1 ? '多个点位' : '未设置点位'
  }
  return Array.from(groups.values())
})
const notificationsEnabled = import.meta.env.VITE_HR_SCHEDULE_NOTIFY_ENABLED === 'true'

function shanghaiDate(offsetDays = 0) {
  let year: number, month: number, dateOfMonth: number
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric',
      month: '2-digit', day: '2-digit' }).formatToParts(new Date())
    const value = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0)
    year = value('year'); month = value('month'); dateOfMonth = value('day')
  } catch {
    const nowInShanghai = new Date(Date.now() + 8 * 3600000)
    year = nowInShanghai.getUTCFullYear(); month = nowInShanghai.getUTCMonth() + 1; dateOfMonth = nowInShanghai.getUTCDate()
  }
  const day = new Date(Date.UTC(year, month - 1, dateOfMonth + offsetDays))
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
}
function shanghaiToday() { return shanghaiDate() }
function shanghaiMinutes(value: string) {
  return chinaClockMinutes(value) ?? 0
}
function templateMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}
function durationLabel(minutes: number) {
  const safeMinutes = Math.max(0, Math.floor(minutes))
  const hours = Math.floor(safeMinutes / 60)
  const remainder = safeMinutes % 60
  if (hours && remainder) return `${hours}小时${remainder}分`
  if (hours) return `${hours}小时`
  return `${remainder}分钟`
}
function templateWorkMinutes(template: ShiftTemplate) {
  return Math.max(0, templateMinutes(template.endTime) - templateMinutes(template.startTime) - template.breakMinutes)
}
function shiftWorkMinutes(shift: Shift) {
  if (!shift.plannedStart || !shift.plannedEnd) return 0
  const elapsed = Math.floor((new Date(shift.plannedEnd).getTime() - new Date(shift.plannedStart).getTime()) / 60000)
  return Math.max(0, elapsed - shift.breakMinutes)
}
function selectedFor(employeeId: number) { return selectedTemplates.value[String(employeeId)] ?? [] }
function selectedPointFor(employeeId: number) { return selectedPoints.value[String(employeeId)] ?? 0 }
function pointIndex(employeeId: number) {
  const index = activePoints.value.findIndex((item) => item.id === selectedPointFor(employeeId))
  return Math.max(0, index)
}
function changePoint(employeeId: number, event: { detail: { value: number | string } }) {
  const point = activePoints.value[Number(event.detail.value)]
  if (point) selectedPoints.value = { ...selectedPoints.value, [String(employeeId)]: point.id }
}
function hasTimeConflict(employeeId: number, template: ShiftTemplate) {
  const start = templateMinutes(template.startTime), end = templateMinutes(template.endTime)
  const existingConflict = shifts.value.filter((item) => item.employeeId === employeeId && item.plannedStart && item.plannedEnd)
    .some((item) => start < shanghaiMinutes(item.plannedEnd!) && shanghaiMinutes(item.plannedStart!) < end)
  if (existingConflict) return true
  return selectedFor(employeeId).filter((id) => id !== template.id).some((id) => {
    const other = activeTemplates.value.find((item) => item.id === id)
    return !!other && start < templateMinutes(other.endTime) && templateMinutes(other.startTime) < end
  })
}
function scheduleHasTimeConflict(shift: Shift, template: ShiftTemplate) {
  const start = templateMinutes(template.startTime), end = templateMinutes(template.endTime)
  return shifts.value.some((item) => item.id !== shift.id && item.employeeId === shift.employeeId &&
    item.plannedStart && item.plannedEnd &&
    start < shanghaiMinutes(item.plannedEnd) && shanghaiMinutes(item.plannedStart) < end)
}
function beginEdit(shift: Shift) {
  if (shift.status !== 'DRAFT' && shift.status !== 'PUBLISHED') return
  editingScheduleId.value = shift.id
  editingTemplateId.value = shift.shiftTemplateId
}
function cancelEdit() {
  editingScheduleId.value = null
  editingTemplateId.value = null
}
function selectEditTemplate(shift: Shift, template: ShiftTemplate) {
  if (!scheduleHasTimeConflict(shift, template)) editingTemplateId.value = template.id
}
async function saveEdit(shift: Shift) {
  const isPublishedAdjustment = shift.status === 'PUBLISHED'
  if (editingTemplateId.value == null) {
    uni.showModal({ title: '请选择班次', content: '请选择一个班次后再保存。', showCancel: false })
    return
  }
  const template = activeTemplates.value.find((item) => item.id === editingTemplateId.value)
  if (!template) {
    uni.showModal({ title: '班次不可用', content: '该班次已停用，请重新选择。', showCancel: false })
    return
  }
  if (scheduleHasTimeConflict(shift, template)) {
    uni.showModal({ title: '班次时间冲突', content: '该员工已有其他时间重叠的班次，请重新选择。', showCancel: false })
    return
  }
  saving.value = true
  try {
    await request(`/api/hr/schedules/${shift.id}`, 'PATCH', {
      expectedVersion: shift.version, shiftTemplateId: template.id,
    })
    cancelEdit()
    await load()
    message.value = isPublishedAdjustment ? '班次调整已保存，请统一重新发布后生效。' : '排班草稿已修改。'
  } catch (error) {
    uni.showModal({ title: '修改失败', content: errorMessage(error), showCancel: false })
  } finally { saving.value = false }
}
function confirmDeleteShift(shift: Shift) {
  if (shift.status !== 'DRAFT' && shift.status !== 'PUBLISHED') return
  const wasPublished = shift.status === 'PUBLISHED'
  uni.showModal({
    title: wasPublished ? '删除已发布班次' : '删除待发布班次',
    content: wasPublished
      ? `确定从排班中撤销 ${shift.employeeName} 的“${shift.shiftTemplateName || '该班次'}”吗？如已确认实际工时，需先通过工时更正处理。操作会保留记录。`
      : `确定删除 ${shift.employeeName} 的“${shift.shiftTemplateName || '该班次'}”吗？删除后不会发布，并会保留操作记录。`,
    confirmText: '确认删除',
    confirmColor: '#c94135',
    success: async (result) => {
      if (!result.confirm) return
      saving.value = true
      try {
        await request(`/api/hr/schedules/${shift.id}/cancel`, 'POST', { expectedVersion: shift.version })
        if (editingScheduleId.value === shift.id) cancelEdit()
        await load()
        message.value = wasPublished ? '已发布班次已撤销。' : '待发布班次已删除。'
      } catch (error) {
        uni.showModal({ title: '删除失败', content: errorMessage(error), showCancel: false })
      } finally { saving.value = false }
    },
  })
}
function templateSelected(employeeId: number, templateId: number) { return selectedFor(employeeId).includes(templateId) }
function toggleEmployee(employeeId: number) {
  const selected = selectedEmployeeIds.value.includes(employeeId)
  selectedEmployeeIds.value = selected
    ? selectedEmployeeIds.value.filter((id) => id !== employeeId)
    : [...selectedEmployeeIds.value, employeeId]
  if (selected) {
    const next = { ...selectedTemplates.value }; delete next[String(employeeId)]; selectedTemplates.value = next
    const nextPoints = { ...selectedPoints.value }; delete nextPoints[String(employeeId)]; selectedPoints.value = nextPoints
  } else if (!selectedTemplates.value[String(employeeId)]) {
    selectedTemplates.value = { ...selectedTemplates.value, [String(employeeId)]: [] }
  }
}
function toggleTemplate(employeeId: number, template: ShiftTemplate) {
  const current = selectedFor(employeeId)
  if (current.includes(template.id)) {
    selectedTemplates.value = { ...selectedTemplates.value, [String(employeeId)]: current.filter((id) => id !== template.id) }
    return
  }
  if (hasTimeConflict(employeeId, template)) {
    message.value = `${template.name}与该员工已排班次时间冲突，不能选择`
    uni.showModal({ title: '班次时间冲突', content: message.value, showCancel: false })
    return
  }
  selectedTemplates.value = { ...selectedTemplates.value, [String(employeeId)]: [...current, template.id] }
  message.value = ''
}
onLoad((options) => {
  storeId.value = Number(options?.storeId || 0)
  if (typeof options?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.date)) date.value = options.date
})
onShow(() => { if (storeId.value) void load() })
async function load() {
  loading.value = true; message.value = ''
  try {
    const [people, nextShifts, shiftTemplates, schedulePoints] = await Promise.all([
      request<Employee[]>(`/api/hr/employees/candidates?storeId=${storeId.value}&date=${date.value}`),
      request<Shift[]>(`/api/hr/schedules?storeId=${storeId.value}&date=${date.value}`),
      request<ShiftTemplate[]>(`/api/hr/schedules/shift-templates?storeId=${storeId.value}`),
      request<SchedulePoint[]>(`/api/hr/schedules/points?storeId=${storeId.value}`),
    ])
    employees.value = people; shifts.value = nextShifts; templates.value = shiftTemplates; points.value = schedulePoints
    selectedEmployeeIds.value = selectedEmployeeIds.value.filter((id) => people.some((item) => item.id === id))
    const validPointIds = new Set(schedulePoints.filter((item) => item.enabled).map((item) => item.id))
    selectedPoints.value = Object.fromEntries(Object.entries(selectedPoints.value)
      .filter(([, pointId]) => validPointIds.has(pointId)))
  } catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}
async function changeDate(event: { detail: { value: string } }) {
  date.value = String(event.detail.value); selectedEmployeeIds.value = []; selectedTemplates.value = {}; selectedPoints.value = {}; cancelEdit(); await load()
}
function openShiftSettings() { uni.navigateTo({ url: `/pages/hr/shift-templates?storeId=${storeId.value}` }) }
function openPointSettings() { uni.navigateTo({ url: `/pages/hr/schedule-points?storeId=${storeId.value}` }) }
function openSchedulePoster() {
  uni.navigateTo({ url: `/pages/hr/schedule-poster?storeId=${storeId.value}&date=${date.value}` })
}
const assignments = computed(() => selectedEmployeeIds.value.flatMap((employeeId) =>
  selectedFor(employeeId).map((shiftTemplateId) => ({ employeeId, shiftTemplateId,
    pointId: selectedPointFor(employeeId) }))))
async function createBatch() {
  if (selectedEmployeeIds.value.some((employeeId) => !selectedPointFor(employeeId))) {
    uni.showModal({ title: '请选择排班点位', content: '请先在每位员工的班次上方选择点位，再保存排班。', showCancel: false })
    return
  }
  if (!assignments.value.length) {
    uni.showModal({ title: '尚未安排班次', content: '先选择员工，再为每位员工勾选一个或多个不冲突的班次。', showCancel: false })
    return
  }
  saving.value = true; message.value = ''
  try {
    const result = await request<{ count: number }>('/api/hr/schedules/batch', 'POST', {
      storeId: storeId.value, businessDate: date.value, assignments: assignments.value,
    })
    selectedEmployeeIds.value = []; selectedTemplates.value = {}; selectedPoints.value = {}; await load()
    message.value = `已为 ${result.count} 个班次创建草稿；确认无误后可一次发布。`
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
async function publishAll() {
  if (!draftShifts.value.length) return
  uni.showModal({ title: '批量发布排班', content: `将一次发布 ${draftShifts.value.length} 个排班草稿，并按设置发送通知。`,
    success: async (result) => {
      if (!result.confirm) return
      saving.value = true; message.value = ''
      try {
        const response = await request<{ count: number }>('/api/hr/schedules/publish-batch', 'POST', {
          storeId: storeId.value, businessDate: date.value, scheduleIds: draftShifts.value.map((item) => item.id),
        })
        await load(); message.value = `已同时发布 ${response.count} 个班次。`
      } catch (error) { message.value = errorMessage(error) }
      finally { saving.value = false }
    } })
}
async function retry(shift: Shift) {
  saving.value = true; message.value = ''
  try { await request(`/api/hr/schedules/${shift.id}/notification/retry`, 'POST', {}); await load(); message.value = '通知已进入发送队列。' }
  catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
const clock = (value: string | null) => value ? formatChinaClock(value) : '—'
const canRetry = (shift: Shift) => shift.status === 'PUBLISHED' &&
  (shift.deliveryStatus === 'UNAVAILABLE' || (shift.deliveryStatus === 'FAILED' &&
    (shift.deliveryReasonCode === 'RECIPIENT_NOT_BOUND' || /^WECHAT_\d+$/.test(shift.deliveryReasonCode || ''))))
</script>

<template>
  <view class="page detail-page schedule-page">
    <PageLoading v-if="loading" />
    <view class="page-hero"><view class="store-context-heading"><view class="store-context-title"><text class="eyebrow">门店排班</text><text class="hero-title">门店排班</text></view>
      <StoreSelector v-model="storeId" source="hr" :permission="['HR_SCHEDULE_LIST_READ','HR_SCHEDULE_DRAFT_EDIT','HR_SCHEDULE_DRAFT_DELETE','HR_SCHEDULE_PUBLISH','HR_SCHEDULE_REVISE']" @ready="load" @change="load" /></view>
      <text class="hero-caption">可同时为多名员工安排多个班次；系统会拦截时间冲突，完成后统一发布。</text>
      <picker mode="date" :value="date" :start="shanghaiToday()" @change="changeDate">
        <view class="hero-date"><view class="date-copy"><text class="date-label">排班日期</text><text class="date-value">{{ dateDisplay }}</text></view>
          <view class="date-edit">选择日期 ›</view></view>
      </picker>
    </view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view class="section-heading"><view><text class="section-title">选择员工和班次</text>
      <text class="section-subtitle">每位员工可选多个班次，冲突班次会自动禁用</text></view>
      <view class="settings-actions"><text class="settings-link" @click="openPointSettings">点位设置</text>
        <text class="settings-link" @click="openShiftSettings">班次设置 ›</text></view></view>
    <view v-if="!activeTemplates.length" class="card empty">
      <text>当前门店还没有可用班次。</text><button class="outline-button" @click="openShiftSettings">前往班次设置</button>
    </view>
    <view v-else-if="!employees.length && !loading" class="card empty">当前日期没有可排班的在职员工</view>
    <view v-if="!activePoints.length && employees.length" class="card empty">
      当前门店还没有可选点位，请先设置点位后再排班。
      <button class="outline-button" @click="openPointSettings">前往点位设置</button>
    </view>
    <view v-for="employee in employees" :key="employee.id" class="card employee-card"
      :class="{ chosen: selectedEmployeeIds.includes(employee.id) }">
      <view class="employee-head" @click="toggleEmployee(employee.id)">
        <view class="checkmark" :class="{ checked: selectedEmployeeIds.includes(employee.id) }">{{ selectedEmployeeIds.includes(employee.id) ? '✓' : '' }}</view>
        <view class="employee-copy"><text class="employee-name">{{ employee.displayName }}</text>
          <text class="employee-count">{{ selectedFor(employee.id).length ? `已选 ${selectedFor(employee.id).length} 个班次` : '点击选择员工' }}</text></view>
      </view>
      <view v-if="selectedEmployeeIds.includes(employee.id)" class="template-options">
        <view class="point-selector">
          <text class="point-selector-label">排班点位</text>
          <picker v-if="activePoints.length" mode="selector" :range="activePoints" range-key="name"
            :value="pointIndex(employee.id)" @change="changePoint(employee.id, $event)">
            <view class="point-picker-value" :class="{ placeholder: !selectedPointFor(employee.id) }">
              {{ activePoints.find((item) => item.id === selectedPointFor(employee.id))?.name || '请选择点位' }}
              <text>选择 ›</text>
            </view>
          </picker>
          <text v-else class="point-picker-value placeholder" @click="openPointSettings">请先设置点位 ›</text>
        </view>
        <view v-for="template in activeTemplates" :key="template.id" class="template-option"
          :class="{ selected: templateSelected(employee.id, template.id), conflict: hasTimeConflict(employee.id, template) && !templateSelected(employee.id, template.id) }"
          @click="toggleTemplate(employee.id, template)">
          <view class="option-check">{{ templateSelected(employee.id, template.id) ? '✓' : '' }}</view>
          <view class="option-copy" style="flex:1;min-width:0"><view class="option-title-row"><text class="option-name">{{ template.name }}</text><text class="option-duration">{{ durationLabel(templateWorkMinutes(template)) }}</text></view><text class="option-time">{{ template.startTime }}–{{ template.endTime }}</text>
            <TimeRangeEditor :start="template.startTime" :end="template.endTime" read-only compact /></view>
          <text v-if="hasTimeConflict(employee.id, template) && !templateSelected(employee.id, template.id)" class="conflict-label">时间冲突</text>
        </view>
      </view>
    </view>
    <view v-if="employees.length" class="batch-bar card">
      <view><text class="batch-count">已选择 {{ assignments.length }} 个班次</text><text class="batch-caption">{{ date }} · {{ selectedEmployeeIds.length }} 名员工</text></view>
      <button class="button create-button" :disabled="saving || !assignments.length" @click="createBatch">保存全部草稿</button>
    </view>
    <view class="section-heading list-heading"><view><text class="section-title">当日排班</text>
      <text class="section-subtitle">{{ shifts.length }} 个班次草稿与已发布记录</text></view>
      <text v-if="publishedShifts.length" class="poster-link" @click="openSchedulePoster">生成汇总图片 ›</text></view>
    <view v-if="draftShifts.length" class="card publish-bar"><view><text class="publish-title">{{ draftShifts.length }} 个草稿待发布</text>
      <text class="publish-caption">核对以下班次后，一次性发布给所有员工</text></view>
      <button class="button publish-button" :disabled="saving" @click="publishAll">统一发布</button></view>
    <view v-for="group in groupedShifts" :key="group.employeeId" class="card employee-schedule-card">
      <view class="employee-schedule-head">
        <text class="employee-name">{{ group.employeeName }}</text>
        <text class="point-label">{{ group.pointName }}</text>
        <text class="employee-shift-count">{{ group.shifts.length }} 个班次</text>
      </view>
    <view v-for="(shift, index) in group.shifts" :key="shift.id" class="schedule-item">
        <view class="shift-top"><view><text class="shift-name">班次 {{ index + 1 }} · {{ shift.shiftTemplateName || '班次记录' }}</text></view>
          <text class="status-pill" :class="{ ok: shift.status === 'PUBLISHED' }">{{ shift.status === 'DRAFT' ? '待发布' : hrStatusLabel(shift.status) }}</text></view>
        <view class="shift-time">{{ clock(shift.plannedStart) }} <text>至</text> {{ clock(shift.plannedEnd) }}</view>
        <text class="shift-meta">本班工时 {{ durationLabel(shiftWorkMinutes(shift)) }} · 休息 {{ shift.breakMinutes }} 分钟<template v-if="notificationsEnabled"> · 通知 {{ hrStatusLabel(shift.deliveryStatus || 'QUEUED') }} {{ hrFailureLabel(shift.deliveryReasonCode) }}</template></text>
        <view v-if="shift.status === 'DRAFT' || shift.status === 'PUBLISHED'" class="draft-actions">
          <view v-if="editingScheduleId !== shift.id" class="draft-button-row">
            <button class="small-button" :disabled="saving" @click="beginEdit(shift)">{{ shift.status === 'PUBLISHED' ? '调整' : '修改' }}</button>
            <button class="small-button delete-button" :disabled="saving" @click="confirmDeleteShift(shift)">删除</button>
          </view>
          <view v-else class="draft-editor">
            <text class="editor-title">{{ shift.status === 'PUBLISHED' ? '调整班次时间，保存后需重新发布' : '选择新班次' }}</text>
            <view class="template-options">
              <view v-for="template in activeTemplates" :key="template.id" class="template-option"
                :class="{ selected: editingTemplateId === template.id, conflict: scheduleHasTimeConflict(shift, template) }"
                @click="selectEditTemplate(shift, template)">
                <view class="option-check">{{ editingTemplateId === template.id ? '✓' : '' }}</view>
                <view class="option-copy" style="flex:1;min-width:0"><view class="option-title-row"><text class="option-name">{{ template.name }}</text><text class="option-duration">{{ durationLabel(templateWorkMinutes(template)) }}</text></view><text class="option-time">{{ template.startTime }}–{{ template.endTime }}</text>
                  <TimeRangeEditor :start="template.startTime" :end="template.endTime" read-only compact /></view>
                <text v-if="scheduleHasTimeConflict(shift, template)" class="conflict-label">时间冲突</text>
              </view>
            </view>
            <view class="editor-actions">
              <button class="small-button cancel-button" :disabled="saving" @click="cancelEdit">取消</button>
              <button class="small-button save-button" :disabled="saving" @click="saveEdit(shift)">{{ shift.status === 'PUBLISHED' ? '保存调整' : '保存修改' }}</button>
            </view>
          </view>
        </view>
        <view v-if="notificationsEnabled && canRetry(shift)" class="retry-row"><text>员工尚未收到通知，可在授权后重试。</text>
          <button class="small-button" :disabled="saving" @click="retry(shift)">重试通知</button></view>
      </view>
    </view>
    <view v-if="!loading && !shifts.length" class="card empty">所选日期还没有排班</view>
  </view>
</template>

<style scoped>
.schedule-page{padding:22rpx 0 70rpx}.page-hero{position:relative;overflow:hidden;padding:30rpx;border:1rpx solid #f4e3d9;border-radius:28rpx;background:linear-gradient(135deg,#fff8f2,#fbe8db)}.eyebrow{color:#c96a35;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.hero-title{display:block;margin-top:5rpx;color:#26344b;font-size:42rpx;font-weight:750}.hero-caption{display:block;margin-top:8rpx;color:#876855;font-size:22rpx;line-height:1.5}.hero-date{display:flex;align-items:center;gap:14rpx;margin-top:22rpx;padding-top:16rpx;border-top:1rpx solid rgba(211,131,88,.2);color:#3c4659;font-size:25rpx;font-weight:650}.date-label{color:#927966;font-size:21rpx;font-weight:400}.date-edit{margin-left:auto;color:#d55b25;font-size:21rpx;font-weight:500}.notice,.empty{margin-top:16rpx;padding:22rpx;border-radius:20rpx;background:#fff;color:#8a5135;font-size:23rpx;line-height:1.5}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:12rpx;margin:28rpx 4rpx 14rpx}.section-title{display:block;color:#26344b;font-size:28rpx;font-weight:700}.section-subtitle{display:block;margin-top:5rpx;color:#8995a7;font-size:21rpx}.settings-link{flex:none;color:#d55b25;font-size:22rpx}.outline-button{height:64rpx;margin-top:16rpx;padding:0 20rpx;border:1rpx solid #f1c5ad;border-radius:14rpx;background:#fff8f2;color:#d55b25;font-size:22rpx}.employee-card{margin-bottom:12rpx;padding:18rpx}.employee-card.chosen{border-color:#f0b596;box-shadow:0 8rpx 24rpx rgba(213,91,37,.08)}.employee-head{display:flex;align-items:center;gap:14rpx}.checkmark,.option-check{display:grid;place-items:center;width:38rpx;height:38rpx;border:2rpx solid #d5dce6;border-radius:50%;color:#fff;font-size:22rpx}.checkmark.checked,.selected .option-check{border-color:#e65b1f;background:#e65b1f}.employee-copy{flex:1;display:flex;justify-content:space-between;align-items:center;gap:10rpx}.employee-name{color:#26344b;font-size:26rpx;font-weight:700}.employee-count{color:#8b96a7;font-size:20rpx}.template-options{display:grid;grid-template-columns:1fr 1fr;gap:10rpx;margin-top:16rpx;padding-top:15rpx;border-top:1rpx solid #edf0f4}.template-option{display:flex;align-items:center;gap:9rpx;min-height:76rpx;padding:10rpx;border:1rpx solid #e7ebf1;border-radius:14rpx;background:#fbfcfe}.template-option.selected{border-color:#ed8d61;background:#fff6f0}.template-option.conflict{opacity:.45}.option-check{width:30rpx;height:30rpx;flex:none;font-size:18rpx}.option-name,.option-time{display:block}.option-name{color:#2d3a4f;font-size:21rpx;font-weight:650}.option-time{margin-top:3rpx;color:#8b96a7;font-size:18rpx}.conflict-label{margin-left:auto;color:#b45b31;font-size:17rpx;white-space:nowrap}.batch-bar,.publish-bar{position:sticky;bottom:18rpx;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12rpx;margin-top:16rpx;padding:17rpx;border:1rpx solid #f0e1d8;box-shadow:0 12rpx 28rpx rgba(32,45,66,.1)}.batch-count,.publish-title{display:block;color:#26344b;font-size:22rpx;font-weight:700}.batch-caption,.publish-caption{display:block;margin-top:4rpx;color:#8995a7;font-size:18rpx}.button{flex:none;min-height:68rpx;padding:0 18rpx;border:0;border-radius:14rpx;background:#e85d21;color:#fff;font-size:21rpx}.button[disabled]{opacity:.45}.list-heading{margin-top:34rpx}.shift-card{margin-bottom:12rpx;padding:20rpx}.shift-top{display:flex;align-items:center;justify-content:space-between}.shift-name{display:block;margin-top:4rpx;color:#8995a7;font-size:20rpx}.status-pill{padding:6rpx 12rpx;border-radius:999rpx;background:#fff4e8;color:#b45b31;font-size:18rpx}.status-pill.ok{background:#e9f7f0;color:#19764d}.shift-time{margin-top:14rpx;color:#d9561e;font-size:32rpx;font-weight:750}.shift-time text{padding:0 8rpx;color:#a9b1bd;font-size:20rpx;font-weight:400}.shift-meta{display:block;margin-top:6rpx;color:#8490a5;font-size:19rpx}.retry-row{display:flex;align-items:center;justify-content:space-between;gap:10rpx;margin-top:10rpx;color:#8a95a6;font-size:19rpx}.small-button{flex:none;min-height:58rpx;padding:0 17rpx;border:0;border-radius:12rpx;background:#fff0e7;color:#d9561e;font-size:20rpx}
.employee-schedule-card{margin-bottom:14rpx;padding:20rpx}.employee-schedule-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:12rpx}.employee-shift-count{color:#8995a7;font-size:20rpx}.schedule-item{padding:14rpx 0;border-top:1rpx solid #edf0f4}.draft-actions{margin-top:12rpx}.draft-button-row{display:flex;justify-content:flex-end;gap:10rpx}.delete-button{background:#fff0ef;color:#bb4038}.draft-editor{padding:14rpx;border:1rpx solid #f0e1d8;border-radius:14rpx;background:#fffaf6}.editor-title{color:#46536a;font-size:21rpx;font-weight:650}.editor-actions{display:flex;justify-content:flex-end;gap:10rpx;margin-top:12rpx}.cancel-button{background:#f1f3f6;color:#657187}.save-button{background:#e85d21;color:#fff}
.settings-actions{display:flex;align-items:center;gap:18rpx}.point-selector{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:14rpx;padding:14rpx 16rpx;border:1rpx solid #f0ded2;border-radius:14rpx;background:#fffaf6}.point-selector-label{color:#6d7789;font-size:21rpx}.point-picker-value{display:flex;align-items:center;gap:12rpx;color:#cf571f;font-size:22rpx;font-weight:650}.point-picker-value text{color:#929aaa;font-size:19rpx;font-weight:400}.point-picker-value.placeholder{color:#9aa3b2;font-weight:400}.point-label{max-width:180rpx;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5rpx 10rpx;border-radius:999rpx;background:#eef5ff;color:#42628e;font-size:19rpx}
</style>

<style scoped>
.option-title-row{display:flex;align-items:center;justify-content:space-between;gap:6rpx;min-width:0}
.option-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.option-duration{flex:none;padding:2rpx 7rpx;border-radius:999rpx;background:#fff0e7;color:#cb4e19;font-size:17rpx;font-weight:650;white-space:nowrap}
</style>
