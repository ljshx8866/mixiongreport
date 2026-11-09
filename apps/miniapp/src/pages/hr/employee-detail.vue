<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type EmployeeDetail = {
  id: number; displayName: string; status: string; userId: number | null
  identity: { name?: string | null; phone?: string | null; idNumber?: string | null; sex?: string | null;
    ethnicity?: string | null; birthDate?: string | null; address?: string | null } | null
  bank: { accountName?: string | null; bankName?: string | null; branchName?: string | null; cardNumber?: string | null } | null
  appointments: Array<{ storeId: number; storeName: string; effectiveFrom: string; effectiveToExclusive: string | null }>
}
const employee = ref<EmployeeDetail | null>(null)
const loading = ref(true)
const message = ref('')
onLoad((options) => { void load(Number(options?.id || 0)) })
async function load(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) { message.value = '员工编号无效'; loading.value = false; return }
  try { employee.value = await request<EmployeeDetail>(`/api/hr/employees/${id}`) }
  catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}
function statusName(value: string) {
  const labels: Record<string, string> = { DRAFT: '入职审批中', ACTIVE: '在职', TERMINATED: '已离职' }
  return labels[value] ?? '状态待核实'
}
</script>

<template>
  <view class="page detail-page">
    <PageLoading v-if="loading" text="正在读取员工资料" />
    <view v-if="message" class="card notice">{{ message }}</view>
    <template v-if="employee">
      <view class="hero card"><view class="avatar">{{ employee.displayName.slice(0, 1) }}</view>
        <view><text class="name">{{ employee.displayName }}</text><text class="status">{{ statusName(employee.status) }}</text></view>
      </view>
      <view class="card section"><text class="section-title">个人资料</text>
        <view class="row"><text>姓名</text><text>{{ employee.identity?.name || employee.displayName }}</text></view>
        <view class="row"><text>手机号</text><text>{{ employee.identity?.phone || '未填写' }}</text></view>
        <view class="row"><text>身份证号码</text><text>{{ employee.identity?.idNumber || '未填写' }}</text></view>
        <view class="row"><text>性别</text><text>{{ employee.identity?.sex || '未填写' }}</text></view>
        <view class="row"><text>民族</text><text>{{ employee.identity?.ethnicity || '未填写' }}</text></view>
        <view class="row"><text>出生日期</text><text>{{ employee.identity?.birthDate || '未填写' }}</text></view>
        <view class="row last"><text>住址</text><text>{{ employee.identity?.address || '未填写' }}</text></view>
      </view>
      <view class="card section"><text class="section-title">银行卡资料</text>
        <view class="row"><text>账户姓名</text><text>{{ employee.bank?.accountName || employee.displayName }}</text></view>
        <view class="row"><text>开户银行</text><text>{{ employee.bank?.bankName || '未填写' }}</text></view>
        <view class="row"><text>开户支行</text><text>{{ employee.bank?.branchName || '未填写' }}</text></view>
        <view class="row last"><text>银行卡号</text><text>{{ employee.bank?.cardNumber || '未填写' }}</text></view>
      </view>
      <view class="card section"><text class="section-title">任职记录</text>
        <view v-for="(appointment, index) in employee.appointments" :key="`${appointment.storeId}-${index}`" class="appointment">
          <text class="appointment-store">{{ appointment.storeName }}</text>
          <text class="appointment-date">{{ appointment.effectiveFrom }} 起{{ appointment.effectiveToExclusive ? `，至 ${appointment.effectiveToExclusive}` : '，目前有效' }}</text>
        </view>
        <view v-if="!employee.appointments.length" class="empty">暂无任职记录</view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.detail-page{padding-top:24rpx;padding-bottom:60rpx}.hero{display:flex;align-items:center;gap:18rpx;padding:24rpx}.avatar{display:flex;align-items:center;justify-content:center;width:82rpx;height:82rpx;border-radius:26rpx;background:#fff0e7;color:#d45a1d;font-size:36rpx;font-weight:800}.name{display:block;color:#1d2b40;font-size:31rpx;font-weight:750}.status{display:block;margin-top:6rpx;color:#728096;font-size:22rpx}.section{margin-top:18rpx;padding:22rpx}.section-title{display:block;margin-bottom:8rpx;color:#24334b;font-size:27rpx;font-weight:750}.row{display:flex;justify-content:space-between;align-items:flex-start;gap:18rpx;padding:16rpx 0;border-bottom:1rpx solid #f0f2f5;font-size:22rpx;line-height:1.5}.row text:first-child{flex:none;color:#8290a4}.row text:last-child{color:#34445d;text-align:right;overflow-wrap:anywhere;word-break:break-all}.row.last{border-bottom:0}.appointment{display:flex;flex-direction:column;gap:6rpx;padding:15rpx 0;border-top:1rpx solid #f0f2f5}.appointment-store{color:#34445d;font-size:24rpx;font-weight:700}.appointment-date,.empty{color:#8290a4;font-size:21rpx}.notice{padding:24rpx;color:#a14b20;font-size:23rpx}
</style>
