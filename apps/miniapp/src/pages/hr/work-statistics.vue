<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type PayStatus = 'CALCULATED' | 'WAITING_FOR_CONFIRMATION' | 'MISSING_RATE' | 'TRIAL_NOT_PAYABLE'
type EmployeeOption = { id: number; name: string }
type WorkDay = { date: string; scheduledMinutes: number; statisticalMinutes: number; confirmedShifts: number;
  basePayAmount: string | null; payStatus: PayStatus }
type WorkRow = { employeeId: number; employeeName: string; isTrial: boolean; scheduledMinutes: number; statisticalMinutes: number;
  scheduledDays: number; confirmedDays: number; basePayAmount: string | null; payStatus: PayStatus; days?: WorkDay[] }
type Statistics = { employees: EmployeeOption[]; totals: { employeeCount: number; scheduledMinutes: number;
  statisticalMinutes: number; totalBasePayAmount: string | null; payStatus: PayStatus }; rows: WorkRow[] }

const storeId = ref(0)
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const startDate = ref(today.slice(0, 7) + '-01')
const endDate = ref(today)
const selectedEmployeeId = ref<number | null>(null)
const employees = ref<EmployeeOption[]>([])
const result = ref<Statistics | null>(null)
const loading = ref(false)
const message = ref('')
const employeeNames = computed(() => ['全部员工', ...employees.value.map((item) => item.name)])
const selectedEmployeeName = computed(() => selectedEmployeeId.value == null
  ? '全部员工' : employees.value.find((item) => item.id === selectedEmployeeId.value)?.name ?? '选择员工')
const selectedRow = computed(() => result.value?.rows.find((item) => item.employeeId === selectedEmployeeId.value) ?? null)
const hours = (minutes: number) => (minutes / 60).toFixed(2)

function wageText(amount: string | null, status: PayStatus) {
  if (status === 'CALCULATED' && amount != null) return '￥' + amount
  if (status === 'TRIAL_NOT_PAYABLE') return '试岗期间不计薪'
  return status === 'WAITING_FOR_CONFIRMATION' ? '待确认工时' : '待核时薪'
}

onLoad((options) => { storeId.value = Number(options?.storeId || 0) })
onShow(() => { if (storeId.value) void load() })

async function load() {
  if (!storeId.value) { message.value = '未获取到门店信息，请从人事工作台重新进入'; return }
  if (startDate.value > endDate.value) { message.value = '开始日期不能晚于结束日期'; return }
  loading.value = true
  message.value = ''
  try {
    const employeeQuery = selectedEmployeeId.value == null
      ? '' : '&employeeId=' + encodeURIComponent(String(selectedEmployeeId.value))
    const query = 'storeId=' + encodeURIComponent(String(storeId.value)) +
      '&startDate=' + encodeURIComponent(startDate.value) + '&endDate=' + encodeURIComponent(endDate.value) + employeeQuery
    result.value = await request<Statistics>('/api/hr/timesheets/statistics?' + query)
    employees.value = result.value.employees ?? []
    if (selectedEmployeeId.value != null && !employees.value.some((item) => item.id === selectedEmployeeId.value)) {
      selectedEmployeeId.value = null
      await load()
    }
  } catch (error) {
    result.value = null
    message.value = errorMessage(error)
  } finally { loading.value = false }
}

function chooseStart(event: { detail: { value: string } }) { startDate.value = String(event.detail.value) }
function chooseEnd(event: { detail: { value: string } }) { endDate.value = String(event.detail.value) }
function chooseEmployee(event: { detail: { value: string } }) {
  const index = Number(event.detail.value)
  selectedEmployeeId.value = index === 0 ? null : employees.value[index - 1]?.id ?? null
}
</script>

