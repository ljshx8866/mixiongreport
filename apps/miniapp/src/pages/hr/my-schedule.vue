<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { formatChinaClock } from '../../utils/china-time'
import { errorMessage } from '../../utils/session'

type Shift = { id: number; storeName: string; date: string; start: string;
  end: string; breakMinutes: number }
const shifts = ref<Shift[]>([])
const loading = ref(false)
const message = ref('')
const clock = (value: string) => formatChinaClock(value)
onShow(async () => {
  loading.value = true; message.value = ''
  try { shifts.value = await request<Shift[]>('/api/hr/employees/me/schedules') }
  catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
})
</script>

<template>
  <view class="page detail-page"><PageLoading v-if="loading" /><view class="heading">我的排班</view>
    <view class="description">未来两周已发布的班次</view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view v-for="shift in shifts" :key="shift.id" class="card shift">
      <view class="date">{{ shift.date }}</view><view class="store">{{ shift.storeName }}</view>
      <view class="time">{{ clock(shift.start) }} – {{ clock(shift.end) }}</view>
      <view class="break">休息 {{ shift.breakMinutes }} 分钟</view>
    </view>
    <view v-if="!loading && !message && !shifts.length" class="card empty">暂无已发布班次。若刚发布，请稍后刷新。</view>
  </view>
</template>

<style scoped>
.heading{font-size:38rpx;font-weight:700;color:#172033}.description{color:#8490a5;font-size:24rpx;margin:10rpx 0 28rpx}
.shift{margin-bottom:16rpx}.date{font-weight:700;color:#172033;font-size:28rpx}.store,.break{color:#8490a5;font-size:24rpx;margin-top:8rpx}
.time{font-size:34rpx;font-weight:700;color:#df591b;margin-top:14rpx}.notice{color:#b45309}.empty{color:#8490a5}
.subscribe{margin-bottom:20rpx}
</style>
