<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type ReminderTask = { id: number; storeId: number; date: string; status: string }
type StoreUser = { id: number; name: string }

const task = ref<ReminderTask | null>(null)
const users = ref<StoreUser[]>([])
const target = ref('')
const message = ref('')
const loading = ref(true)
const canProcess = ref(false)

onLoad(async (options) => {
  try {
    const tasks = await request<ReminderTask[]>('/api/reminders/mine')
    task.value = tasks.find((item) => String(item.id) === String(options?.taskId)) ?? tasks[0] ?? null
    if (task.value) {
      const access = await request<{ stores?: Array<{ id: number; permissionCodes: string[] }> }>('/api/hr/current-access')
      const permissions = access.stores?.find((store) => store.id === task.value?.storeId)?.permissionCodes ?? []
      canProcess.value = permissions.includes('HR_REMINDER_PROCESS')
      if (canProcess.value) users.value = await request<StoreUser[]>(`/api/reminders/${task.value.id}/users`)
    }
  } catch (error) {
    message.value = errorMessage(error)
  } finally {
    loading.value = false
  }
})

async function remindNext() {
  if (!task.value) return
  try {
    await request(`/api/reminders/${task.value.id}/next`, 'POST')
    message.value = '已提醒下一顺位人员'
    task.value = null
  } catch (error) {
    message.value = errorMessage(error)
  }
}

async function delegate() {
  if (!task.value || !target.value) {
    message.value = '请选择同门店人员'
    return
  }
  try {
    await request(`/api/reminders/${task.value.id}/delegate`, 'POST', { userId: Number(target.value) })
    message.value = '已发送指定提醒'
    task.value = null
  } catch (error) {
    message.value = errorMessage(error)
  }
}
</script>

<template>
  <view class="page">
    <view class="head"><text class="eyebrow">填报提醒</text><text class="title">日报提醒</text></view>
    <view v-if="loading" class="card">正在加载提醒任务…</view>
    <view v-else-if="task" class="card">
      <text class="section-title">今日门店日报待填</text>
      <text class="section-subtitle">你可以提醒下一顺位，或指定同门店人员接收提醒。</text>
      <view v-if="canProcess" class="button" @click="remindNext">顺位提醒</view>
      <view v-if="canProcess" class="field">
        <text>指定提醒人员</text>
        <picker mode="selector" :range="users" range-key="name" @change="target = String(users[Number($event.detail.value)].id)">
          <view class="picker">{{ users.find((user) => String(user.id) === target)?.name || '请选择同门店人员' }}</view>
        </picker>
      </view>
      <view v-if="canProcess" class="button secondary" @click="delegate">发送指定提醒</view>
      <text v-if="!canProcess" class="section-subtitle">你可以查看提醒，但没有处理权限</text>
    </view>
    <view v-else class="card"><text class="section-title">暂无待处理提醒</text><text class="section-subtitle">提醒可能已转交，或日报已经完成。</text></view>
    <text v-if="message" class="result">{{ message }}</text>
  </view>
</template>

<style scoped>
.head{padding:18rpx 6rpx 28rpx}.title{display:block;margin-top:5rpx;font-size:42rpx;font-weight:700}.card .button{margin-top:24rpx}.picker{padding:22rpx;border:1rpx solid #e4e9f1;border-radius:14rpx;background:#fafbfd}.result{display:block;margin-top:18rpx;color:#df591b;text-align:center}
</style>