<template>
  <view class="page statistics-page">
    <PageLoading v-if="loading" text="正在统计门店工时" />
    <view class="page-heading">
      <view class="store-context-heading"><view class="store-context-title"><text class="eyebrow">门店工时</text>
      <text class="title">工时统计</text></view>
      <StoreSelector v-model="storeId" source="hr" permission="HR_WORK_STATISTICS_READ" @ready="load" @change="load" /></view>
      <text class="subtitle">按员工和日期范围查看排班工时、统计工时及已确认工时工资。</text>
    </view>
    <view class="card filters">
      <text class="filter-title">筛选条件</text>
      <view class="filter-grid">
        <view class="filter-field">
          <text class="field-label">开始日期</text>
          <picker mode="date" :value="startDate" :end="endDate" @change="chooseStart">
            <view class="picker-value"><text class="calendar-icon">日</text>{{ startDate }}<text class="picker-arrow">›</text></view>
          </picker>
        </view>
        <view class="filter-field">
          <text class="field-label">结束日期</text>
          <picker mode="date" :value="endDate" :start="startDate" :end="today" @change="chooseEnd">
            <view class="picker-value"><text class="calendar-icon">日</text>{{ endDate }}<text class="picker-arrow">›</text></view>
          </picker>
        </view>
        <view class="filter-field employee-field">
          <text class="field-label">员工</text>
          <picker mode="selector" :range="employeeNames" @change="chooseEmployee">
            <view class="picker-value"><text class="people-icon">人</text>{{ selectedEmployeeName }}<text class="picker-arrow">›</text></view>
          </picker>
        </view>
      </view>
      <button class="search-button" :disabled="loading" @click="load">查询统计</button>
    </view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <template v-if="result">
      <view class="summary-grid">
        <view class="card summary-card people-summary"><text class="summary-label">有工时员工</text>
          <text class="summary-value">{{ result.totals.employeeCount }}<small>人</small></text></view>
        <view class="card summary-card"><text class="summary-label">排班工时</text>
          <text class="summary-value">{{ hours(result.totals.scheduledMinutes) }}<small>小时</small></text></view>
        <view class="card summary-card"><text class="summary-label">统计工时</text>
          <text class="summary-value accent">{{ hours(result.totals.statisticalMinutes) }}<small>小时</small></text></view>
        <view class="card summary-card wage-summary"><text class="summary-label">已确认工时工资</text>
          <text class="summary-value wage-value">{{ wageText(result.totals.totalBasePayAmount, result.totals.payStatus) }}</text></view>
      </view>
      <view class="list-heading"><text>员工工时</text><text class="range-label">{{ startDate }} 至 {{ endDate }}</text></view>
      <view v-for="row in result.rows" :key="row.employeeId" class="card employee-card">
        <view class="employee-heading">
          <view class="avatar">{{ row.employeeName.slice(0, 1) }}</view>
          <view class="employee-copy"><text class="employee-name">{{ row.employeeName }}</text>
            <text class="employee-meta">{{ row.isTrial ? '试岗中 · ' : '' }}{{ row.scheduledDays }} 个排班日 · {{ row.confirmedDays }} 个已确认工时日</text></view>
        </view>
        <view class="employee-hours">
          <view class="hour-cell"><text>排班工时</text><strong>{{ hours(row.scheduledMinutes) }}<small>小时</small></strong></view>
          <view class="hour-cell actual"><text>统计工时</text><strong>{{ hours(row.statisticalMinutes) }}<small>小时</small></strong></view>
          <view class="hour-cell wage-cell"><text>已确认工时工资</text><strong>{{ wageText(row.basePayAmount, row.payStatus) }}</strong></view>
        </view>
      </view>
      <template v-if="selectedRow">
        <view class="list-heading detail-heading"><text>{{ selectedRow.employeeName }}每日明细</text></view>
        <view v-for="day in selectedRow.days || []" :key="day.date" class="card day-card">
          <text class="day-date">{{ day.date }}</text>
          <view class="day-hours">
            <text>排班 {{ hours(day.scheduledMinutes) }} 小时</text>
            <text>统计 {{ hours(day.statisticalMinutes) }} 小时</text>
            <text class="day-wage">工时工资 {{ wageText(day.basePayAmount, day.payStatus) }}</text>
          </view>
        </view>
      </template>
      <view v-if="!result.rows.length" class="card empty-state">所选条件下没有工时记录</view>
      <view class="footnote">统计工时按每个班次不足30分钟不计、达到30分钟按半小时递增计算。工资仅按已确认统计工时和当日有效时薪计算，并按天四舍五入到分。</view>
    </template>
  </view>
