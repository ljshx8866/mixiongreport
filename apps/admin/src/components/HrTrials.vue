<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string; permissionCodes: string[] }
type TrialEmployee = { id: number; name: string; status?: string; trialStartedAt: string | null; trialEndedAt?: string | null }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[] }>()
const emit = defineEmits<{ convert: [request: { trialEmployeeId: number; storeId: number }] }>()
const storeId = ref('')
const name = ref('')
const startDate = ref(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
const trials = ref<TrialEmployee[]>([])
const historyView = ref(false)
const page = ref(1)
const pageSize = ref(20)
const pagedTrials = computed(() => trials.value.slice((page.value - 1) * pageSize.value,
  page.value * pageSize.value))
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const selectedStore = computed(() => props.stores.find((store) => String(store.id) === storeId.value))
const canConvert = computed(() => selectedStore.value?.permissionCodes.includes('HR_ONBOARDING_CREATE') &&
  selectedStore.value.permissionCodes.includes('HR_ONBOARDING_VERIFY'))

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${props.apiBase}${path}`, { ...init,
    headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '操作失败')
  return data as T
}
async function load() {
  trials.value = []
  page.value = 1
  if (!storeId.value) return
  loading.value = true; error.value = ''
  const endpoint = historyView.value ? '/api/hr/employees/trials/history' : '/api/hr/employees/trials'
  try { trials.value = await request<TrialEmployee[]>(`${endpoint}?storeId=${encodeURIComponent(storeId.value)}`) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取试岗人员失败' }
  finally { loading.value = false }
}
function statusName(status?: string) {
  if (status === 'TRIAL') return '试岗中'
  if (status === 'TRIAL_ENDED') return '已结束试岗'
  if (status === 'ACTIVE') return '已转入职'
  if (status === 'TERMINATED') return '转入职后已离职'
  return '历史记录'
}
async function createTrial() {
  if (!selectedStore.value || !name.value.trim() || !startDate.value) return
  saving.value = true; error.value = ''; message.value = ''
  try {
    await request('/api/hr/employees/trials', { method: 'POST', body: JSON.stringify({
      storeId: Number(storeId.value), name: name.value.trim(), trialStartedAt: startDate.value,
    }) })
    historyView.value = false; name.value = ''; await load(); message.value = '试岗人员已录入，可在排班时选择。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '录入失败' }
  finally { saving.value = false }
}
async function endTrial(item: TrialEmployee) {
  if (!window.confirm(`结束“${item.name}”的试岗？人员将从当前试岗名单移入历史记录，排班、工时和操作记录都会保留。`)) return
  saving.value = true; error.value = ''; message.value = ''
  try {
    await request(`/api/hr/employees/${item.id}/trial`, { method: 'DELETE' })
    await load(); message.value = '试岗已结束，档案和排班、工时记录已保留在历史记录中。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '结束试岗失败' }
  finally { saving.value = false }
}
watch(() => props.stores.map((item) => item.id).join(','), () => {
  if (!props.stores.some((item) => String(item.id) === storeId.value)) {
    storeId.value = String(props.stores[0]?.id ?? '')
    void load()
  }
})
onMounted(() => { storeId.value = String(props.stores[0]?.id ?? ''); void load() })
</script>

<template>
  <section class="card hr-trials">
    <div class="heading"><div><h2>试岗管理</h2><p>试岗期间可排班和确认工时，暂不计工资；结束或转入职后，试岗档案及排班、工时记录保留在历史记录。</p></div>
      <label v-if="stores.length > 1">管理门店<select v-model="storeId" @change="load">
        <option v-for="store in stores" :key="store.id" :value="String(store.id)">{{ store.storeName }}</option>
      </select></label></div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="success">{{ message }}</p>
    <div class="entry-form">
      <label>姓名<input v-model="name" maxlength="100" placeholder="请输入试岗人员姓名" /></label>
      <label>试岗开始时间<input v-model="startDate" type="date" /></label>
      <button class="primary" :disabled="saving || !name.trim() || !startDate || !storeId" @click="createTrial">{{ saving ? '处理中…' : '录入试岗' }}</button>
    </div>
    <div class="list-heading"><h3>{{ historyView ? '试岗历史记录' : '当前试岗人员' }}</h3><div class="list-actions">
      <button :class="{ selected: !historyView }" :disabled="loading || saving" @click="historyView = false; load()">当前试岗</button>
      <button :class="{ selected: historyView }" :disabled="loading || saving" @click="historyView = true; load()">历史记录</button>
      <button :disabled="loading || saving" @click="load">刷新</button></div></div>
    <p v-if="loading" class="empty">正在读取试岗人员…</p>
    <p v-else-if="!trials.length" class="empty">{{ historyView ? '当前门店暂无试岗历史记录。' : '当前门店暂无试岗人员。' }}</p>
    <article v-for="item in pagedTrials" :key="item.id" class="trial-row">
      <div><strong>{{ item.name }} <span v-if="historyView" class="trial-status">{{ statusName(item.status) }}</span></strong>
        <small>试岗开始：{{ item.trialStartedAt || '未记录' }}<template v-if="item.trialEndedAt"> · 结束：{{ new Date(item.trialEndedAt).toLocaleString('zh-CN') }}</template></small></div>
      <div v-if="!historyView" class="trial-actions">
        <button v-if="canConvert" class="convert" :disabled="saving" @click="emit('convert', { trialEmployeeId: item.id, storeId: Number(storeId) })">转入职</button>
        <button class="danger" :disabled="saving" @click="endTrial(item)">结束试岗</button>
      </div>
    </article>
    <PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="trials.length" />
    <p class="footnote">历史记录包含当前试岗、已结束试岗、已转入职及后续离职人员；试岗期间的排班和工时记录可继续追溯，已生成的经营日报不会因结束试岗而变化。</p>
  </section>
</template>

<style scoped>
.hr-trials{padding:24px}.heading,.entry-form,.list-heading,.trial-row{display:flex;align-items:center;justify-content:space-between;gap:14px}.heading h2{margin:0;color:#1d2e47}.heading p{margin:7px 0 0;color:#7c899d}.heading label,.entry-form label{display:grid;gap:7px;color:#68768c;font-size:13px}.heading select,.entry-form input{min-height:40px;padding:0 12px;border:1px solid #dfe5ed;border-radius:9px;background:#fff;color:#26364f}.entry-form{justify-content:flex-start;margin:22px 0;padding:18px;border-radius:14px;background:#f7f9fc}.entry-form label{flex:1}.primary,.danger,.convert,.list-heading button{min-height:40px;padding:0 16px;border:0;border-radius:9px;cursor:pointer}.primary,.convert{background:#e85d21;color:white}.danger{background:#fff0ed;color:#b64835}.trial-actions,.list-actions{display:flex;align-items:center;gap:8px;flex:none}.list-heading{margin:24px 0 10px}.list-heading h3{margin:0;color:#2a3951}.list-heading button{background:#eef2f7;color:#44546b}.list-heading button.selected{background:#263a56;color:white}.trial-status{display:inline-block;margin-left:8px;padding:3px 8px;border-radius:999px;background:#edf2f8;color:#52647e;font-size:12px;font-weight:600;vertical-align:2px}.trial-row{padding:15px 4px;border-top:1px solid #edf0f5}.trial-row strong,.trial-row small{display:block}.trial-row strong{color:#27364e}.trial-row small{margin-top:5px;color:#8a96a7}.empty{padding:18px;color:#8a96a7;text-align:center}.success{color:#18724d}.footnote{margin:18px 0 0;color:#8a96a7;font-size:12px;line-height:1.6}@media(max-width:700px){.heading,.entry-form,.list-heading{align-items:stretch;flex-direction:column}.entry-form label{width:100%}.list-actions{flex-wrap:wrap}}
</style>
