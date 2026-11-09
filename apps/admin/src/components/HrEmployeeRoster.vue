<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string; permissionCodes?: string[] }
type Employee = { id: number; displayName: string; status: 'DRAFT' | 'ACTIVE' | 'TERMINATED'; userId: number | null;
  jobPositionId: number | null; jobPositionName: string | null; jobPositionScheduleOnly: boolean;
  initialStoreId: number | null; onboardingStatus: string | null; onboardingFailureCode: string | null;
  onboardingApprovalStatus: string | null;
  appointments: { storeId: number; storeName: string; effectiveFrom: string; effectiveToExclusive: string | null }[] }
type EmployeeProfile = { id: number; displayName: string; status: string; userId: number | null;
  storeId: number | null; jobPosition: { id: number; name: string; scheduleOnly: boolean } | null;
  identity: Record<string, string | null> | null; bank: Record<string, string | null> | null;
  appointments: { storeId: number; storeName: string; effectiveFrom: string; effectiveToExclusive: string | null }[] }
type Position = { id: number; name: string; scheduleOnly: boolean; hourlyRate: string | null }
type AccountCandidate = { id: number; name: string; mobile: string | null; linked: boolean }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[]; isAdmin?: boolean }>()
const storeId = ref('ALL')
const status = ref('ALL')
const search = ref('')
const employees = ref<Employee[]>([])
const busy = ref(false)
const error = ref('')
const initialized = ref(false)
const page = ref(1), pageSize = ref(20)
const deleteTarget = ref<Employee | null>(null)
const deleteReason = ref('')
const deleteLinkedAccount = ref(true)
const deleting = ref(false)
const detail = ref<EmployeeProfile | null>(null)
const detailLoading = ref(false)
const editOpen = ref(false)
const editSaving = ref(false)
const editName = ref('')
const editPhone = ref('')
const editAddress = ref('')
const editPositionId = ref<number | null>(null)
const positions = ref<Position[]>([])
const accountLinkTarget = ref<Employee | null>(null)
const accountQuery = ref('')
const accountCandidates = ref<AccountCandidate[]>([])
const accountCandidatesLoading = ref(false)
const accountLinkSaving = ref(false)
const visibleEmployees = computed(() => employees.value.filter(employee => status.value === 'ALL' || employee.status === status.value))
const pagedEmployees = computed(() => visibleEmployees.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch([status, search], () => { page.value = 1 })
watch(storeId, () => { page.value = 1; if (initialized.value) void load() })

async function load() {
  busy.value = true; error.value = ''
  try {
    const query = new URLSearchParams({ status: 'ALL', q: search.value.trim() })
    if (storeId.value !== 'ALL') query.set('storeId', storeId.value)
    const response = await fetch(`${props.apiBase}/api/hr/employees?${query}`, { headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '员工列表读取失败')
    employees.value = Array.isArray(data) ? data : []
    initialized.value = true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '员工列表读取失败' }
  finally { busy.value = false }
}

async function permanentlyDelete() {
  if (!deleteTarget.value || deleteReason.value.trim().length < 5) return
  deleting.value = true; error.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/hr/employees/${deleteTarget.value.id}/permanent`, {
      method: 'DELETE', headers: props.headers(), body: JSON.stringify({
        reason: deleteReason.value.trim(), deleteAccount: deleteLinkedAccount.value,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '删除员工失败')
    deleteTarget.value = null; deleteReason.value = ''; await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除员工失败' }
  finally { deleting.value = false }
}
function openPermanentDelete(employee: Employee) {
  deleteTarget.value = employee
  deleteReason.value = ''
  deleteLinkedAccount.value = true
}
async function openDetail(employee: Employee) {
  detailLoading.value = true; error.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/hr/employees/${employee.id}`, { headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '员工资料读取失败')
    detail.value = data as EmployeeProfile
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '员工资料读取失败' }
  finally { detailLoading.value = false }
}
async function openAccountLink(employee: Employee) {
  if (!canEdit(employee)) return
  accountLinkTarget.value = employee
  accountQuery.value = ''
  accountCandidates.value = []
  await loadAccountCandidates()
}
async function loadAccountCandidates() {
  if (!accountLinkTarget.value) return
  const target = accountLinkTarget.value
  const targetStoreId = employeeStoreId(target)
  if (!targetStoreId) { error.value = '员工门店信息不完整'; return }
  accountCandidatesLoading.value = true; error.value = ''
  try {
    const query = new URLSearchParams({ employeeId: String(target.id), storeId: String(targetStoreId), q: accountQuery.value.trim() })
    const response = await fetch(`${props.apiBase}/api/hr/employees/account-candidates?${query}`, { headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '账号候选读取失败')
    accountCandidates.value = Array.isArray(data) ? data : []
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '账号候选读取失败' }
  finally { accountCandidatesLoading.value = false }
}
async function setLinkedAccount(userId: number | null) {
  if (!accountLinkTarget.value || accountLinkSaving.value) return
  const target = accountLinkTarget.value
  accountLinkSaving.value = true; error.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/hr/employees/${target.id}/link-account`, {
      method: 'POST', headers: props.headers(), body: JSON.stringify({ userId }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '员工账号关联失败')
    accountLinkTarget.value = null
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '员工账号关联失败' }
  finally { accountLinkSaving.value = false }
}
function employeeStoreId(employee: Employee) {
  return employee.appointments[0]?.storeId ?? employee.initialStoreId
}
function canEdit(employee: Employee) {
  const storeId = employeeStoreId(employee)
  return storeId != null && props.stores.some(item => item.id === storeId &&
    item.permissionCodes?.includes('HR_EMPLOYEE_EDIT') && item.permissionCodes?.includes('HR_EMPLOYEE_DETAIL_READ'))
}
function canLinkAccount(employee: Employee) {
  const storeId = employeeStoreId(employee)
  return storeId != null && props.stores.some(item => item.id === storeId && item.permissionCodes?.includes('HR_EMPLOYEE_ACCOUNT_LINK'))
}
function canReadDetail(employee: Employee) {
  const storeId = employeeStoreId(employee)
  return storeId != null && props.stores.some(item => item.id === storeId && item.permissionCodes?.includes('HR_EMPLOYEE_DETAIL_READ'))
}
function canEditSensitive(storeId: number | null) {
  return storeId != null && props.stores.some(item => item.id === storeId &&
    item.permissionCodes?.includes('HR_EMPLOYEE_SENSITIVE_READ') && item.permissionCodes?.includes('HR_EMPLOYEE_SENSITIVE_EDIT'))
}
async function startEdit(employee: Employee) {
  if (!canEdit(employee)) return
  await openDetail(employee)
  if (!detail.value?.storeId) return
  editName.value = detail.value.displayName
  editPhone.value = detail.value.identity?.phone ?? ''
  editAddress.value = detail.value.identity?.address ?? ''
  editPositionId.value = detail.value.jobPosition?.id ?? null
  editOpen.value = true
  try {
    const response = await fetch(`${props.apiBase}/api/hr/job-positions/selectable?storeId=${detail.value.storeId}`, { headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '岗位列表读取失败')
    positions.value = Array.isArray(data) ? data : []
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '岗位列表读取失败' }
}
async function saveProfile() {
  if (!detail.value) return
  editSaving.value = true; error.value = ''
  try {
    const body: Record<string, unknown> = { displayName: editName.value.trim(), jobPositionId: editPositionId.value }
    if (canEditSensitive(detail.value.storeId)) {
      body.phone = editPhone.value.trim()
      body.address = editAddress.value.trim()
    }
    const response = await fetch(`${props.apiBase}/api/hr/employees/${detail.value.id}`, {
      method: 'PATCH', headers: props.headers(), body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '员工资料保存失败')
    const employeeId = detail.value.id
    editOpen.value = false
    await load()
    const updated = employees.value.find(item => item.id === employeeId)
    if (updated) await openDetail(updated)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '员工资料保存失败' }
  finally { editSaving.value = false }
}

function statusLabel(employee: Employee) {
  if (employee.status === 'ACTIVE') return '在职'
  if (employee.status === 'TERMINATED') return '已离职'
  if (employee.onboardingStatus === 'EFFECTIVE_FAILED') {
    if (employee.onboardingFailureCode === 'PHONE_REQUIRED') return '待补手机号'
    if (employee.onboardingFailureCode === 'PHONE_ACCOUNT_LINKED') return '手机号账号冲突'
    if (employee.onboardingFailureCode === 'PHONE_ACCOUNT_DISABLED') return '手机号账号已停用'
    if (employee.onboardingFailureCode === 'PHONE_ACCOUNT_AMBIGUOUS') return '手机号账号重复'
    return '入职生效异常'
  }
  if (employee.onboardingStatus === 'APPROVED_AWAITING_EFFECTIVE') return '审批通过·待生效'
  if (employee.onboardingStatus === 'REJECTED') return '已退回待修改'
  if (employee.onboardingStatus === 'SUBMITTED') return '待审批'
  return '待提交入职'
}
function statusDetail(employee: Employee) {
  if (employee.status !== 'DRAFT') return ''
  if (employee.onboardingStatus === 'EFFECTIVE_FAILED') {
    const reason: Record<string, string> = {
      PHONE_REQUIRED: '手机号缺失或格式无效',
      PHONE_ACCOUNT_LINKED: '该手机号已关联其他员工',
      PHONE_ACCOUNT_DISABLED: '该手机号对应账号已停用',
      PHONE_ACCOUNT_AMBIGUOUS: '发现多个手机号相同的账号，请先修正手机号',
      SOURCE_CHANGED: '入职资料发生变化，请重新核对',
    }
    const prefix = employee.onboardingApprovalStatus === 'APPROVED' ? '审批已通过，入职未生效' : '入职未生效'
    return `${prefix}${employee.onboardingFailureCode ? `：${reason[employee.onboardingFailureCode] ?? '请联系管理员'}` : ''}`
  }
  if (employee.onboardingStatus === 'APPROVED_AWAITING_EFFECTIVE') return '审批已通过，等待生效日期'
  if (employee.onboardingStatus === 'REJECTED') return '申请已退回，可修改资料后重提'
  if (employee.onboardingStatus === 'SUBMITTED') return employee.onboardingApprovalStatus === 'APPROVED'
    ? '审批决定已通过，入职流程仍在处理中' : '入职资料已提交，等待审批'
  return '尚未提交入职申请'
}
function storeName(id: number | null) { return props.stores.find(item => item.id === id)?.storeName ?? '—' }
onMounted(load)
</script>

<template>
  <section class="card roster">
    <div class="roster-heading"><div><h2>员工列表</h2><p>按权限查看与编辑员工档案；账号权限在账号管理中单独设置。</p></div>
      <span class="count">{{ visibleEmployees.length }} 人</span></div>
    <form class="filters" @submit.prevent="load">
      <label>门店<select v-model="storeId"><option value="ALL">全部授权门店</option>
        <option v-for="store in stores" :key="store.id" :value="String(store.id)">{{ store.storeName }}</option>
      </select></label>
      <label>状态<select v-model="status"><option value="ALL">全部状态</option><option value="ACTIVE">在职</option><option value="TERMINATED">已离职</option>
        <option value="DRAFT">待入职处理</option></select></label>
      <label class="search-field">姓名<input v-model="search" maxlength="100" placeholder="搜索员工姓名" /></label>
      <button :disabled="busy">{{ busy ? '查询中…' : '查询' }}</button>
    </form>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p>
    <div v-if="visibleEmployees.length" class="table-scroll"><table><thead><tr>
      <th>员工编号</th><th>姓名</th><th>岗位</th><th>状态</th><th>登录账号</th><th>任职时间</th><th>查看资料</th><th v-if="isAdmin">操作</th>
    </tr></thead><tbody><tr v-for="employee in pagedEmployees" :key="employee.id">
      <td>#{{ employee.id }}</td><td class="employee-name">{{ employee.displayName }}</td>
      <td>{{ employee.jobPositionName || '—' }}<small v-if="employee.jobPositionScheduleOnly" class="position-note">仅排班，不计工时</small></td>
      <td><span class="status-pill" :class="employee.status.toLowerCase()">{{ statusLabel(employee) }}</span><small v-if="statusDetail(employee)" class="status-detail">{{ statusDetail(employee) }}</small></td>
      <td><span>{{ employee.userId == null ? '未关联' : `账号 #${employee.userId}` }}</span>
        <button v-if="canLinkAccount(employee)" class="detail-link account-link-action" @click="openAccountLink(employee)">{{ employee.userId == null ? '关联账号' : '更换关联' }}</button></td>
      <td>{{ employee.appointments.map(item => `${item.storeName} · ${item.effectiveFrom} 至 ${item.effectiveToExclusive ?? '至今'}`).join('；') || storeName(employee.initialStoreId) }}</td>
      <td><button v-if="canReadDetail(employee)" class="detail-link" :disabled="detailLoading" @click="openDetail(employee)">查看详细资料</button>
        <button v-if="canEdit(employee)" class="detail-link" :disabled="detailLoading" @click="startEdit(employee)">编辑</button></td>
      <td v-if="isAdmin"><button class="danger" @click="openPermanentDelete(employee)">彻底删除</button></td>
    </tr></tbody></table></div>
    <PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="visibleEmployees.length" />
    <div v-if="!visibleEmployees.length && initialized && !busy" class="empty">没有符合条件的员工。</div>
    <div v-if="!visibleEmployees.length && !initialized" class="empty">选择门店并查询员工名册。</div>
  </section>
  <div v-if="deleteTarget" class="delete-backdrop" @click.self="deleteTarget = null"><section class="delete-dialog"><h3>彻底删除员工记录</h3><p>将永久删除“{{ deleteTarget.displayName }}”的员工档案及关联人事记录。该操作不可撤销。</p>
    <label v-if="deleteTarget.userId !== null" class="account-option"><input v-model="deleteLinkedAccount" type="checkbox" />同时删除关联登录账号（默认勾选）</label>
    <p v-if="deleteTarget.userId !== null && !deleteLinkedAccount" class="account-hint">登录账号会保留，员工与账号的关联将解除。</p>
    <label>删除原因<textarea v-model="deleteReason" maxlength="500" placeholder="请填写至少 5 个字的原因" /></label><div class="delete-actions"><button @click="deleteTarget = null">取消</button><button class="danger" :disabled="deleting || deleteReason.trim().length < 5" @click="permanentlyDelete">{{ deleting ? '删除中…' : '确认彻底删除' }}</button></div></section></div>
  <div v-if="detail || detailLoading" class="detail-backdrop" @click.self="detail = null"><section class="detail-dialog">
    <header><div><h3>{{ detail?.displayName || '员工资料' }}</h3><p v-if="detail">员工编号 #{{ detail.id }} · {{ detail.status === 'ACTIVE' ? '在职' : detail.status === 'TERMINATED' ? '已离职' : '入职资料' }}</p><p v-else>正在读取资料…</p></div>
      <button class="close" @click="detail = null">关闭</button></header>
    <template v-if="detail"><h4>个人资料</h4><div class="detail-row"><span>姓名</span><b>{{ detail.identity?.name || detail.displayName }}</b></div>
      <div class="detail-row"><span>手机号</span><b>{{ detail.identity?.phone || '未填写' }}</b></div>
      <div class="detail-row"><span>身份证号码</span><b>{{ detail.identity?.idNumber || '未填写' }}</b></div>
      <div class="detail-row"><span>性别 / 民族</span><b>{{ detail.identity?.sex || '—' }} / {{ detail.identity?.ethnicity || '—' }}</b></div>
      <div class="detail-row"><span>出生日期</span><b>{{ detail.identity?.birthDate || '未填写' }}</b></div>
      <div class="detail-row"><span>住址</span><b>{{ detail.identity?.address || '未填写' }}</b></div>
      <h4>银行卡资料</h4><div class="detail-row"><span>开户银行</span><b>{{ detail.bank?.bankName || '未填写' }}</b></div>
      <div class="detail-row"><span>开户支行</span><b>{{ detail.bank?.branchName || '未填写' }}</b></div>
      <div class="detail-row"><span>银行卡号</span><b>{{ detail.bank?.cardNumber || '未填写' }}</b></div>
      <h4>任职记录</h4><div v-for="(item, index) in detail.appointments" :key="`${item.storeId}-${index}`" class="detail-row">
        <span>{{ item.storeName }}</span><b>{{ item.effectiveFrom }} 至 {{ item.effectiveToExclusive || '至今' }}</b></div>
      <p v-if="!detail.appointments.length" class="detail-empty">暂无任职记录</p></template>
  </section></div>
  <div v-if="editOpen && detail" class="edit-backdrop" @click.self="editOpen = false"><section class="edit-dialog">
    <header><div><h3>编辑员工资料</h3><p>{{ detail.displayName }} · {{ storeName(detail.storeId) }}</p></div><button class="close" @click="editOpen = false">关闭</button></header>
    <label>姓名<input v-model="editName" maxlength="100" /></label>
    <label>岗位<select v-model="editPositionId"><option :value="null">未设置岗位</option>
      <option v-for="position in positions" :key="position.id" :value="position.id">{{ position.name }} · {{ position.scheduleOnly ? '仅排班' : `时薪 ${position.hourlyRate} 元` }}</option>
    </select></label>
    <template v-if="canEditSensitive(detail.storeId)">
      <label>手机号<input v-model="editPhone" type="tel" maxlength="11" placeholder="请输入 11 位手机号" /></label>
      <label>住址<textarea v-model="editAddress" maxlength="300" rows="3" /></label>
    </template>
    <p class="edit-note">账号权限保持不变，需要调整时请到账号管理单独设置。身份证和银行卡信息仍按对应资料流程修改。</p>
    <div class="edit-actions"><button @click="editOpen = false">取消</button><button class="save-edit" :disabled="editSaving" @click="saveProfile">{{ editSaving ? '保存中…' : '保存资料' }}</button></div>
  </section></div>
  <div v-if="accountLinkTarget" class="edit-backdrop" @click.self="accountLinkTarget = null"><section class="edit-dialog account-link-dialog">
    <header><div><h3>关联员工账号</h3><p>{{ accountLinkTarget.displayName }} · {{ storeName(employeeStoreId(accountLinkTarget)) }}</p></div><button class="close" @click="accountLinkTarget = null">关闭</button></header>
    <p class="edit-note">搜索该门店已启用的账号并关联。账号必须已管理该门店；此操作不更改账号权限或门店范围，资料手机号不一致时无法关联。</p>
    <form class="account-search" @submit.prevent="loadAccountCandidates"><input v-model="accountQuery" maxlength="100" placeholder="输入账号姓名或手机号，至少 2 个字符" /><button :disabled="accountCandidatesLoading">{{ accountCandidatesLoading ? '查询中…' : '搜索账号' }}</button></form>
    <div v-if="accountCandidatesLoading" class="account-candidates-empty">正在读取账号…</div>
    <div v-else-if="accountQuery.trim().length < 2" class="account-candidates-empty">请输入至少 2 个字符后搜索。</div>
    <div v-else-if="!accountCandidates.length" class="account-candidates-empty">没有找到可关联的同门店账号。</div>
    <div v-else class="account-candidates"><div v-for="account in accountCandidates" :key="account.id" class="account-candidate">
      <div><b>{{ account.name }}</b><span>{{ account.mobile || '未设置手机号' }} · 账号 #{{ account.id }}</span></div>
      <button :disabled="accountLinkSaving || account.linked" @click="setLinkedAccount(account.id)">{{ account.linked ? '当前账号' : accountLinkSaving ? '保存中…' : '关联此账号' }}</button>
    </div></div>
    <div v-if="accountLinkTarget.userId != null" class="edit-actions"><button :disabled="accountLinkSaving" @click="setLinkedAccount(null)">解除关联</button></div>
  </section></div>
</template>

<style scoped>
.roster-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.roster h2{margin:0}.roster p{margin:6px 0 0;color:#64748b}.count{padding:7px 12px;border-radius:999px;background:#fff1e8;color:#c95c24;font-weight:700;white-space:nowrap}.filters{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:22px 0}.filters label{display:grid;gap:6px;min-width:160px;color:#526176;font-size:13px}.filters select,.filters input{height:38px;border:1px solid #dce3ec;border-radius:8px;background:#fff;padding:0 10px;color:#26344b}.search-field{flex:1}.filters button{height:38px;padding:0 20px}.table-scroll{overflow:auto}.table-scroll table{width:100%;min-width:720px}.employee-name{font-weight:700}.status-pill{display:inline-block;padding:4px 9px;border-radius:999px;background:#eff3f8;color:#64748b}.status-pill.active{background:#e8f7ef;color:#208150}.status-pill.terminated{background:#f2f3f6;color:#717c8d}.status-pill.draft{background:#fff3e8;color:#b56427}.status-detail{display:block;margin-top:5px;color:#9a5a16;line-height:1.45;white-space:normal}.empty{padding:32px 12px;text-align:center;color:#8793a4}.error{color:#b42318}
.delete-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:18px;background:#10182888}.delete-dialog{width:min(520px,100%);padding:22px;border-radius:14px;background:#fff;box-shadow:0 22px 70px #10182855}.delete-dialog h3{margin:0}.delete-dialog p{line-height:1.7;color:#59677b}.delete-dialog label{display:grid;gap:7px;font-size:13px}.delete-dialog textarea{min-height:82px;padding:10px;border:1px solid #d7dee8;border-radius:8px;resize:vertical}.delete-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.delete-actions button{padding:8px 14px}.danger{border:0;border-radius:7px;background:#c53932;color:#fff}.danger:disabled{opacity:.5}
.delete-dialog label.account-option{display:flex;align-items:center;gap:9px;margin:14px 0;padding:11px;border-radius:8px;background:#fff5ef;color:#344054}.delete-dialog .account-option input{width:17px;height:17px}.delete-dialog .account-hint{margin:0 0 14px;color:#8a5b3d;font-size:13px}
.position-note{display:block;margin-top:4px;color:#34729c;font-size:11px}.detail-link{padding:5px 0;border:0;background:transparent;color:#c5521d}.detail-backdrop{position:fixed;inset:0;z-index:1210;display:grid;place-items:center;padding:18px;background:#10182888}.detail-dialog{box-sizing:border-box;width:min(620px,100%);max-height:88vh;overflow:auto;padding:24px;border-radius:14px;background:#fff;box-shadow:0 22px 70px #10182855}.detail-dialog header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.detail-dialog h3{margin:0}.detail-dialog header p{margin:6px 0;color:#758196}.detail-dialog h4{margin:20px 0 7px}.detail-row{display:flex;justify-content:space-between;gap:18px;padding:12px 0;border-top:1px solid #edf0f4;line-height:1.5}.detail-row span{flex:none;color:#8490a2}.detail-row b{text-align:right;white-space:pre-wrap;overflow-wrap:anywhere;color:#344054}.detail-empty{color:#8793a4}.close{padding:6px 12px;background:#eef3f9;color:#344054}
.account-link-action{display:block}.account-link-dialog{width:min(620px,100%)}.account-search{display:flex;gap:9px;margin:14px 0}.account-search input{flex:1;min-width:0}.account-search button,.account-candidate button{flex:none;padding:8px 12px;border:0;border-radius:8px;background:#e85d21;color:#fff}.account-search button:disabled,.account-candidate button:disabled{opacity:.55}.account-candidates{max-height:42vh;overflow:auto;border-top:1px solid #edf0f4}.account-candidate{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 2px;border-bottom:1px solid #edf0f4}.account-candidate>div{display:grid;gap:4px;min-width:0}.account-candidate b{color:#27364d}.account-candidate span,.account-candidates-empty{color:#8390a2;font-size:13px}.account-candidates-empty{padding:24px 10px;text-align:center}.account-candidate button:disabled{background:#e8edf3;color:#667085}
.edit-backdrop{position:fixed;inset:0;z-index:1220;display:grid;place-items:center;padding:18px;background:#10182899}.edit-dialog{box-sizing:border-box;width:min(520px,100%);max-height:88vh;overflow:auto;padding:24px;border-radius:14px;background:#fff;box-shadow:0 22px 70px #10182866}.edit-dialog header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:18px}.edit-dialog h3{margin:0}.edit-dialog header p{margin:6px 0;color:#758196}.edit-dialog label{display:grid;gap:6px;margin:12px 0;color:#526176;font-size:13px}.edit-dialog input,.edit-dialog select,.edit-dialog textarea{box-sizing:border-box;width:100%;min-height:40px;padding:8px 10px;border:1px solid #dce3ec;border-radius:8px;background:#fff;color:#26344b;font:inherit}.edit-dialog textarea{resize:vertical}.edit-note{padding:10px 12px;border-radius:8px;background:#f5f7fa;color:#768398;font-size:13px;line-height:1.6}.edit-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.edit-actions button{padding:9px 15px;border:0;border-radius:8px}.save-edit{background:#e85d21;color:#fff}.save-edit:disabled{opacity:.5}
</style>