</template>

<style scoped>
.statistics-page{padding-top:24rpx;padding-bottom:64rpx}.page-heading{padding:4rpx 6rpx 24rpx}.eyebrow{display:block;color:#df753f;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.title{display:block;margin-top:6rpx;color:#172033;font-size:40rpx;font-weight:750}.subtitle{display:block;margin-top:8rpx;color:#8490a5;font-size:23rpx;line-height:1.45}
.filters{padding:22rpx}.filter-title{display:block;margin-bottom:16rpx;color:#26344b;font-size:26rpx;font-weight:700}.filter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14rpx}.filter-field{min-width:0}.employee-field{grid-column:1/-1}.field-label{display:block;margin-bottom:8rpx;color:#8793a5;font-size:20rpx}.picker-value{display:flex;align-items:center;gap:8rpx;min-width:0;height:72rpx;padding:0 14rpx;border:1rpx solid #e5eaf0;border-radius:14rpx;background:#fafbfd;color:#28364d;font-size:22rpx}.calendar-icon,.people-icon{color:#df6a32;font-size:21rpx}.picker-arrow{margin-left:auto;color:#99a4b3}.search-button{height:74rpx;margin:18rpx 0 0;border:0;border-radius:14rpx;background:#ed6427;color:#fff;font-size:25rpx;font-weight:700;line-height:74rpx}.search-button::after{border:0}.search-button[disabled]{opacity:.6}.notice{margin-top:16rpx;color:#b45309;background:#fff8ed}
.summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10rpx;margin-top:18rpx}.summary-card{min-width:0;padding:17rpx 14rpx}.summary-label{display:block;color:#8995a6;font-size:19rpx;white-space:nowrap}.summary-value{display:block;margin-top:8rpx;color:#1e3049;font-size:29rpx;font-weight:750;white-space:nowrap}.summary-value small,.hour-cell small{margin-left:4rpx;font-size:18rpx;font-weight:500}.summary-value.accent,.wage-value{color:#df642a}.wage-value{font-size:25rpx}
.list-heading{display:flex;align-items:center;justify-content:space-between;gap:10rpx;margin:26rpx 4rpx 12rpx;color:#1a2b45;font-size:27rpx;font-weight:750}.range-label{color:#8b97a8;font-size:19rpx;font-weight:400}.employee-card{margin-bottom:12rpx;padding:20rpx}.employee-heading{display:flex;align-items:center;gap:14rpx}.avatar{width:66rpx;height:66rpx;display:flex;align-items:center;justify-content:center;flex:none;border-radius:22rpx;background:#fff0e7;color:#d86027;font-size:29rpx;font-weight:750}.employee-copy{min-width:0}.employee-name{display:block;color:#25344b;font-size:26rpx;font-weight:700}.employee-meta{display:block;margin-top:5rpx;color:#95a0af;font-size:19rpx}.employee-hours{display:grid;grid-template-columns:1fr 1fr;gap:12rpx;margin-top:17rpx}.hour-cell{padding:13rpx;border-radius:13rpx;background:#f6f8fb}.hour-cell text{display:block;color:#8490a2;font-size:19rpx}.hour-cell strong{display:block;margin-top:5rpx;color:#263750;font-size:27rpx}.hour-cell.actual{background:#fff4ec}.hour-cell.actual strong{color:#dc5d22}.wage-cell{grid-column:1/-1;background:#fff7f1}.wage-cell strong{color:#d85e25}.detail-heading{margin-top:24rpx}.day-card{display:flex;align-items:center;justify-content:space-between;gap:10rpx;margin-bottom:10rpx;padding:17rpx}.day-date{color:#25344b;font-size:23rpx;font-weight:650}.day-hours{display:flex;flex-direction:column;align-items:flex-end;gap:5rpx;color:#718096;font-size:20rpx}.day-wage{color:#d85e25;font-weight:650}.empty-state{text-align:center;color:#8490a5}.footnote{padding:16rpx 8rpx;color:#95a0af;font-size:19rpx;line-height:1.5}
</style>
