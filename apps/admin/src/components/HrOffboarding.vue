<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string; permissionCodes: string[] }
type Employee = { id: number; displayName: string; status: string }
type Application = { id: number; employeeName: string; storeId: number; effectiveDate: string;
  reason: string; status: string; failureCode: string | null; rejectionReason?: string | null; deleteAccountOnEffective: boolean }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[] }>()
const storeId = ref('ALL')
const employeeId = ref('')
const effectiveDate = ref('')
const reason = ref('')
const deleteAccountOnEffective = ref(true)
const decisionReason = ref('')
const employees = ref<Employee[]>([])
const applications = ref<Application[]>([])
const busy = ref(false)
const error = ref('')
const message = ref('')
const correctionTarget = ref<Application | null>(null)
const correctionDate = ref('')
const correctionReason = ref('')
const correctionDeleteAccount = ref(true)
const page = ref(1), pageSize = ref(20)
const pagedApplications = computed(() => applications.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const selectedStore = computed(() => props.stores.find(item => String(item.id) === storeId.value))
const canRequest = computed(() => selectedStore.value?.permissionCodes.includes('HR_OFFBOARDING_REQUEST') ?? false)
const canApprove = computed(() => selectedStore.value?.permissionCodes.includes('HR_OFFBOARDING_APPROVE') ?? false)
const canRequestFor = (item: Application) => props.stores.some(store => store.id === item.storeId && store.permissionCodes.includes('HR_OFFBOARDING_REQUEST'))

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init,
    headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '操作失败')
  return data
}
async function load() {
  error.value = ''; message.value = ''; employees.value = []; applications.value = []
  busy.value = true
  try {
    const storeQuery = storeId.value === 'ALL' ? '' : `?storeId=${encodeURIComponent(storeId.value)}`
    const [people, requests] = await Promise.all([
      storeId.value !== 'ALL' && canRequest.value && selectedStore.value?.permissionCodes.includes('HR_EMPLOYEE_LIST_READ')
        ? api(`/api/hr/employees?storeId=${storeId.value}`) : Promise.resolve([]),
      api(`/api/hr/offboarding${storeQuery}`),
    ])
    employees.value = people; applications.value = requests
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取失败' }
  finally { busy.value = false }
}
onMounted(load)
async function submit() {
  if (!canRequest.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api('/api/hr/offboarding', { method: 'POST', body: JSON.stringify({
      employeeId: Number(employeeId.value), storeId: Number(storeId.value),
      effectiveDate: effectiveDate.value, reason: reason.value.trim(),
      deleteAccountOnEffective: deleteAccountOnEffective.value,
    }) })
    employeeId.value = ''; reason.value = ''; deleteAccountOnEffective.value = true
    await load(); message.value = '离职申请已提交。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '提交失败' }
  finally { busy.value = false }
}
async function decide(item: Application, decision: 'APPROVE' | 'REJECT') {
  if (!canApprove.value) return
  if (decision === 'REJECT' && !decisionReason.value.trim()) { error.value = '请填写拒绝原因'; return }
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api(`/api/hr/offboarding/${item.id}/decisions`, { method: 'POST',
      body: JSON.stringify({ decision, reason: decisionReason.value.trim() }) })
    decisionReason.value = ''; await load(); message.value = '审批决定已记录。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '审批失败' }
  finally { busy.value = false }
}
function openCorrection(item: Application) {
  correctionTarget.value = item; correctionDate.value = item.effectiveDate
  correctionReason.value = item.reason; correctionDeleteAccount.value = item.deleteAccountOnEffective
}
async function resubmit() {
  const item = correctionTarget.value
  if (!item || !correctionDate.value || !correctionReason.value.trim()) { error.value = '请填写生效日期和原因'; return }
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api(`/api/hr/offboarding/${item.id}/resubmit`, { method: 'POST', body: JSON.stringify({
      effectiveDate: correctionDate.value, reason: correctionReason.value.trim(),
      deleteAccountOnEffective: correctionDeleteAccount.value,
    }) })
    correctionTarget.value = null; await load(); message.value = '原申请已更正并重新提交审批。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '重新提交失败' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="card hr-offboarding"><h2>员工离职</h2>
    <p>离职生效后保留任职与工时历史；未处理转店、后续排班或工时会阻止生效。</p>
    <div class="row"><label>查看门店<select v-model="storeId" @change="load"><option value="ALL">全部授权门店</option>
      <option v-for="store in stores" :key="store.id" :value="String(store.id)">{{ store.storeName }}</option></select></label>
      <button :disabled="busy || !storeId" @click="load">刷新</button></div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <template v-if="canRequest"><h3>发起申请</h3><div class="row"><label>员工<select v-model="employeeId">
      <option value="">请选择</option><option v-for="person in employees.filter(item => item.status === 'ACTIVE')"
        :key="person.id" :value="String(person.id)">{{ person.displayName }}</option></select></label>
      <label>离职生效日<input v-model="effectiveDate" type="date" /></label>
      <label>原因<input v-model="reason" maxlength="1000" /></label>
      <label class="account-choice"><input v-model="deleteAccountOnEffective" type="checkbox" />离职生效时删除登录账号（默认勾选）</label>
      <button :disabled="busy || !employeeId || !effectiveDate || !reason.trim()" @click="submit">提交审批</button></div></template>
    <h3>申请记录</h3><label v-if="canApprove">拒绝原因<input v-model="decisionReason" maxlength="1000" /></label>
    <div class="table-scroll"><table><thead><tr><th>员工</th><th>生效日</th><th>原因</th><th>生效时删除账号</th><th>状态</th><th>失败原因</th><th>操作</th></tr></thead>
      <tbody><tr v-for="item in pagedApplications" :key="item.id"><td>{{ item.employeeName }}</td>
        <td>{{ item.effectiveDate }}</td><td>{{ item.reason }}</td><td>{{ item.deleteAccountOnEffective ? '是' : '否' }}</td><td>{{ item.status }}</td>
        <td>{{ item.rejectionReason || item.failureCode || '—' }}</td><td><button v-if="canRequestFor(item) && item.status === 'REJECTED'" class="secondary" @click="openCorrection(item)">修改并重提</button><template v-if="canApprove && item.status === 'SUBMITTED'">
          <button :disabled="busy" @click="decide(item, 'APPROVE')">通过</button>
          <button class="secondary" :disabled="busy" @click="decide(item, 'REJECT')">拒绝</button>
        </template></td></tr></tbody></table></div><PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="applications.length" />
  </section>
  <div v-if="correctionTarget" class="correction-backdrop" @click.self="correctionTarget = null"><section class="correction-dialog card">
    <h3>更正离职申请</h3><p>{{ correctionTarget.employeeName }} · 原申请 #{{ correctionTarget.id }}</p>
    <label>离职生效日<input v-model="correctionDate" type="date" /></label>
    <label>离职原因<textarea v-model="correctionReason" maxlength="1000" /></label>
    <label class="account-choice"><input v-model="correctionDeleteAccount" type="checkbox" />生效时删除登录账号</label>
    <div class="correction-actions"><button class="secondary" @click="correctionTarget = null">取消</button>
      <button :disabled="busy || !correctionDate || !correctionReason.trim()" @click="resubmit">保存并重新提交</button></div>
  </section></div>
</template>

<style scoped>
.hr-offboarding h2{margin:0 0 8px}.hr-offboarding h3{margin:22px 0 8px}.hr-offboarding p{color:#64748b}
.row{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:14px 0}.row label{display:grid;gap:6px;min-width:180px}
input,select{min-height:38px}.secondary{background:#eef3f9;color:#2b517d}.table-scroll{overflow:auto}
table{width:100%;min-width:850px}td button{margin-right:6px}.row label.account-choice{display:flex;align-items:center;gap:8px;min-width:280px;padding:9px 11px;border-radius:8px;background:#fff5ef;color:#344054}.account-choice input{width:16px;height:16px}
.correction-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:18px;background:#10182888}.correction-dialog{width:min(520px,100%);padding:22px}.correction-dialog label{display:grid;gap:7px;margin:12px 0}.correction-dialog input,.correction-dialog textarea{min-height:40px;padding:8px 10px;border:1px solid #d7dee8;border-radius:8px}.correction-dialog .account-choice{display:flex;align-items:center;gap:8px}.correction-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
</style>

