<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string; permissionCodes: string[] }
type Employee = { id: number; displayName: string }
type RequestRow = { id: number; employeeId: number; employeeName: string; status: string;
  revision: number; accountName: string; bankName: string; branchName: string; cardNumber: string;
  createdAt: string; appliedAt: string | null; failureCode: string | null }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[] }>()
const storeId = ref('ALL')
const employeeId = ref('')
const employees = ref<Employee[]>([])
const requests = ref<RequestRow[]>([])
const cardNumber = ref('')
const bankName = ref('')
const branchName = ref('')
const confirmedOriginals = ref(false)
const decisionReason = ref('')
const busy = ref(false)
const error = ref('')
const message = ref('')
const page = ref(1), pageSize = ref(20)
const pagedRequests = computed(() => requests.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const store = computed(() => props.stores.find(item => String(item.id) === storeId.value))
const canVerify = computed(() => store.value?.permissionCodes.includes('HR_BANK_CHANGE_VERIFY') ?? false)
const canApprove = computed(() => store.value?.permissionCodes.includes('HR_BANK_CHANGE_APPROVE') ?? false)
const selectedEmployee = computed(() => employees.value.find(item => String(item.id) === employeeId.value))

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${props.apiBase}${path}`, { ...init,
    headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '操作失败')
  return data as T
}
async function load() {
  error.value = ''; message.value = ''; employees.value = []; requests.value = []; employeeId.value = ''
  busy.value = true
  try {
    const storeQuery = storeId.value === 'ALL' ? '' : `?storeId=${encodeURIComponent(storeId.value)}`
    const [rows, people] = await Promise.all([
      api<RequestRow[]>(`/api/hr/bank-changes${storeQuery}`),
      storeId.value !== 'ALL' && canVerify.value ? api<Employee[]>(`/api/hr/bank-changes/employees?storeId=${encodeURIComponent(storeId.value)}`) : Promise.resolve([]),
    ])
    requests.value = rows; employees.value = people
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取银行卡变更记录失败' }
  finally { busy.value = false }
}
function statusText(status: string) {
  return ({ SUBMITTED: '待审批', APPROVED: '已通过', REJECTED: '已驳回', APPLIED: '已生效',
    APPLY_FAILED: '生效失败' } as Record<string, string>)[status] ?? '处理中'
}
function failureText(code: string | null) {
  if (!code) return '—'
  return ({ PHONE_REQUIRED: '手机号无效', PHONE_ACCOUNT_LINKED: '手机号已关联其他员工',
    PHONE_ACCOUNT_DISABLED: '手机号对应账号已停用', SOURCE_CHANGED: '核验资料已变化',
    ACCOUNT_ROLE_UNAVAILABLE: '账号权限不可用', JOB_POSITION_UNAVAILABLE: '岗位已停用',
    NETWORK_OR_PROVIDER_ERROR: '服务暂时异常' } as Record<string, string>)[code] ?? '处理未完成，请联系管理员核实'
}
onMounted(load)
async function submit() {
  if (!employeeId.value || !confirmedOriginals.value || !canVerify.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api(`/api/hr/bank-changes/employees/${employeeId.value}/submit`, { method: 'POST', body: JSON.stringify({
      accountName: selectedEmployee.value?.displayName, cardNumber: cardNumber.value,
      bankName: bankName.value, branchName: branchName.value, confirmedOriginals: true,
    }) })
    employeeId.value = ''; cardNumber.value = ''; bankName.value = ''; branchName.value = ''
    confirmedOriginals.value = false
    message.value = '银行卡变更资料已加密保存并提交审批；审批前当前账户保持有效。'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '提交失败' }
  finally { cardNumber.value = ''; busy.value = false }
}
async function decide(item: RequestRow, decision: 'APPROVE' | 'REJECT') {
  if (decision === 'REJECT' && !decisionReason.value.trim()) { error.value = '请填写拒绝原因'; return }
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api(`/api/hr/bank-changes/${item.id}/decisions`, { method: 'POST', body: JSON.stringify({
      decision, reason: decisionReason.value.trim(),
    }) })
    decisionReason.value = ''; message.value = decision === 'APPROVE' ? '审批已记录；全部审批通过后新账户立即生效。' : '拒绝决定已记录。'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '审批失败' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="card bank-changes">
    <h2>银行卡变更</h2>
    <p>门店现场核验员工本人及新银行卡资料。卡号加密保存，授权人员可查看完整资料；全部配置审批通过后立即启用新版本。</p>
    <div class="toolbar"><label>查看门店<select v-model="storeId" @change="load"><option value="ALL">全部授权门店</option>
      <option v-for="item in stores.filter(value => value.permissionCodes.includes('HR_BANK_CHANGE_LIST_READ') || value.permissionCodes.includes('HR_BANK_CHANGE_VERIFY') || value.permissionCodes.includes('HR_BANK_CHANGE_APPROVE'))"
        :key="item.id" :value="String(item.id)">{{ item.storeName }}</option></select></label>
      <button :disabled="busy || !storeId" @click="load">刷新</button></div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <div v-if="canVerify" class="form-panel">
      <h3>现场核验并提交变更</h3>
      <div class="fields"><label>员工<select v-model="employeeId"><option value="">请选择</option>
        <option v-for="person in employees" :key="person.id" :value="String(person.id)">{{ person.displayName }}</option></select></label>
        <label>开户人<input :value="selectedEmployee?.displayName ?? ''" readonly /></label>
        <label>银行卡号<input v-model="cardNumber" type="text" autocomplete="off" inputmode="numeric" /></label>
        <label>开户银行<input v-model="bankName" autocomplete="off" /></label>
        <label>支行（选填）<input v-model="branchName" autocomplete="off" /></label>
      </div>
      <label class="confirm"><input v-model="confirmedOriginals" type="checkbox" />我已在门店现场核验员工本人及银行卡原件</label>
      <button :disabled="busy || !employeeId || !cardNumber || !bankName || !confirmedOriginals" @click="submit">加密保存并提交审批</button>
    </div>
    <h3>变更申请记录</h3>
    <label v-if="canApprove" class="reject-reason">拒绝原因<input v-model="decisionReason" maxlength="500" /></label>
    <div class="scroll"><table><thead><tr><th>员工</th><th>开户人</th><th>开户银行</th><th>银行卡号</th><th>申请时间</th><th>状态</th><th>失败原因</th><th>操作</th></tr></thead>
      <tbody><tr v-for="item in pagedRequests" :key="item.id"><td>{{ item.employeeName }}</td><td>{{ item.accountName }}</td>
        <td>{{ item.bankName }}<small v-if="item.branchName">{{ item.branchName }}</small></td><td>{{ item.cardNumber }}</td>
        <td>{{ new Date(item.createdAt).toLocaleString() }}</td><td>{{ statusText(item.status) }}</td><td>{{ failureText(item.failureCode) }}</td>
        <td><template v-if="canApprove && item.status === 'SUBMITTED'"><button :disabled="busy" @click="decide(item, 'APPROVE')">通过</button>
          <button class="secondary" :disabled="busy" @click="decide(item, 'REJECT')">拒绝</button></template></td></tr>
        <tr v-if="!requests.length"><td colspan="8" class="empty">暂无银行卡变更记录</td></tr></tbody></table></div><PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="requests.length" />
  </section>
</template>

<style scoped>
.bank-changes h2{margin:0 0 8px}.bank-changes p{color:#657388}.toolbar{display:flex;align-items:end;gap:12px;margin:18px 0}.toolbar label,.fields label,.reject-reason{display:grid;gap:6px}.form-panel{margin:20px 0;padding:18px;border:1px solid #e7edf4;border-radius:14px;background:#f9fbfd}.form-panel h3,.bank-changes h3{margin:0 0 14px}.fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wide{grid-column:span 2}.fields input,.fields select,.toolbar select,.reject-reason input{min-height:38px;max-width:100%}.confirm{display:flex;align-items:center;gap:8px;margin:16px 0}.confirm input{min-height:initial}.scroll{overflow:auto;margin-top:12px}table{width:100%;min-width:780px}td button{margin-right:6px}.secondary{background:#eef3f9;color:#2b517d}.empty{text-align:center;color:#8793a4}@media(max-width:800px){.fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.fields{grid-template-columns:1fr}.wide{grid-column:auto}}
</style>

