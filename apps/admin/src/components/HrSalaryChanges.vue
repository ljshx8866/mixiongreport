<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string; permissionCodes: string[] }
type Employee = { id: number; displayName: string; status: string }
type Change = { id: number; employeeName: string; effectiveDate: string; hourlyRate: string;
  status: string; failureCode: string | null; agreementReference: string | null }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[] }>()
const storeId = ref('ALL')
const employeeId = ref('')
const effectiveDate = ref('')
const hourlyRate = ref('')
const reason = ref('')
const agreementReference = ref('')
const decisionReason = ref('')
const employees = ref<Employee[]>([])
const changes = ref<Change[]>([])
const busy = ref(false)
const error = ref('')
const message = ref('')
const page = ref(1), pageSize = ref(20)
const pagedChanges = computed(() => changes.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const selectedStore = computed(() => props.stores.find(item => String(item.id) === storeId.value))
const canRequest = computed(() => selectedStore.value?.permissionCodes.includes('HR_SALARY_CHANGE_REQUEST') ?? false)
const canApprove = computed(() => selectedStore.value?.permissionCodes.includes('HR_SALARY_CHANGE_APPROVE') ?? false)
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init,
    headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '操作失败')
  return data
}
async function load() {
  error.value = ''; employees.value = []; changes.value = []
  busy.value = true
  try {
    const storeQuery = storeId.value === 'ALL' ? '' : `?storeId=${encodeURIComponent(storeId.value)}`
    const [people, applications] = await Promise.all([
      storeId.value !== 'ALL' && canRequest.value && selectedStore.value?.permissionCodes.includes('HR_EMPLOYEE_LIST_READ')
        ? api(`/api/hr/employees?storeId=${storeId.value}`) : Promise.resolve([]),
      api(`/api/hr/salary-changes${storeQuery}`),
    ])
    employees.value = people; changes.value = applications
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取失败' }
  finally { busy.value = false }
}
onMounted(load)
async function submit() {
  if (!canRequest.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api('/api/hr/salary-changes', { method: 'POST', body: JSON.stringify({
      employeeId: Number(employeeId.value), storeId: Number(storeId.value),
      effectiveDate: effectiveDate.value, hourlyRate: hourlyRate.value.trim(),
      reason: reason.value.trim(), agreementReference: agreementReference.value.trim(),
    }) })
    hourlyRate.value = ''; reason.value = ''; agreementReference.value = ''
    await load(); message.value = '时薪变动已提交审批。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '提交失败' }
  finally { busy.value = false }
}
async function decide(change: Change, decision: 'APPROVE' | 'REJECT') {
  if (!canApprove.value) return
  if (decision === 'REJECT' && !decisionReason.value.trim()) { error.value = '请填写拒绝原因'; return }
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api(`/api/hr/salary-changes/${change.id}/decisions`, { method: 'POST',
      body: JSON.stringify({ decision, reason: decisionReason.value.trim() }) })
    decisionReason.value = ''; await load(); message.value = '审批决定已记录。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '审批失败' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="card hr-salary"><h2>调薪申请</h2>
    <p>按生效日期保存历史时薪，降薪申请须填写书面协议编号。月审按班次统计工时计算每日基础应发。</p>
    <div class="row"><label>查看门店<select v-model="storeId" @change="load"><option value="ALL">全部授权门店</option>
      <option v-for="store in stores" :key="store.id" :value="String(store.id)">{{ store.storeName }}</option></select></label>
      <button :disabled="busy || !storeId" @click="load">刷新</button></div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <template v-if="canRequest"><h3>申请变动</h3><div class="row"><label>员工<select v-model="employeeId">
      <option value="">请选择</option><option v-for="person in employees.filter(item => item.status === 'ACTIVE')"
        :key="person.id" :value="String(person.id)">{{ person.displayName }}</option></select></label>
      <label>生效日<input v-model="effectiveDate" type="date" /></label>
      <label>新时薪（元）<input v-model="hourlyRate" inputmode="decimal" placeholder="例如 18.50" /></label>
      <label>原因<input v-model="reason" maxlength="1000" /></label>
      <label>书面协议编号（降薪必填）<input v-model="agreementReference" maxlength="200" /></label>
      <button :disabled="busy || !employeeId || !effectiveDate || !hourlyRate || !reason.trim()" @click="submit">提交审批</button></div></template>
    <h3>变动记录</h3><label v-if="canApprove">拒绝原因<input v-model="decisionReason" maxlength="1000" /></label>
    <div class="table-scroll"><table><thead><tr><th>员工</th><th>生效日</th><th>新时薪</th><th>状态</th><th>协议编号</th><th>失败原因</th><th>操作</th></tr></thead>
      <tbody><tr v-for="change in pagedChanges" :key="change.id"><td>{{ change.employeeName }}</td>
        <td>{{ change.effectiveDate }}</td><td>{{ change.hourlyRate }}</td><td>{{ change.status }}</td>
        <td>{{ change.agreementReference ?? '—' }}</td><td>{{ change.failureCode ?? '—' }}</td>
        <td><template v-if="canApprove && change.status === 'SUBMITTED'">
          <button :disabled="busy" @click="decide(change, 'APPROVE')">通过</button>
          <button class="secondary" :disabled="busy" @click="decide(change, 'REJECT')">拒绝</button>
        </template></td></tr></tbody></table></div><PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="changes.length" />
  </section>
</template>

<style scoped>
.hr-salary h2{margin:0 0 8px}.hr-salary h3{margin:22px 0 8px}.hr-salary p{color:#64748b}
.row{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:14px 0}.row label{display:grid;gap:6px;min-width:180px}
input,select{min-height:38px}.secondary{background:#eef3f9;color:#2b517d}.table-scroll{overflow:auto}
table{width:100%;min-width:850px}td button{margin-right:6px}
</style>

