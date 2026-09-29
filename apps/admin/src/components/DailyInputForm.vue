<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; storeId: string; date: string }>()
const emit = defineEmits<{ saved: [] }>()
const fields = [
  ['kitchenPower', '厨房用电（度）', 'number'], ['diningPower', '餐区用电（度）', 'number'],
  ['fullDayPower', '24 小时用电（度）', 'number'], ['airConditionPower', '空调用电（度）', 'number'],
  ['totalPower', '总用电（度，可选）', 'number'], ['waterUsage', '用水（吨）', 'number'],
  ['laborHours', '员工总工时', 'number'], ['addonCustomerCount', '加点人数', 'number'],
  ['comboCustomerCount', '套餐人数（可选）', 'number'], ['remark', '备注', 'text'],
] as const
const form = reactive<Record<string, string>>({})
const inputId = ref<number | null>(null); const status = ref(''); const message = ref(''); const loading = ref(false)
const clear = () => { inputId.value = null; status.value = ''; fields.forEach(([key]) => { form[key] = '' }) }
async function load() {
  clear(); message.value = ''
  const response = await fetch(`${props.apiBase}/api/daily-inputs?storeId=${props.storeId}&date=${props.date}`, { headers: props.headers() })
  if (!response.ok) { message.value = '读取人工填报失败'; return }
  const data = await response.json(); if (!data) return
  inputId.value = data.id; status.value = data.status
  fields.forEach(([key]) => { form[key] = data[key] == null ? '' : String(data[key]) })
}
async function save(submit = false) {
  loading.value = true; message.value = ''
  try {
    const payload: Record<string, unknown> = { storeId: Number(props.storeId), date: props.date }
    fields.forEach(([key, , type]) => { payload[key] = form[key] === '' ? null : type === 'number' ? Number(form[key]) : form[key] })
    const saveResponse = await fetch(`${props.apiBase}/api/daily-inputs`, { method: 'POST', headers: props.headers(), body: JSON.stringify(payload) })
    const saved = await saveResponse.json(); if (!saveResponse.ok) throw new Error(saved.message ?? '保存失败')
    inputId.value = saved.id; status.value = saved.status
    if (submit) {
      const submitResponse = await fetch(`${props.apiBase}/api/daily-inputs/${inputId.value}/submit`, { method: 'POST', headers: props.headers() })
      const submitted = await submitResponse.json(); if (!submitResponse.ok) throw new Error(submitted.message ?? '提交失败')
      status.value = submitted.status
    }
    message.value = submit ? '已提交，等待总部审核。' : '草稿已保存。'; emit('saved')
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '操作失败' } finally { loading.value = false }
}
watch(() => [props.storeId, props.date], load, { immediate: true })
</script>

<template>
  <section class="card form-card"><h2>每日人工填报 <small v-if="status">{{ status }}</small></h2><p>经营、订单和菜品数据由 POS 自动同步。</p><div class="form-grid"><label v-for="[key, label, type] in fields" :key="key">{{ label }}<input v-model="form[key]" :type="type" min="0" step="0.01" :disabled="status !== '' && status !== 'DRAFT'" /></label></div><p v-if="message" class="form-message">{{ message }}</p><div class="actions"><button :disabled="loading || (status !== '' && status !== 'DRAFT')" @click="save(false)">保存草稿</button><button :disabled="loading || (status !== '' && status !== 'DRAFT')" class="submit" @click="save(true)">提交</button></div></section>
</template>
