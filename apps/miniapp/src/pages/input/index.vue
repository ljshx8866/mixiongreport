<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { reactive, ref } from 'vue'
import { request } from '../../utils/api'
import { businessDate, currentStoreId, errorMessage } from '../../utils/session'

const date = businessDate()
const fields = [
  { key: 'kitchenPower', label: '厨房用电', required: true },
  { key: 'diningPower', label: '餐区用电', required: true },
  { key: 'fullDayPower', label: '24 小时用电', required: true },
  { key: 'airConditionPower', label: '空调用电', required: true },
  { key: 'totalPower', label: '总用电（按后台配置使用）', required: false },
  { key: 'waterUsage', label: '用水吨数', required: true },
  { key: 'laborHours', label: '员工总工时', required: true },
  { key: 'addonCustomerCount', label: '加点人数', required: true },
  { key: 'comboCustomerCount', label: '套餐人数', required: false },
] as const
type Field = typeof fields[number]['key']
const form = reactive<Record<Field | 'remark', string>>({ kitchenPower: '', diningPower: '', fullDayPower: '', airConditionPower: '', totalPower: '', waterUsage: '', laborHours: '', addonCustomerCount: '', comboCustomerCount: '', remark: '' })
const status = ref('DRAFT')
const message = ref('')
const saving = ref(false)

onShow(async () => {
  const storeId = currentStoreId()
  if (!storeId) { message.value = '请先在“我的”页面登录并选择门店'; return }
  try {
    const input = await request<Record<string, any> | null>(`/api/daily-inputs?storeId=${storeId}&date=${date}`)
    if (input) {
      for (const field of fields) form[field.key] = input[field.key] == null ? '' : String(input[field.key])
      form.remark = input.remark ?? ''
      status.value = input.status
    }
    message.value = ''
  } catch (error) { message.value = errorMessage(error) }
})

async function save(submit: boolean) {
  const storeId = currentStoreId()
  if (!storeId || saving.value) return
  if (submit && fields.some((field) => field.required && form[field.key] === '')) { message.value = '请填写所有必填项'; return }
  const payload: Record<string, unknown> = { storeId, date, remark: form.remark }
  for (const field of fields) {
    const value = form[field.key].trim()
    const number = value === '' ? null : Number(value)
    if (number !== null && (!Number.isFinite(number) || number < 0 || ((field.key === 'addonCustomerCount' || field.key === 'comboCustomerCount') && !Number.isInteger(number)))) {
      message.value = `${field.label}请输入有效的非负数`; return
    }
    payload[field.key] = number
  }
  saving.value = true
  message.value = ''
  try {
    const result = await request<{ id: number }>('/api/daily-inputs', 'POST', payload)
    if (submit) { await request(`/api/daily-inputs/${result.id}/submit`, 'POST'); status.value = 'SUBMITTED' }
    uni.showToast({ title: submit ? '已提交' : '草稿已保存' })
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
</script>

<template>
  <view class="card">
    <text class="value">{{ date }} 每日填报</text>
    <text class="label">状态：{{ status === 'DRAFT' ? '草稿' : status === 'SUBMITTED' ? '已提交' : '已锁定' }}</text>
    <view v-for="field in fields" :key="field.key" class="field"><text>{{ field.label }}{{ field.required ? ' *' : '' }}</text><input v-model="form[field.key]" type="digit" :disabled="status !== 'DRAFT'" /></view>
    <view class="field"><text>备注</text><textarea v-model="form.remark" :disabled="status !== 'DRAFT'" /></view>
    <text v-if="message" style="color:#dc2626">{{ message }}</text>
    <template v-if="status === 'DRAFT'"><view class="button" @click="save(false)">保存草稿</view><view class="button" style="margin-top:16rpx;background:#0f766e" @click="save(true)">提交</view></template>
  </view>
</template>
