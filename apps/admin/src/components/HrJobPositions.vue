<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string; status?: boolean }
type StoreLink = { id: number; storeName: string; hourlyRate: string | null; enabled: boolean }
type Position = { id: number; name: string; scheduleOnly: boolean; enabled: boolean; stores: StoreLink[] }
type StoreRate = { storeId: number; hourlyRate: string }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[] }>()
const rows = ref<Position[]>([])
const storeFilter = ref('ALL')
const page = ref(1), pageSize = ref(20)
const busy = ref(false), saving = ref(false), error = ref(''), message = ref('')
const editorOpen = ref(false), editingId = ref<number | null>(null)
const selectedStoreIds = ref<number[]>([])
const rates = ref<Record<number, string>>({})
const name = ref('')
const scheduleOnly = ref(false)
const activeStores = computed(() => props.stores.filter((store) => store.status !== false))
const visible = computed(() => rows.value.filter((row) => storeFilter.value === 'ALL' ||
  row.stores.some((store) => store.id === Number(storeFilter.value))))
const paged = computed(() => visible.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch(visible, () => { if (page.value > Math.max(1, Math.ceil(visible.value.length / pageSize.value))) page.value = 1 })

async function request<T = any>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${props.apiBase}${path}`, { ...init,
    headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : '操作失败')
  return result as T
}
async function load() {
  busy.value = true; error.value = ''
  try { rows.value = await request<Position[]>('/api/hr/job-positions') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取岗位失败' }
  finally { busy.value = false }
}
function openCreate() {
  editingId.value = null; name.value = ''; scheduleOnly.value = false; selectedStoreIds.value = []; rates.value = {}
  editorOpen.value = true; error.value = ''
}
function openEdit(row: Position) {
  editingId.value = row.id; name.value = row.name; scheduleOnly.value = row.scheduleOnly
  selectedStoreIds.value = row.stores.map((store) => store.id)
  rates.value = Object.fromEntries(row.stores.map((store) => [store.id, store.hourlyRate ?? '']))
  editorOpen.value = true; error.value = ''
}
function setStoreSelected(storeId: number, selected: boolean) {
  if (selected) {
    if (!selectedStoreIds.value.includes(storeId)) selectedStoreIds.value.push(storeId)
    if (!rates.value[storeId]) rates.value[storeId] = ''
  } else selectedStoreIds.value = selectedStoreIds.value.filter((id) => id !== storeId)
}
function validRate(value: string) { return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0 }
async function save() {
  if (!name.value.trim()) { error.value = '请输入岗位名称'; return }
  if (!selectedStoreIds.value.length) { error.value = '至少选择一个归属门店'; return }
  if (!scheduleOnly.value && selectedStoreIds.value.some((id) => !validRate(rates.value[id] ?? ''))) {
    error.value = '请为每个门店填写大于 0、最多两位小数的时薪'; return
  }
  const storeRates: StoreRate[] = scheduleOnly.value ? [] : selectedStoreIds.value.map((storeId) => ({ storeId, hourlyRate: rates.value[storeId].trim() }))
  saving.value = true; error.value = ''; message.value = ''
  try {
    if (editingId.value) await request(`/api/hr/job-positions/${editingId.value}`, { method: 'PATCH',
      body: JSON.stringify({ name: name.value.trim(), scheduleOnly: scheduleOnly.value, storeIds: selectedStoreIds.value, storeRates }) })
    else await request('/api/hr/job-positions', { method: 'POST',
      body: JSON.stringify({ name: name.value.trim(), scheduleOnly: scheduleOnly.value, storeIds: selectedStoreIds.value, storeRates }) })
    editorOpen.value = false
    message.value = editingId.value ? '岗位设置已更新。' : '岗位已新增。'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存岗位失败' }
  finally { saving.value = false }
}
async function toggle(row: Position) {
  error.value = ''; message.value = ''
  try {
    await request(`/api/hr/job-positions/${row.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !row.enabled }) })
    message.value = row.enabled ? '岗位已停用；已生效员工的薪资记录不受影响。' : '岗位已启用。'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新岗位状态失败' }
}
async function remove(row: Position) {
  if (!window.confirm(`确定彻底删除“${row.name}”岗位吗？已有员工的时薪记录及历史申请快照会保留。`)) return
  error.value = ''; message.value = ''
  try {
    await request(`/api/hr/job-positions/${row.id}`, { method: 'DELETE' })
    message.value = '岗位已删除。'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除岗位失败' }
}
onMounted(load)
</script>

<template>
  <section class="card job-positions">
    <header class="heading"><div><h2>岗位设置</h2>
      <p>岗位可关联多个门店。普通岗位按门店设置时薪；仅排班岗位只用于排班，不生成工时确认、工时统计或时薪工资。</p></div>
      <button :disabled="busy" @click="openCreate">新增岗位</button></header>
    <div class="filters"><label>门店筛选<select v-model="storeFilter" @change="page = 1"><option value="ALL">全部门店</option>
      <option v-for="store in activeStores" :key="store.id" :value="String(store.id)">{{ store.storeName }}</option></select></label>
      <button class="secondary" :disabled="busy" @click="load">{{ busy ? '读取中…' : '刷新' }}</button></div>
    <p v-if="message" class="success">{{ message }}</p><p v-if="error" class="error" v-popup-error="error">{{ error }}</p>
    <div class="table-scroll"><table><thead><tr><th>岗位</th><th>归属门店及工资</th><th>状态</th><th>操作</th></tr></thead>
      <tbody><tr v-for="row in paged" :key="row.id"><td><strong>{{ row.name }}</strong><small v-if="row.scheduleOnly" class="schedule-badge">仅排班</small></td>
        <td><div class="store-pills"><span v-for="store in row.stores" :key="store.id">{{ store.storeName }}<template v-if="!row.scheduleOnly"> · ¥{{ store.hourlyRate }}/小时</template><template v-else> · 不计工时</template></span></div></td>
        <td><span :class="row.enabled ? 'enabled' : 'disabled'">{{ row.enabled ? '启用' : '停用' }}</span></td>
        <td class="actions"><button class="text" @click="openEdit(row)">编辑</button>
          <button class="text" @click="toggle(row)">{{ row.enabled ? '停用' : '启用' }}</button>
          <button class="text danger" @click="remove(row)">删除</button></td></tr>
        <tr v-if="!paged.length"><td colspan="4">{{ busy ? '正在读取岗位…' : '暂无岗位，可新增岗位配置。' }}</td></tr></tbody></table></div>
    <PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="visible.length" />
    <div v-if="editorOpen" class="backdrop" @click.self="editorOpen = false"><section class="dialog card">
      <h3>{{ editingId ? '编辑岗位' : '新增岗位' }}</h3>
      <label>岗位名称<input v-model="name" maxlength="100" placeholder="例如：店长、厨师" /></label>
      <label class="schedule-setting"><input v-model="scheduleOnly" type="checkbox" />仅用于排班，不计算工时、不需要工时确认</label>
      <fieldset><legend>{{ scheduleOnly ? '关联门店' : '关联门店和时薪' }}</legend><label v-for="store in activeStores" :key="store.id" class="store-rate">
        <span class="store-check"><input type="checkbox" :checked="selectedStoreIds.includes(store.id)"
          @change="setStoreSelected(store.id, ($event.target as HTMLInputElement).checked)" />{{ store.storeName }}</span>
        <input v-if="selectedStoreIds.includes(store.id) && !scheduleOnly" v-model="rates[store.id]" inputmode="decimal" placeholder="时薪（元/小时）" />
      </label></fieldset>
      <p v-if="error" class="error" v-popup-error="error">{{ error }}</p>
      <div class="dialog-actions"><button class="secondary" :disabled="saving" @click="editorOpen = false">取消</button>
        <button :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存岗位' }}</button></div>
    </section></div>
  </section>
</template>

<style scoped>
.heading{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.heading h2{margin:6px 0}.heading p{max-width:760px;margin:0;color:#758196;line-height:1.6;font-size:13px}.filters{display:flex;align-items:end;gap:12px;margin-bottom:14px}.filters label,.dialog>label{display:grid;gap:6px;color:#5d6c80;font-size:12px}.filters select,.dialog input{min-height:38px;padding:0 10px;border:1px solid #dce3ec;border-radius:8px;background:#fff}.secondary{background:#eef3f9;color:#2b517d}.success{padding:9px 12px;border-radius:8px;background:#edf9f1;color:#287447}.table-scroll{overflow-x:auto}table{width:100%;min-width:720px;border-collapse:collapse}th,td{padding:12px 10px;border-bottom:1px solid #edf0f4;text-align:left;vertical-align:top}th{background:#f7f9fc;color:#778398;font-size:12px}.enabled,.disabled{padding:4px 9px;border-radius:999px;font-size:11px}.enabled{background:#e6f7ed;color:#24744a}.disabled{background:#f2f3f5;color:#777f8c}.actions{white-space:nowrap}.text{padding:4px 7px;border:0;background:transparent;color:#2e6fbe;box-shadow:none}.danger{color:#c43232}.store-pills{display:flex;flex-wrap:wrap;gap:6px}.store-pills span{padding:4px 8px;border-radius:7px;background:#f2f5f9;color:#4c5a70;font-size:12px}.backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:18px;background:#10182888}.dialog{box-sizing:border-box;width:min(560px,100%);max-height:90vh;overflow:auto;padding:22px}.dialog h3{margin:0 0 16px}.dialog>label{margin-top:14px}fieldset{margin:18px 0 0;padding:14px;border:1px solid #e1e7ee;border-radius:10px}legend{padding:0 6px;color:#58677d;font-size:13px}.store-rate{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0}.store-check{display:flex;align-items:center;gap:8px}.store-check input{min-height:auto}.store-rate>input{width:160px}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}@media(max-width:650px){.heading{display:block}.heading button{margin-top:12px}.store-rate{align-items:flex-start;flex-direction:column}.store-rate>input{box-sizing:border-box;width:100%}}
.schedule-badge{display:block;width:max-content;margin-top:5px;padding:3px 7px;border-radius:999px;background:#eaf4ff;color:#2863a6;font-size:11px}
.schedule-setting{display:flex!important;align-items:center;gap:8px;padding:11px;border-radius:9px;background:#fff5ed;color:#9c4b20!important;font-size:13px!important}
.schedule-setting input{min-height:auto!important}
</style>
