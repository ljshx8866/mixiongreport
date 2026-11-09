<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string }
type Approval = { id: number; kind: string; subjectId: number; storeId: number; storeName: string;
  employeeName: string | null; label: string; submittedAt: string; currentPosition: number | null;
  totalSteps: number; roleName: string; status: string; canDecide: boolean;
  businessStatus?: string; failureCode?: string | null; rejectionReason?: string | null;
  canRetryEffect?: boolean;
  details: Array<{ label: string; value: string }> }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[] }>()
const storeId = ref('')
const approvals = ref<Approval[]>([])
const reasons = ref<Record<string, string>>({})
const busy = ref(false)
const error = ref('')
const selectedDetail = ref<Approval | null>(null)
const loaded = ref(false)
const page = ref(1), pageSize = ref(20)
const keyOf = (item: Approval) => `${item.kind}:${item.id}`
const storeOptions = computed(() => props.stores)
const statusFilter = ref('ALL')
const statusOptions = [
  { value: 'ALL', label: '全部状态' }, { value: 'PENDING', label: '待审批' },
  { value: 'APPROVED', label: '已通过' }, { value: 'REJECTED', label: '已退回' },
  { value: 'APPROVED_AWAITING_EFFECTIVE', label: '待生效' }, { value: 'EFFECTIVE', label: '已生效' },
  { value: 'EFFECTIVE_FAILED', label: '生效异常' },
]
const visibleApprovals = computed(() => statusFilter.value === 'ALL' ? approvals.value :
  approvals.value.filter((item) => item.status === statusFilter.value || item.businessStatus === statusFilter.value))
