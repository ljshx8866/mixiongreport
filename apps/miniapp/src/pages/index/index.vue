<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { request } from '../../utils/api'
import { businessDate, currentStoreId, errorMessage } from '../../utils/session'
import { ensureWechatLogin } from '../../utils/wechat'

const report = ref<any>(null)
const message = ref('')
const date = businessDate()
onShow(async () => {
  try { await ensureWechatLogin() } catch (error) { message.value = errorMessage(error); return }
  const storeId = currentStoreId()
  if (!storeId) { message.value = '请先在“我的”页面登录并选择门店'; return }
  try { report.value = await request(`/api/reports/daily?storeId=${storeId}&date=${date}`); message.value = '' }
  catch (error) { message.value = errorMessage(error) }
})
const go = (path: string) => uni.navigateTo({ url: path })
</script>

<template>
  <view class="card">
    <text class="label">{{ report?.store?.name || '米熊门店' }} · {{ date }}</text>
    <text class="value">¥{{ report?.sales?.total?.amount ?? '—' }}</text>
    <text class="label">入客 {{ report?.sales?.total?.customers ?? '—' }}</text>
  </view>
  <view v-if="message" class="card"><text>{{ message }}</text><view class="button" @click="uni.switchTab({ url: '/pages/profile/index' })">前往我的</view></view>
  <view v-if="report" class="card">
    <text class="label">门店填报</text>
    <text class="value">{{ report.status?.manualInputReady ? '已提交' : '待提交' }}</text>
    <view class="button" @click="go('/pages/input/index')">填写今日数据</view>
  </view>
  <view v-if="report" class="card button" @click="go(`/pages/report/index?date=${date}`)">查看今日经营日报</view>
</template>
