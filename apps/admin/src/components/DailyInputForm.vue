<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { friendlyError } from '../error-dialog'

const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; storeId: string; date: string }>()
const emit = defineEmits<{ saved: [] }>()
const fields = [
  ['totalPower', '用电度数（度）', 'number'], ['kitchenPower', '厨房用电（度）', 'number'],
  ['diningPower', '前厅用电（度）', 'number'], ['waterUsage', '用水（吨）', 'number'],
  ['laborHours', '工时数量（小时）', 'number'], ['remark', '备注', 'text'],
] as const
const form = reactive<Record<string, string>>({})
const inputId = ref<number | null>(null); const status = ref(''); const message = ref(''); const loading = ref(false)
let loadVersion = 0
const popupMessage = computed(() => message.value.startsWith('已提交') || message.value === '草稿已保存。' ? '' : message.value)
const clear = () => { inputId.value = null; status.value = ''; fields.forEach(([key]) => { form[key] = '' }) }
async function readResponse(response: Response, action: string): Promise<Record<string, unknown> | null> {
  const raw = await response.text()
  let data: Record<string, unknown> | null = null
  if (raw) {
    try { data = JSON.parse(raw) as Record<string, unknown> }
    catch { if (response.ok) throw new Error(action + '返回内容异常，请刷新页面后重试') }
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录状态已失效，请重新登录后再试')
    if (response.status === 403) throw new Error('当前账号没有所选门店的填报权限，请联系管理员配置')
    if ([502, 503, 504].includes(response.status)) throw new Error('填报服务暂时不可用，请稍后重试')
    const apiMessage = typeof data?.message === "string" ? data.message : ""
    throw new Error(apiMessage || `${action}失败（${response.status}），请稍后重试`)
  }
  return data
}
async function load() {
  const version = ++loadVersion
  const storeId = props.storeId, date = props.date
  clear(); message.value = ""
  try {
    const url = props.apiBase + "/api/daily-inputs?storeId=" + encodeURIComponent(storeId) + "&date=" + encodeURIComponent(date)
    const response = await fetch(url, { headers: props.headers() })
    const data = await readResponse(response, '读取人工填报') as ({ id: number; status: string; [key: string]: unknown } | null)
    if (version !== loadVersion || !data) return
    inputId.value = data.id; status.value = data.status
    fields.forEach(([key]) => { form[key] = data[key] == null ? "" : String(data[key]) })
  } catch (cause) {
    if (version === loadVersion) message.value = friendlyError(cause instanceof Error ? cause.message : '读取人工填报失败')
  }
}
async function save(submit = false) {
  loading.value = true; message.value = ''
  let syncPending = false
  try {
    const payload: Record<string, unknown> = { storeId: Number(props.storeId), date: props.date }
    fields.forEach(([key, , type]) => { payload[key] = form[key] === '' ? null : type === 'number' ? Number(form[key]) : form[key] })
    const saveResponse = await fetch(`${props.apiBase}/api/daily-inputs`, { method: 'POST', headers: props.headers(), body: JSON.stringify(payload) })
    const saved = await readResponse(saveResponse, '保存人工填报') as ({ id: number; status: string } | null); if (!saved) throw new Error('保存人工填报失败')
    inputId.value = saved.id; status.value = saved.status
    if (submit) {
      const submitResponse = await fetch(`${props.apiBase}/api/daily-inputs/${inputId.value}/submit`, { method: 'POST', headers: props.headers() })
      const submitted = await readResponse(submitResponse, '提交人工填报') as ({ status: string; posSync?: { status: string } } | null); if (!submitted) throw new Error('提交人工填报失败')
      status.value = submitted.status
      syncPending = submitted.posSync?.status === 'PENDING'
    }
    message.value = submit ? syncPending
      ? '已提交，POS经营数据正在同步，完成后日报会自动更新。' : '已提交，等待总部审核。' : '草稿已保存。'; emit('saved')
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '操作失败' } finally { loading.value = false }
}
watch(() => [props.storeId, props.date], load, { immediate: true })
onBeforeUnmount(() => { loadVersion++ })
</script>

<template>
  <section class="card form-card"><h2>每日人工填报 <small v-if="status">{{ status }}</small></h2><p>经营、订单和菜品数据由 POS 自动同步。</p><div class="form-grid"><label v-for="[key, label, type] in fields" :key="key">{{ label }}<input v-model="form[key]" :type="type" min="0" step="0.01" :disabled="status !== '' && status !== 'DRAFT'" /></label></div><p v-if="message" class="form-message" v-popup-error="popupMessage">{{ message }}</p><div class="actions"><button :disabled="loading || (status !== '' && status !== 'DRAFT')" @click="save(false)">保存草稿</button><button :disabled="loading || (status !== '' && status !== 'DRAFT')" class="submit" @click="save(true)">提交</button></div></section>
</template>
