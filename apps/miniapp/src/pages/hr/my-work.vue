<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type PayStatus = 'CALCULATED' | 'WAITING_FOR_CONFIRMATION' | 'MISSING_RATE'
type Day = { date: string; scheduledMinutes: number; statisticalMinutes: number;
  confirmedShifts: number; basePayAmount: string | null; payStatus: PayStatus }
type Summary = { month: string; days: Day[]; totalScheduledMinutes: number; totalStatisticalMinutes: number;
  totalBasePayAmount: string | null; payStatus: PayStatus }

const month = ref(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7))
const summary = ref<Summary | null>(null)
const loading = ref(false)
const message = ref('')

async function load() {
  loading.value = true
  message.value = ''
  try { summary.value = await request<Summary>('/api/hr/employees/me/work?month=' + month.value) }
  catch (error) { summary.value = null; message.value = errorMessage(error) }
  finally { loading.value = false }
}

function changeMonth(event: { detail: { value: string } }) {
  month.value = String(event.detail.value).slice(0, 7)
  void load()
}

function wageText(amount: string | null, status: PayStatus) {
  if (status === 'CALCULATED' && amount != null) return '￥' + amount
  return status === 'WAITING_FOR_CONFIRMATION' ? '待确认工时' : '待核时薪'
}

onShow(load)
</script>

<template>
  <view class="page detail-page">
    <PageLoading v-if="loading" />
    <view class="heading">我的工时</view>
    <view class="description">查看本人排班、已确认工时和按时薪计算的工时工资。</view>
    <picker mode="date" fields="month" :value="month" @change="changeMonth">
      <view class="card picker">月份：{{ month }}　›</view>
    </picker>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view v-if="summary" class="card totals">
      <view><text>排班工时</text><strong>{{ (summary.totalScheduledMinutes / 60).toFixed(2) }} 小时</strong></view>
      <view><text>统计工时</text><strong>{{ (summary.totalStatisticalMinutes / 60).toFixed(2) }} 小时</strong></view>
      <view class="wage-total"><text>工时工资（已确认）</text><strong>{{ wageText(summary.totalBasePayAmount, summary.payStatus) }}</strong></view>
    </view>
    <view v-for="day in summary?.days || []" :key="day.date" class="card day">
      <view class="date">{{ day.date }}</view>
      <view class="values">
        <text>排班工时 {{ (day.scheduledMinutes / 60).toFixed(2) }} 小时</text>
        <text>统计工时 {{ (day.statisticalMinutes / 60).toFixed(2) }} 小时</text>
        <text class="wage-line">工时工资 {{ wageText(day.basePayAmount, day.payStatus) }}</text>
      </view>
    </view>
    <view v-if="!loading && summary && !summary.days.length" class="card empty">本月暂无排班或已确认工时</view>
    <view v-if="summary" class="footnote">工资按每日已确认的统计工时和当日有效时薪计算，按天四舍五入到分后汇总；待确认工时不会计入。</view>
  </view>
</template>

<style scoped>
.heading{font-size:38rpx;font-weight:700;color:#172033}.description{color:#8490a5;font-size:24rpx;margin:10rpx 0 22rpx}
.picker{color:#df591b;margin-bottom:18rpx}.notice{color:#b45309}.totals{display:grid;grid-template-columns:1fr 1fr;gap:20rpx;margin-bottom:18rpx}
.totals view{text-align:center}.totals text{display:block;color:#8490a5;font-size:22rpx}.totals strong{display:block;color:#172033;font-size:27rpx;margin-top:8rpx}.totals .wage-total{grid-column:1/-1;padding-top:16rpx;border-top:1rpx solid #edf0f4}.totals .wage-total strong{color:#df591b}
.day{margin-bottom:14rpx}.date{font-size:28rpx;font-weight:700;color:#172033}.values{display:flex;flex-wrap:wrap;gap:14rpx 18rpx;margin-top:12rpx;color:#64748b;font-size:24rpx}.wage-line{width:100%;color:#d85e25;font-weight:650}
.empty{color:#8490a5}.footnote{padding:8rpx 6rpx;color:#95a0af;font-size:20rpx;line-height:1.5}
</style>