const pagedApprovals = computed(() => visibleApprovals.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch([storeId, statusFilter], () => { page.value = 1; if (loaded.value) void load() })
const pendingCount = computed(() => approvals.value.filter((item) => item.status === 'PENDING').length)
const kindNames: Record<string, string> = {
  ONBOARDING: '入职审批', OFFBOARDING: '离职审批', SALARY_CHANGE: '时薪变动',
  BANK_CHANGE: '银行卡变更', MONTHLY_REVIEW: '月度工时审核',
  TIME_CORRECTION: '工时更正', TRANSFER: '员工转店',
}
async function load() {
  busy.value = true; error.value = ''
  try {
    const query = storeId.value ? `?storeId=${encodeURIComponent(storeId.value)}` : ''
    const response = await fetch(`${props.apiBase}/api/hr/approvals${query}`, { headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '审批列表读取失败')
    approvals.value = Array.isArray(data) ? data : []
    loaded.value = true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '审批列表读取失败' }
  finally { busy.value = false }
}
onMounted(load)

async function decide(item: Approval, decision: 'APPROVE' | 'REJECT') {
  const key = keyOf(item)
  const reason = (reasons.value[key] ?? '').trim()
  if (decision === 'REJECT' && !reason) { error.value = '拒绝审批时请填写原因'; return }
  busy.value = true; error.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/hr/approvals/${item.kind}/${item.subjectId}/decisions`, {
      method: 'POST', headers: props.headers(), body: JSON.stringify({ decision, reason }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '审批处理失败')
    const next = { ...reasons.value }; delete next[key]; reasons.value = next
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '审批处理失败' }
  finally { busy.value = false }
}
async function retryTransferEffect(item: Approval) {
  if (!item.canRetryEffect) return
  busy.value = true; error.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/hr/transfers/${item.subjectId}/retry-effect`, {
      method: 'POST', headers: props.headers(),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '转店生效重试失败')
    selectedDetail.value = null; await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '转店生效重试失败' }
  finally { busy.value = false }
}

function submittedAt(value: string) {
  const date = new Date(value)
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function statusName(status: string) {
  return statusOptions.find((item) => item.value === status)?.label ?? status
}
function businessStatusName(status?: string, failureCode?: string | null) {
  if (!status) return ''
  if (status === 'EFFECTIVE_FAILED') {
    const reason: Record<string, string> = {
      PHONE_REQUIRED: '手机号缺失或格式无效',
      PHONE_ACCOUNT_LINKED: '手机号已关联其他员工',
      PHONE_ACCOUNT_DISABLED: '手机号对应账号已停用',
      SOURCE_CHANGED: '入职资料发生变化',
    }
    return `入职未生效：${failureCode ? reason[failureCode] ?? '请查看入职记录' : '请查看入职记录'}`
  }
  const names: Record<string, string> = {
    SUBMITTED: '入职流程：待审批',
    APPROVED_AWAITING_EFFECTIVE: '入职流程：审批通过，等待生效',
    REJECTED: '入职流程：已退回',
    EFFECTIVE: '入职流程：已生效',
  }
  return names[status] ?? `入职流程：${status}`
}
</script>

<template>
  <section class="card approval-inbox">
    <div class="inbox-heading"><div><h2>审批列表</h2><p>查看授权门店的全部审批记录，并处理待办事项。</p></div>
      <span class="pending-count">待办 {{ pendingCount }}</span></div>
    <div class="filters"><label>门店<select v-model="storeId"><option value="">全部授权门店</option>
      <option v-for="store in storeOptions" :key="store.id" :value="String(store.id)">{{ store.storeName }}</option>
    </select></label><label>状态<select v-model="statusFilter"><option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
    </select></label><button :disabled="busy" @click="load">{{ busy ? '加载中…' : '刷新记录' }}</button></div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p>
    <div v-if="visibleApprovals.length" class="table-scroll"><table><thead><tr>
      <th>申请类型</th><th>申请内容</th><th>门店</th><th>状态</th><th>当前/最近审批</th><th>提交时间</th><th>操作</th>
    </tr></thead><tbody><tr v-for="item in pagedApprovals" :key="keyOf(item)">
      <td><span class="kind-pill">{{ kindNames[item.kind] || item.kind }}</span></td>
      <td><strong>{{ item.employeeName || item.label }}</strong><small v-if="item.employeeName">{{ item.label }}</small>
        <button class="detail-link" @click="selectedDetail = item">查看详情</button></td>
      <td>{{ item.storeName }}</td>
      <td><span class="status-pill" :class="`status-${item.status.toLowerCase()}`">{{ statusName(item.status) }}</span>
        <small v-if="item.businessStatus && item.businessStatus !== item.status" class="business-status">{{ businessStatusName(item.businessStatus, item.failureCode) }}</small></td>
      <td>{{ item.currentPosition ? `第 ${item.currentPosition}/${item.totalSteps} 步 · ${item.roleName}` : item.roleName }}</td>
      <td>{{ submittedAt(item.submittedAt) }}</td>
      <td v-if="item.canDecide && item.status === 'PENDING'" class="decision-cell">
        <input v-model="reasons[keyOf(item)]" maxlength="500" placeholder="拒绝时填写原因" />
        <div class="actions"><button :disabled="busy" @click="decide(item, 'APPROVE')">通过</button>
          <button class="reject" :disabled="busy" @click="decide(item, 'REJECT')">拒绝</button></div>
      </td><td v-else>—</td>
    </tr></tbody></table></div>
    <div v-else-if="loaded && !busy" class="empty"><span class="empty-mark">✓</span><strong>当前筛选条件下没有审批记录</strong><small>切换状态或门店可查看其他审批记录。</small></div>
    <div v-else-if="!loaded" class="empty">选择门店或查看全部授权门店的审批记录。</div>
    <PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="visibleApprovals.length" />
  </section>
  <div v-if="selectedDetail" class="detail-backdrop" @click.self="selectedDetail = null"><section class="detail-dialog card">
    <header><div><span class="kind-pill">{{ kindNames[selectedDetail.kind] || selectedDetail.kind }}</span>
      <h3>{{ selectedDetail.employeeName || selectedDetail.label }}</h3></div><button class="secondary" @click="selectedDetail = null">关闭</button></header>
    <p class="detail-subtitle">{{ selectedDetail.storeName }} · {{ statusName(selectedDetail.status) }} · {{ submittedAt(selectedDetail.submittedAt) }}</p>
    <div v-for="detail in selectedDetail.details || []" :key="detail.label" class="detail-row"><span>{{ detail.label }}</span><strong>{{ detail.value || '—' }}</strong></div>
    <div v-if="selectedDetail.rejectionReason" class="rejection-reason">驳回原因：{{ selectedDetail.rejectionReason }}</div>
    <button v-if="selectedDetail.kind === 'TRANSFER' && selectedDetail.canRetryEffect" :disabled="busy" @click="retryTransferEffect(selectedDetail)">重试转店生效</button>
  </section></div>
</template>

<style scoped>
.inbox-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.approval-inbox h2{margin:0}.approval-inbox p{margin:6px 0 0;color:#64748b}.pending-count{padding:7px 12px;border-radius:999px;background:#fff1e8;color:#c95c24;font-weight:700;white-space:nowrap}.filters{display:flex;align-items:end;gap:12px;margin:22px 0}.filters label{display:grid;gap:6px;min-width:240px;color:#526176;font-size:13px}.filters select{height:38px;border:1px solid #dce3ec;border-radius:8px;background:#fff;padding:0 10px;color:#26344b}.filters button{height:38px;padding:0 18px}.table-scroll{overflow:auto}.table-scroll table{width:100%;min-width:1040px}.kind-pill{display:inline-block;padding:5px 9px;border-radius:999px;background:#edf3fb;color:#41618d;font-size:12px;font-weight:700}.approval-inbox td strong{display:block}.approval-inbox td small{display:block;margin-top:5px;color:#8290a4}.decision-cell{min-width:220px}.decision-cell input,.decision-cell select{width:100%;height:33px;border:1px solid #dce3ec;border-radius:7px;padding:0 8px;box-sizing:border-box;background:#fff}.actions{display:flex;gap:7px;margin-top:7px}.actions button{padding:6px 12px}.actions .reject{background:#f1f3f6;color:#536176}.empty{display:grid;justify-items:center;gap:7px;padding:44px 10px;color:#68758a}.empty-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:#e9f7ef;color:#178252;font-size:24px}.empty small{color:#8a95a6}.error{color:#b42318}
.status-pill{display:inline-block;padding:5px 9px;border-radius:999px;background:#f0f2f5;color:#526176;font-size:12px;font-weight:700;white-space:nowrap}.status-pending{background:#fff2e8;color:#c65b23}.status-approved,.status-effective{background:#e8f7ef;color:#208150}.status-rejected,.status-effective_failed{background:#fff0ef;color:#bd3d34}.status-approved_awaiting_effective{background:#fff7dc;color:#98700a}
.business-status{display:block;margin-top:5px;color:#b54708;line-height:1.5;white-space:normal}
.detail-link{display:block;margin-top:6px;padding:0;border:0;background:transparent;color:#c5521d;font-size:12px}.detail-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:18px;background:#10182888}.detail-dialog{width:min(620px,100%);max-height:84vh;overflow:auto;padding:24px}.detail-dialog header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.detail-dialog h3{margin:10px 0 0}.detail-subtitle{margin:8px 0 18px!important;color:#7a8799!important}.detail-row{display:flex;justify-content:space-between;gap:20px;padding:13px 0;border-top:1px solid #edf0f4;font-size:14px;line-height:1.5}.detail-row span{color:#8490a2;flex:none}.detail-row strong{text-align:right;white-space:pre-wrap;overflow-wrap:anywhere;color:#344054}.rejection-reason{margin-top:14px;padding:12px;border-radius:8px;background:#fff2ef;color:#b54708;line-height:1.5}
</style>

