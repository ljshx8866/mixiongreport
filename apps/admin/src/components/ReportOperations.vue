<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Log = { id: number; apiType: string; status: string; errorMessage: string | null; startedAt: string; finishedAt: string | null; storeName?: string }
type Store = { id: number; storeName: string }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; storeId: string; date: string; stores?: Store[] }>()
const logs = ref<Log[]>([]); const state = ref('OPEN'); const message = ref(''); const error = ref(''); const loading = ref(false)
const page = ref(1), pageSize = ref(20)
const pagedLogs = computed(() => logs.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const body = await response.json(); if (!response.ok) throw new Error(body.message ?? '请求失败'); return body
}
async function load() {
  loading.value = true; error.value = ''
  try {
    if (props.storeId === 'ALL') {
      const storeLogs = await Promise.all((props.stores ?? []).map(async (store) => ({ store, logs: await request(
        `/api/sync/logs?storeId=${store.id}&date=${props.date}`) as Log[] })))
      logs.value = storeLogs.flatMap(({ store, logs: items }) => items.map((item) => ({ ...item, storeName: store.storeName })))
      state.value = '多门店汇总'
    } else {
      const [reportState, syncLogs] = await Promise.all([request(`/api/report-states?storeId=${props.storeId}&date=${props.date}`), request(`/api/sync/logs?storeId=${props.storeId}&date=${props.date}`)])
      state.value = reportState.status; logs.value = syncLogs
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取状态失败' } finally { loading.value = false }
}
async function sync() {
  loading.value = true; message.value = ''; error.value = ''
  try { await request(`/api/sync/${props.storeId}/${props.date}`, { method: 'POST' }); message.value = '同步已完成。'; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '同步失败' } finally { loading.value = false }
}
async function exportExcel() {
  loading.value = true; message.value = ''; error.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/exports/daily.xlsx?storeId=${props.storeId}&date=${props.date}`, { headers: props.headers() })
    if (!response.ok) throw new Error('导出失败')
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a')
    link.href = url; link.download = `经营日报-${props.storeId}-${props.date}.xlsx`; link.click(); URL.revokeObjectURL(url)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导出失败' } finally { loading.value = false }
}
async function transition(action: 'verify' | 'lock') {
  loading.value = true; message.value = ''; error.value = ''
  try { const result = await request(`/api/report-states/${action}`, { method: 'POST', body: JSON.stringify({ storeId: Number(props.storeId), date: props.date }) }); state.value = result.status; message.value = action === 'verify' ? '日报已审核。' : '日报已锁定。'; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' } finally { loading.value = false }
}
watch(() => [props.storeId, props.date], () => { page.value = 1; void load() }, { immediate: true })
</script>

<template>
  <section class="card operations"><h2>日报审核与同步</h2><div class="operation-row"><span>当前状态：<b>{{ state }}</b></span><template v-if="storeId !== 'ALL'"><button :disabled="loading" @click="exportExcel">导出 Excel</button><button :disabled="loading" @click="sync">立即同步 POS</button><button :disabled="loading || state !== 'SUBMITTED'" class="verify" @click="transition('verify')">审核日报</button><button :disabled="loading || state !== 'VERIFIED'" class="lock" @click="transition('lock')">锁定日报</button></template><span v-else class="all-store-hint">全部门店可查看日志汇总；同步、审核和锁定请先选择单家门店。</span></div><p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p><h3>同步日志</h3><div class="table-scroll"><table><thead><tr><th v-if="storeId === 'ALL'">门店</th><th>接口</th><th>状态</th><th>开始时间</th><th>结束时间</th><th>异常</th></tr></thead><tbody><tr v-for="log in pagedLogs" :key="log.id"><td v-if="storeId === 'ALL'">{{ log.storeName }}</td><td>{{ log.apiType }}</td><td>{{ log.status }}</td><td>{{ new Date(log.startedAt).toLocaleString() }}</td><td>{{ log.finishedAt ? new Date(log.finishedAt).toLocaleString() : '—' }}</td><td>{{ log.errorMessage ?? '—' }}</td></tr><tr v-if="!logs.length"><td :colspan="storeId === 'ALL' ? 6 : 5">当前日期暂无同步日志。</td></tr></tbody></table></div><PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="logs.length" /></section>
</template>

<style scoped>
.all-store-hint{color:#64748b;font-size:13px}.table-scroll{max-width:100%;overflow:auto}
.operations table{width:100%;min-width:680px}
</style>
