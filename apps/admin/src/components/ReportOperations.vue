<script setup lang="ts">
import { ref, watch } from 'vue'

type Log = { id: number; apiType: string; status: string; errorMessage: string | null; startedAt: string; finishedAt: string | null }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; storeId: string; date: string }>()
const logs = ref<Log[]>([]); const state = ref('OPEN'); const message = ref(''); const loading = ref(false)
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const body = await response.json(); if (!response.ok) throw new Error(body.message ?? '请求失败'); return body
}
async function load() {
  loading.value = true; message.value = ''
  try {
    const [reportState, syncLogs] = await Promise.all([request(`/api/report-states?storeId=${props.storeId}&date=${props.date}`), request(`/api/sync/logs?storeId=${props.storeId}&date=${props.date}`)])
    state.value = reportState.status; logs.value = syncLogs
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '读取状态失败' } finally { loading.value = false }
}
async function sync() {
  loading.value = true; message.value = ''
  try { await request(`/api/sync/${props.storeId}/${props.date}`, { method: 'POST' }); message.value = '同步已完成。'; await load() }
  catch (cause) { message.value = cause instanceof Error ? cause.message : '同步失败' } finally { loading.value = false }
}
async function exportExcel() {
  loading.value = true; message.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/exports/daily.xlsx?storeId=${props.storeId}&date=${props.date}`, { headers: props.headers() })
    if (!response.ok) throw new Error('导出失败')
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a')
    link.href = url; link.download = `经营日报-${props.storeId}-${props.date}.xlsx`; link.click(); URL.revokeObjectURL(url)
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '导出失败' } finally { loading.value = false }
}
async function transition(action: 'verify' | 'lock') {
  loading.value = true; message.value = ''
  try { const result = await request(`/api/report-states/${action}`, { method: 'POST', body: JSON.stringify({ storeId: Number(props.storeId), date: props.date }) }); state.value = result.status; message.value = action === 'verify' ? '日报已审核。' : '日报已锁定。'; await load() }
  catch (cause) { message.value = cause instanceof Error ? cause.message : '操作失败' } finally { loading.value = false }
}
watch(() => [props.storeId, props.date], load, { immediate: true })
</script>

<template>
  <section class="card operations"><h2>日报审核与同步</h2><div class="operation-row"><span>当前状态：<b>{{ state }}</b></span><button :disabled="loading" @click="exportExcel">导出 Excel</button><button :disabled="loading" @click="sync">立即同步 POS</button><button :disabled="loading || state !== 'SUBMITTED'" class="verify" @click="transition('verify')">审核日报</button><button :disabled="loading || state !== 'VERIFIED'" class="lock" @click="transition('lock')">锁定日报</button></div><p v-if="message" class="form-message">{{ message }}</p><h3>同步日志</h3><table><thead><tr><th>接口</th><th>状态</th><th>开始时间</th><th>结束时间</th><th>异常</th></tr></thead><tbody><tr v-for="log in logs" :key="log.id"><td>{{ log.apiType }}</td><td>{{ log.status }}</td><td>{{ new Date(log.startedAt).toLocaleString() }}</td><td>{{ log.finishedAt ? new Date(log.finishedAt).toLocaleString() : '—' }}</td><td>{{ log.errorMessage ?? '—' }}</td></tr><tr v-if="!logs.length"><td colspan="5">当前日期暂无同步日志。</td></tr></tbody></table></section>
</template>
