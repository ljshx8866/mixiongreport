<script setup lang="ts">
import { computed, ref } from 'vue'
import { businessDate } from '../../utils/session'

type CalendarDay = { date: string; day: number; currentMonth: boolean; disabled: boolean } | null
const today = businessDate()
const selectedDate = ref(today)
const currentMonth = ref(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1))
const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const monthTitle = computed(() => `${currentMonth.value.getFullYear()}年${currentMonth.value.getMonth() + 1}月`)
const calendarDays = computed<CalendarDay[]>(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const totalDays = new Date(year, month + 1, 0).getDate()
  const result: CalendarDay[] = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= totalDays; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    result.push({ date, day, currentMonth: true, disabled: date > today })
  }
  while (result.length % 7) result.push(null)
  return result
})
function changeMonth(offset: number) {
  const next = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + offset, 1)
  const current = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1)
  if (next > current) return
  currentMonth.value = next
}
function selectDate(day: CalendarDay) {
  if (!day || day.disabled) return
  selectedDate.value = day.date
}
function openReport() {
  uni.navigateTo({ url: `/pages/report/index?date=${selectedDate.value}` })
}
</script>

<template>
  <view class="page history-page">
    <view class="history-head"><text class="eyebrow">历史日报</text><text class="title">历史经营日报</text><text class="desc">选择营业日期，查看门店完整经营数据</text></view>
    <view class="calendar-card">
      <view class="calendar-toolbar"><view class="month-control" @click="changeMonth(-1)"><text>‹</text></view><text class="month-title">{{ monthTitle }}</text><view class="month-control" :class="{ disabled: currentMonth.getFullYear() === Number(today.slice(0, 4)) && currentMonth.getMonth() === Number(today.slice(5, 7)) - 1 }" @click="changeMonth(1)"><text>›</text></view></view>
      <view class="week-row"><text v-for="week in weekdays" :key="week">{{ week }}</text></view>
      <view class="calendar-grid"><view v-for="(day, index) in calendarDays" :key="day?.date ?? `blank-${index}`" class="calendar-day" :class="{ blank: !day, selected: day?.date === selectedDate, today: day?.date === today, disabled: day?.disabled }" @click="selectDate(day)"><text v-if="day">{{ day.day }}</text></view></view>
    </view>
    <view class="selected-card"><view><text class="selected-label">已选择营业日期</text><text class="selected-date">{{ selectedDate }}</text></view><view class="button" @click="openReport">查看日报</view></view>
    <view class="tip"><text>说明</text><text>只能选择今天及之前的日期。日报数据未同步或未完成时，详情页会提示当前状态。</text></view>
  </view>
</template>

<style scoped>
.history-page{padding-top:30rpx}.history-head{padding:0 8rpx 28rpx}.title{display:block;margin-top:5rpx;color:#172033;font-size:42rpx;font-weight:700}.desc{display:block;margin-top:6rpx;color:#8490a5;font-size:24rpx}.calendar-card{padding:24rpx;border:1rpx solid #edf0f5;border-radius:24rpx;background:#fff;box-shadow:0 10rpx 30rpx rgba(33,48,76,.055)}.calendar-toolbar{display:flex;align-items:center;justify-content:space-between;padding:0 2rpx 20rpx;border-bottom:1rpx solid #eef1f5}.month-title{color:#172033;font-size:31rpx;font-weight:700}.month-control{display:flex;align-items:center;justify-content:center;width:58rpx;height:58rpx;border-radius:16rpx;background:#fff1e9;color:#e75311;font-size:42rpx;line-height:1}.month-control.disabled{opacity:.35}.week-row,.calendar-grid{display:grid;grid-template-columns:repeat(7,1fr)}.week-row{margin-top:20rpx}.week-row text{text-align:center;color:#98a2b3;font-size:22rpx}.week-row text:first-child,.week-row text:last-child{color:#e77852}.calendar-day{display:flex;align-items:center;justify-content:center;height:76rpx;margin-top:8rpx}.calendar-day text{display:flex;align-items:center;justify-content:center;width:58rpx;height:58rpx;border-radius:50%;color:#26344d;font-size:26rpx}.calendar-day.today text{color:#e75311;font-weight:700}.calendar-day.selected text{background:#f15b16;color:#fff;font-weight:700;box-shadow:0 8rpx 16rpx rgba(241,91,22,.24)}.calendar-day.disabled text{color:#c9d0db}.calendar-day.blank{pointer-events:none}.selected-card{display:flex;align-items:center;justify-content:space-between;margin-top:20rpx;padding:24rpx 26rpx;border-radius:20rpx;background:#172b46;color:#fff}.selected-label{display:block;color:#b7c6d9;font-size:21rpx}.selected-date{display:block;margin-top:4rpx;font-size:31rpx;font-weight:700}.selected-card .button{min-height:70rpx;padding:0 22rpx;border-radius:14rpx;font-size:24rpx;box-shadow:none}.tip{display:flex;gap:12rpx;margin-top:20rpx;padding:18rpx 20rpx;border-radius:16rpx;background:#fff7ee;color:#8c552e;font-size:22rpx;line-height:1.65}.tip text:first-child{flex:0 0 auto;color:#d85a1b;font-weight:700}
</style>
