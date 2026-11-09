<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type TrialEmployee = { id: number; name: string; trialStartedAt: string | null }
const storeId = ref(0)
const name = ref('')
const startDate = ref(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
const trials = ref<TrialEmployee[]>([])
const canConvert = ref(false)
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const validForm = computed(() => Boolean(storeId.value && name.value.trim() && startDate.value))

onLoad((options) => { storeId.value = Number(options?.storeId || 0) })
onShow(() => { if (storeId.value) void load() })

async function load() {
  if (!storeId.value) return
  loading.value = true; message.value = ''
  try {
    const [items, access] = await Promise.all([
      request<TrialEmployee[]>(`/api/hr/employees/trials?storeId=${storeId.value}`),
      request<{ stores?: Array<{ id: number; permissionCodes?: string[] }> }>('/api/hr/current-access'),
    ])
    trials.value = items
    const permissions = access.stores?.find((store) => store.id === storeId.value)?.permissionCodes ?? []
    canConvert.value = permissions.includes('HR_ONBOARDING_CREATE') && permissions.includes('HR_ONBOARDING_VERIFY')
  }
  catch (error) { message.value = errorMessage(error); trials.value = []; canConvert.value = false }
  finally { loading.value = false }
}
function convertToOnboarding(item: TrialEmployee) {
  uni.navigateTo({ url: `/pages/hr/onboarding?storeId=${storeId.value}&trialEmployeeId=${item.id}` })
}
async function createTrial() {
  if (!validForm.value) { message.value = '请填写姓名和试岗开始时间'; return }
  saving.value = true; message.value = ''
  try {
    await request('/api/hr/employees/trials', 'POST', {
      storeId: storeId.value, name: name.value.trim(), trialStartedAt: startDate.value,
    })
    name.value = ''; await load(); message.value = '试岗人员已录入，可在排班时选择。'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
function endTrial(item: TrialEmployee) {
  uni.showModal({ title: '结束试岗', content: `确定结束 ${item.name} 的试岗吗？档案、排班、工时和操作记录会保留在后台试岗历史中。`,
    confirmText: '结束试岗', confirmColor: '#b64835', success: async (result) => {
      if (!result.confirm) return
      saving.value = true; message.value = ''
      try {
        await request(`/api/hr/employees/${item.id}/trial`, 'DELETE')
        await load(); message.value = '试岗已结束，档案和相关记录已保留在后台历史中。'
      } catch (error) { message.value = errorMessage(error) }
      finally { saving.value = false }
    },
  })
}
</script>

<template>
  <view class="page detail-page trials-page">
    <PageLoading v-if="loading" text="正在读取试岗人员" />
    <view class="page-heading">
      <view class="store-context-heading"><view class="store-context-title"><text class="eyebrow">人事管理</text><text class="title">试岗管理</text></view>
        <StoreSelector v-model="storeId" source="hr" permission="HR_TRIAL_MANAGE" @ready="load" @change="load" />
      </view>
      <text class="subtitle">试岗可排班和确认工时，暂不计工资；结束或转入职后，档案和相关记录仍保留在后台。</text>
    </view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view class="card editor">
      <text class="section-title">录入试岗人员</text>
      <view class="field"><text>姓名</text><input v-model="name" maxlength="100" placeholder="请输入姓名" /></view>
      <picker mode="date" :value="startDate" @change="(event) => startDate = String(event.detail.value)">
        <view class="field date-field">试岗开始时间<text>{{ startDate || '请选择日期' }}　›</text></view>
      </picker>
      <button class="button" :disabled="saving || !validForm" @click="createTrial">{{ saving ? '正在保存…' : '录入试岗' }}</button>
    </view>
    <view class="section-heading"><text>当前试岗人员</text><text class="count">{{ trials.length }} 人</text></view>
    <view v-if="!loading && !trials.length" class="card empty">当前门店暂无试岗人员</view>
    <view v-for="item in trials" :key="item.id" class="card trial-row">
      <view class="trial-avatar">{{ item.name.slice(0, 1) }}</view>
      <view class="trial-info"><text class="trial-name">{{ item.name }}</text><text class="trial-date">试岗开始：{{ item.trialStartedAt || '未记录' }}</text></view>
      <button v-if="canConvert" class="end-button" :disabled="saving" @click="convertToOnboarding(item)">转入职</button>
      <button class="end-button" :disabled="saving" @click="endTrial(item)">结束试岗</button>
    </view>
    <view class="note">结束试岗后，人员会从当前名单移入后台历史记录；排班、工时、操作记录及已生成经营日报均保留。</view>
  </view>
</template>

<style scoped>
.trials-page{padding:24rpx 0 70rpx}.page-heading{padding:4rpx 6rpx 20rpx}.eyebrow{display:block;color:#d57543;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.title{display:block;margin-top:6rpx;color:#172033;font-size:40rpx;font-weight:750}.subtitle{display:block;margin-top:8rpx;color:#8490a5;font-size:22rpx;line-height:1.5}.editor{padding:22rpx}.section-title{display:block;margin-bottom:14rpx;color:#27374e;font-size:27rpx;font-weight:700}.field{display:grid;gap:9rpx;margin:14rpx 0;color:#748197;font-size:21rpx}.field input,.date-field{box-sizing:border-box;min-height:74rpx;padding:20rpx;border:1rpx solid #e4e9f0;border-radius:14rpx;background:#fafbfd;color:#26364c;font-size:24rpx}.date-field{display:flex;align-items:center;justify-content:space-between}.date-field text{color:#d25a24}.button{height:76rpx;margin-top:18rpx;border:0;border-radius:15rpx;background:#e85d21;color:#fff;font-size:25rpx;font-weight:700;line-height:76rpx}.button::after{border:0}.button[disabled]{opacity:.55}.notice{margin-bottom:14rpx;color:#9b532e}.section-heading{display:flex;justify-content:space-between;margin:26rpx 4rpx 12rpx;color:#26364c;font-size:27rpx;font-weight:700}.count{color:#8994a5;font-size:21rpx;font-weight:400}.empty{padding:24rpx;color:#8c97a7;text-align:center}.trial-row{display:flex;align-items:center;gap:14rpx;margin-bottom:12rpx;padding:18rpx}.trial-avatar{display:grid;place-items:center;width:64rpx;height:64rpx;border-radius:21rpx;background:#fff0e7;color:#d45a22;font-size:26rpx;font-weight:700}.trial-info{flex:1;min-width:0}.trial-name,.trial-date{display:block}.trial-name{color:#27364e;font-size:25rpx;font-weight:700}.trial-date{margin-top:5rpx;color:#8994a5;font-size:19rpx}.end-button{flex:none;height:58rpx;margin:0;padding:0 16rpx;border:1rpx solid #f0d6d0;border-radius:12rpx;background:#fff6f3;color:#ad4b3c;font-size:20rpx;line-height:58rpx}.end-button::after{border:0}.note{padding:16rpx 8rpx;color:#909bab;font-size:19rpx;line-height:1.55}
</style>
