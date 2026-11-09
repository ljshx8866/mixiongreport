<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import PaginationControls from './PaginationControls.vue'

type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
type Alert = {
  id: number; source: string; severity: string; status: AlertStatus; title: string; message: string;
  route: string | null; method: string | null; httpStatus: number | null; suggestion: string | null;
  occurrenceCount: number; firstSeenAt: string; lastSeenAt: string
}
type AlertPage = { items: Alert[]; total: number; page: number; pageSize: number }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const status = ref<AlertStatus | ''>('OPEN')
const page = ref(1), pageSize = ref(20)
const result = ref<AlertPage>({ items: [], total: 0, page: 1, pageSize: 20 })
const loading = ref(false), busyId = ref<number | null>(null)
const error = ref(''), message = ref('')
const statusLabels: Record<AlertStatus, string> = { OPEN: '未读', ACKNOWLEDGED: '已读', RESOLVED: '已解决' }
const pageCount = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize.value)))
let pollTimer: ReturnType<typeof setInterval> | undefined

async function load(quiet = false) {
  if (!quiet) loading.value = true
  error.value = ''
  try {
    const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) })
    if (status.value) query.set('status', status.value)
    const response = await fetch(`${props.apiBase}/api/system-alerts?${query}`, { headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? `读取系统告警失败（HTTP ${response.status}）`)
    result.value = data
    if (page.value > pageCount.value) { page.value = pageCount.value; await load(quiet) }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取系统告警失败' }
  finally { loading.value = false }
}
async function setStatus(item: Alert, next: AlertStatus) {
  busyId.value = item.id; error.value = ''; message.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/system-alerts/${item.id}/status`, {
      method: 'PATCH', headers: { ...props.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? `更新告警失败（HTTP ${response.status}）`)
    message.value = `已将告警标记为${statusLabels[next]}`
    await load(true)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新告警失败' }
  finally { busyId.value = null }
}
watch(status, () => { page.value = 1; void load() })
watch([page, pageSize], () => { void load() })
onMounted(() => { void load(); pollTimer = setInterval(() => { if (!loading.value && busyId.value == null) void load(true) }, 60_000) })
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })
</script>

<template>
  <section class="card system-alerts">
    <div class="alert-heading"><div><h2>系统告警</h2><p>自动收集接口异常与 POS 同步失败，每 5 分钟检查一次同步日志。</p></div><button class="refresh" :disabled="loading" @click="load()">{{ loading ? '读取中…' : '刷新' }}</button></div>
    <div class="alert-filters"><label>告警状态<select v-model="status"><option value="OPEN">未读</option><option value="ACKNOWLEDGED">已读</option><option value="RESOLVED">已解决</option><option value="">全部状态</option></select></label><span>可安全重复的 POS 同步失败会按现有同步策略重试；告警本身不会擅自改业务数据或发布代码。</span></div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <div v-if="!result.items.length && !loading" class="alert-empty"><strong>暂无告警</strong><span>系统暂未发现符合当前筛选条件的异常。</span></div>
    <article v-for="item in result.items" :key="item.id" class="alert-item" :class="{ unresolved: item.status === 'OPEN' }">
      <header><div><span class="severity">{{ item.severity === 'CRITICAL' ? '严重' : '异常' }}</span><strong>{{ item.title }}</strong><span class="status-chip" :class="item.status.toLowerCase()">{{ statusLabels[item.status] }}</span></div><small>最近发生：{{ new Date(item.lastSeenAt).toLocaleString('zh-CN') }}</small></header>
      <dl><div><dt>来源</dt><dd>{{ item.source === 'POS_SYNC' ? 'POS 数据同步' : '接口请求' }}</dd></div><div v-if="item.method || item.route"><dt>位置</dt><dd>{{ item.method ? `${item.method} ` : '' }}{{ item.route || '—' }}{{ item.httpStatus ? `（HTTP ${item.httpStatus}）` : '' }}</dd></div><div><dt>次数</dt><dd>{{ item.occurrenceCount }} 次</dd></div></dl>
      <p class="alert-message">{{ item.message }}</p><p v-if="item.suggestion" class="suggestion"><b>建议排查</b>{{ item.suggestion }}</p>
      <footer><small>首次发生：{{ new Date(item.firstSeenAt).toLocaleString('zh-CN') }}</small><div><button v-if="item.status === 'OPEN'" :disabled="busyId === item.id" @click="setStatus(item, 'ACKNOWLEDGED')">标记已读</button><button v-if="item.status !== 'RESOLVED'" class="resolve" :disabled="busyId === item.id" @click="setStatus(item, 'RESOLVED')">标记已解决</button><button v-if="item.status === 'RESOLVED'" :disabled="busyId === item.id" @click="setStatus(item, 'OPEN')">重新打开</button></div></footer>
    </article>
    <PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="result.total" :always="true" />
  </section>
</template>

<style scoped>
.system-alerts h2{margin:0}.alert-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.alert-heading p,.alert-filters span{margin:6px 0 0;color:#728096;font-size:13px}.refresh,.alert-item button{border:1px solid #d7dee8;border-radius:8px;background:#fff;color:#344054;padding:8px 12px;cursor:pointer}.refresh:disabled,.alert-item button:disabled{opacity:.55;cursor:wait}.alert-filters{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:18px 0;padding:12px 14px;border-radius:10px;background:#f5f7fb}.alert-filters label{display:flex;align-items:center;gap:10px;white-space:nowrap}.alert-filters select{min-width:130px;padding:7px 10px;border:1px solid #d7dee8;border-radius:8px;background:#fff}.alert-empty{display:grid;gap:5px;place-items:center;padding:44px 16px;color:#7b8797}.alert-empty strong{color:#344054}.alert-item{margin:12px 0;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}.alert-item.unresolved{border-left:4px solid #e75b24}.alert-item header,.alert-item header>div,.alert-item footer,.alert-item footer>div{display:flex;align-items:center;justify-content:space-between;gap:10px}.alert-item header>div{justify-content:flex-start;flex-wrap:wrap}.alert-item header small,.alert-item footer small{color:#8390a1;font-size:12px}.severity{padding:3px 7px;border-radius:6px;background:#fff0e9;color:#c34716;font-size:11px}.status-chip{padding:3px 8px;border-radius:20px;background:#f1f3f6;color:#667085;font-size:12px}.status-chip.open{background:#fff0e9;color:#c34716}.status-chip.resolved{background:#e9f7ee;color:#218447}.alert-item dl{display:flex;flex-wrap:wrap;gap:24px;margin:12px 0;color:#718096;font-size:13px}.alert-item dl div{display:flex;gap:7px}.alert-item dd{margin:0;color:#334155}.alert-message{margin:10px 0;color:#38465a;line-height:1.6;overflow-wrap:anywhere}.suggestion{margin:8px 0;padding:10px 12px;border-radius:8px;background:#f5f7fb;color:#58677d;line-height:1.6}.suggestion b{margin-right:8px;color:#344054}.alert-item footer{margin-top:12px;padding-top:12px;border-top:1px solid #eef1f5}.alert-item footer>div{justify-content:flex-end}.alert-item .resolve{border-color:#dbeade;color:#247446}@media(max-width:720px){.alert-filters{align-items:flex-start;flex-direction:column}.alert-item header,.alert-item footer{align-items:flex-start;flex-direction:column}.alert-item footer>div{justify-content:flex-start;flex-wrap:wrap}}
</style>
