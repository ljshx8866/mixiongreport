<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type Profile = {
  name: string; phone: string | null; idNumber: string | null; sex: string | null
  ethnicity: string | null; birthDate: string | null; address: string | null
  bank: { bankName: string | null; branchName: string | null; cardNumber: string | null } | null
  status: string; storeName: string | null
}
const profile = ref<Profile | null>(null)
const loading = ref(false)
const message = ref('')
onShow(async () => {
  loading.value = true; message.value = ''
  try { profile.value = await request<Profile>('/api/hr/employees/me/profile') }
  catch (error) { profile.value = null; message.value = errorMessage(error) }
  finally { loading.value = false }
})
</script>

<template>
  <view class="page detail-page"><PageLoading v-if="loading" />
    <view class="heading">我的资料</view>
    <view class="description">仅本人可查看；银行账号按安全要求脱敏显示。</view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view v-if="profile" class="card profile">
      <view class="hero"><view class="avatar">{{ profile.name.slice(0, 1) }}</view>
        <view><text class="name">{{ profile.name }}</text><text class="sub">{{ profile.storeName || '员工' }} · 在职</text></view></view>
      <view class="section-title">个人信息</view>
      <view class="row"><text>手机号</text><text>{{ profile.phone || '—' }}</text></view>
      <view class="row"><text>身份证号</text><text>{{ profile.idNumber || '—' }}</text></view>
      <view class="row"><text>性别</text><text>{{ profile.sex || '—' }}</text></view>
      <view class="row"><text>民族</text><text>{{ profile.ethnicity || '—' }}</text></view>
      <view class="row"><text>出生日期</text><text>{{ profile.birthDate || '—' }}</text></view>
      <view class="row address"><text>住址</text><text>{{ profile.address || '—' }}</text></view>
      <view class="section-title bank-title">银行卡信息</view>
      <view v-if="profile.bank" class="row"><text>开户银行</text><text>{{ profile.bank.bankName || '—' }}</text></view>
      <view v-if="profile.bank?.branchName" class="row"><text>开户支行</text><text>{{ profile.bank.branchName }}</text></view>
      <view v-if="profile.bank" class="row"><text>银行卡号</text><text>{{ profile.bank.cardNumber || '—' }}</text></view>
      <view v-if="!profile.bank" class="row"><text>银行卡信息</text><text>暂无生效资料</text></view>
    </view>
  </view>
</template>

<style scoped>
.heading{font-size:38rpx;font-weight:700;color:#172033}.description{color:#8490a5;font-size:24rpx;margin:10rpx 0 22rpx}.notice{color:#b45309}
.profile{padding:28rpx}.hero{display:flex;align-items:center;gap:18rpx;padding-bottom:26rpx;border-bottom:1rpx solid #edf0f4}.avatar{display:flex;align-items:center;justify-content:center;width:84rpx;height:84rpx;border-radius:26rpx;background:#fff0e7;color:#df591b;font-size:36rpx;font-weight:700}.name{display:block;color:#172033;font-size:32rpx;font-weight:700}.sub{display:block;margin-top:6rpx;color:#8490a5;font-size:22rpx}.section-title{margin-top:24rpx;color:#172033;font-size:26rpx;font-weight:700}.row{display:flex;justify-content:space-between;gap:24rpx;padding:17rpx 0;border-bottom:1rpx solid #f0f2f6;font-size:23rpx}.row>text:first-child{flex:none;color:#8490a5}.row>text:last-child{color:#26344a;text-align:right;overflow-wrap:anywhere}.address>text:last-child{max-width:68%}.bank-title{margin-top:30rpx}
</style>
