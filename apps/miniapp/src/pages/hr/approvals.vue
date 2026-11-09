<script setup lang="ts">
import { onHide, onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'
import { hrStatusLabel } from '../../utils/hr-labels'

type Store = { id: number; storeName: string; permissionCodes: string[] }
type Approval = {
  id: number; kind: string; subjectId: number; storeId: number; storeName: string
  employeeName: string | null; label: string; submittedPt: string; currentPosition: number | null
  totalSteps: number; roleName: string; status: string; canDecide: boolean
  rejectionReason?: string | null; canRetryEffect?: boolean; failureCode?: string | null;
  details: Array<{ label: string; value: string }>
}

const approvalPermissions = [
  'HR_APPROVAL_LIST_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE', 'HR_SALARY_CHANGE_APPROVE', 'HR_MONTH_APPROVE',
  'HR_ONBOARDING_APPROVE', 'HR_OFFBOARDING_APPROVE', 'HR_BANK_CHANGE_APPROVE', 'HR_BANK_CHANGE_VERIFY',
]
const stores = ref<Store[]>([])
const storeId = ref(0)
const approvals = ref<Approval[]>([])
const statusFilter = ref('ALL')
const page = ref(1)
const pageSize = 20
const reasons = ref<Record<string, string>>({})
const loading = ref(false)
const loadingStage = ref('正在加载审批记录')
const savingKey = ref('')
const message = ref('')
const selectedDetail = ref<Approval | null>(null)
let loadSequence = 0
let loadWatchdog: ReturnType<typeof setTimeout> | undefined
const selectedStore = computed(() => stores.value.find((store) => store.id === storeId.value))
const selectedStoreName = computed(() => selectedStore.value?.storeName ?? '')
const statusOptions = [
  { value: 'ALL', label: '全部状态' }, { value: 'PENDING', label: '待审批' },
  { value: 'APPROVED', label: '已通过' }, { value: 'REJECTED', label: '已退回' },
  { value: 'APPROVED_AWAITING_EFFECTIVE', label: '待生效' }, { value: 'EFFECTIVE', label: '已生效' },
  { value: 'EFFECTIVE_FAILED', label: '生效异常' },
]
const visibleApprovals = computed(() => statusFilter.value === 'ALL' ? approvals.value :
  approvals.value.filter((item) => item.status === statusFilter.value))
const totalPages = computed(() => Math.max(1, Math.ceil(visibleApprovals.value.length / pageSize)))
const pagedApprovals = computed(() => visibleApprovals.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const pendingCount = computed(() => approvals.value.filter((item) => item.status === 'PENDING').length)
const keyOf = (item: Approval) => `${item.kind}:${item.id}`
const kindNames: Record<string, string> = {
  TIME_CORRECTION: '工时更正', SALARY_CHANGE: '时薪变动', MONTHLY_REVIEW: '月度工时审核',
  ONBOARDING: '员工入职', OFFBOARDING: '员工离职', BANK_CHANGE: '银行卡变更', TRANSFER: '员工转店',
}

onLoad((options) => { storeId.value = Number(options?.storeId || 0) })
onShow(() => { void load() })
onHide(cancelLoad)

function cancelLoad() {
  // The page can be backgrounded while a request is pending. Invalidate that
  // request so returning to the page always starts a fresh load on HarmonyOS.
  loadSequence += 1
  if (loadWatchdog) clearTimeout(loadWatchdog)
  loadWatchdog = undefined
  loading.value = false
}

async function load() {
  if (loading.value) return
  const sequence = ++loadSequence
  if (loadWatchdog) clearTimeout(loadWatchdog)
  loading.value = true
  loadingStage.value = '正在校验账号和审批门店权限…'
  message.value = ''
  loadWatchdog = setTimeout(() => {
    if (sequence !== loadSequence) return
    loadSequence += 1
    loadWatchdog = undefined
    loading.value = false
    approvals.value = []
    message.value = `${loadingStage.value}超时，请检查网络后点击重试。`
  }, 12000)
  try {
    const access = await request<{ stores: Store[] }>('/api/hr/current-access')
    if (sequence !== loadSequence) return
    stores.value = access.stores ?? []
    const eligible = stores.value.filter((store) => approvalPermissions.some((code) => store.permissionCodes.includes(code)) ||
      store.permissionCodes.some((code) => code.startsWith('HR_TRANSFER_APPROVE_')))
    if (!eligible.some((store) => store.id === storeId.value)) storeId.value = eligible[0]?.id ?? 0
    approvals.value = []
    if (!eligible.length) {
      message.value = '当前账号没有待办审批权限，请联系总部检查审批功能角色和管理门店。'
      return
    }
    if (!storeId.value) {
      message.value = '请选择有审批权限的门店。'
      return
    }
    loadingStage.value = '正在读取审批记录…'
    const approvalResponse = await request<unknown>(`/api/hr/approvals?storeId=${storeId.value}`)
    if (!Array.isArray(approvalResponse)) throw new Error('审批列表返回的数据格式异常，请重新加载。')
    approvals.value = approvalResponse as Approval[]
    page.value = 1
    if (sequence !== loadSequence) return
  } catch (error) {
    if (sequence !== loadSequence) return
    message.value = errorMessage(error)
    approvals.value = []
  } finally {
    if (sequence === loadSequence) {
      if (loadWatchdog) clearTimeout(loadWatchdog)
      loadWatchdog = undefined
      loading.value = false
    }
  }
}

function selectStore(event: { detail: { value: string } }) {
  const store = stores.value.filter((item) => approvalPermissions.some((code) => item.permissionCodes.includes(code)) ||
    item.permissionCodes.some((code) => code.startsWith('HR_TRANSFER_APPROVE_')))[Number(event.detail.value)]
  if (!store) return
  storeId.value = store.id
  cancelLoad()
  void load()
}

function selectStatus(event: { detail: { value: string } }) {
  statusFilter.value = statusOptions[Number(event.detail.value)]?.value ?? 'ALL'
  page.value = 1
}

function changePage(offset: number) {
  page.value = Math.min(totalPages.value, Math.max(1, page.value + offset))
}

function statusName(status: string) {
  return statusOptions.find((item) => item.value === status)?.label ?? hrStatusLabel(status)
}

async function decide(item: Approval, decision: 'APPROVE' | 'REJECT') {
  const key = keyOf(item)
  const reason = (reasons.value[key] ?? '').trim()
  if (decision === 'REJECT' && !reason) { message.value = '请填写驳回原因后再提交。'; return }
  savingKey.value = key
  message.value = ''
  try {
    await request(`/api/hr/approvals/${item.kind}/${item.subjectId}/decisions`, 'POST',
      { decision, reason })
    const next = { ...reasons.value }
    delete next[key]
    reasons.value = next
    await load()
    uni.showToast({ title: decision === 'APPROVE' ? '已通过' : '已驳回', icon: 'success' })
  } catch (error) { message.value = errorMessage(error) }
  finally { savingKey.value = '' }
}

async function retryTransferEffect(item: Approval) {
  if (!item.canRetryEffect || item.kind !== 'TRANSFER') return
  savingKey.value = keyOf(item); message.value = ''
  try {
    await request(`/api/hr/transfers/${item.subjectId}/retry-effect`, 'POST')
    selectedDetail.value = null
    await load()
    uni.showToast({ title: '转店生效已重试', icon: 'success' })
  } catch (error) { message.value = errorMessage(error) }
  finally { savingKey.value = '' }
}

function submittedPt(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  // Format China time without Intl.DateTimeFormat, which is inconsistent in
  // some HarmonyOS-hosted WeChat runtimes.
  const date = new Date(timestamp + 8 * 60 * 60 * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}
</script>

<template>
  <view class="page approvals-page">
    <view v-if="loading" class="approval-loading-mask">
      <view class="approval-loading-card"><view class="approval-spinner"></view>
        <text class="approval-loading-title">审批列表加载中</text><text class="approval-loading-stage">{{ loadingStage }}</text>
      </view>
    </view>
    <view class="page-heading">
      <text class="eyebrow">人事流程</text>
      <text class="title">审批列表</text>
      <text class="subtitle">查看授权门店的全部审批记录，并处理待办事项</text>
    </view>

    <view v-if="stores.length" class="card store-card">
      <text class="store-label">审批门店</text>
      <picker v-if="stores.filter(item => approvalPermissions.some(code => item.permissionCodes.includes(code)) || item.permissionCodes.some(code => code.startsWith('HR_TRANSFER_APPROVE_'))).length > 1"
        :range="stores.filter(item => approvalPermissions.some(code => item.permissionCodes.includes(code)) || item.permissionCodes.some(code => code.startsWith('HR_TRANSFER_APPROVE_')))"
        range-key="storeName" @change="selectStore">
        <view class="store-picker">{{ selectedStoreName || '选择门店' }} <text>更换</text></view>
      </picker>
      <text v-else class="store-name">{{ selectedStoreName }}</text>
    </view>

    <view v-if="message" class="card notice">{{ message }}
      <button v-if="!loading" class="retry-button" @click="load">重新加载</button>
    </view>
    <view v-if="!message && !loading" class="list-heading">
      <text>审批记录</text><text class="count">{{ visibleApprovals.length }} / {{ approvals.length }} 项 · 待办 {{ pendingCount }}</text>
    </view>
    <view v-if="!message && !loading && approvals.length" class="card status-filter-card">
      <text class="store-label">状态筛选</text>
      <picker :range="statusOptions" range-key="label" @change="selectStatus">
        <view class="store-picker">{{ statusOptions.find((item) => item.value === statusFilter)?.label }} <text>筛选</text></view>
      </picker>
    </view>
    <view v-if="!visibleApprovals.length && !loading && !message" class="card empty-state">
      <text class="empty-mark">✓</text>
      <text class="empty-title">{{ statusFilter === 'ALL' ? '暂无审批记录' : '当前状态没有记录' }}</text>
      <text class="empty-copy">切换状态筛选可查看其他审批记录。</text>
    </view>

    <view v-for="item in pagedApprovals" :key="keyOf(item)" class="card approval-card">
      <view class="approval-top">
        <text class="kind-tag">{{ kindNames[item.kind] || '其他流程' }}</text>
        <view class="approval-top-right"><text class="status-tag" :class="`status-${item.status.toLowerCase()}`">{{ statusName(item.status) }}</text><text class="submitted">{{ submittedPt(item.submittedPt) }}</text></view>
      </view>
      <text class="approval-title">{{ item.employeeName || item.label }}</text>
      <text v-if="item.employeeName" class="approval-detail">{{ item.label }}</text>
      <view class="approval-meta"><text>{{ item.storeName }}</text><text>{{ item.roleName }}<template v-if="item.currentPosition"> · 第 {{ item.currentPosition }}/{{ item.totalSteps }} 步</template></text></view>
      <button class="detail-button" @click="selectedDetail = item">查看申请详情</button>
      <template v-if="item.canDecide && item.status === 'PENDING'">
        <input v-model="reasons[keyOf(item)]" class="reason-input" maxlength="500" placeholder="驳回时请填写原因" />
        <view class="decision-actions">
          <button class="reject-button" :disabled="savingKey === keyOf(item)" @click="decide(item, 'REJECT')">驳回</button>
          <button class="approve-button" :disabled="savingKey === keyOf(item)" @click="decide(item, 'APPROVE')">{{ savingKey === keyOf(item) ? '处理中…' : '通过' }}</button>
        </view>
      </template>
    </view>
    <view v-if="selectedDetail" class="detail-mask" @click="selectedDetail = null">
      <view class="detail-dialog card" @click.stop>
        <view class="detail-heading"><text>{{ kindNames[selectedDetail.kind] || '其他流程' }}详情</text>
          <text class="detail-close" @click="selectedDetail = null">关闭</text></view>
        <text class="detail-person">{{ selectedDetail.employeeName || selectedDetail.label }}</text>
        <view v-for="detail in selectedDetail.details || []" :key="detail.label" class="detail-row">
          <text>{{ detail.label }}</text><text>{{ detail.value || '—' }}</text></view>
        <view v-if="selectedDetail.rejectionReason" class="detail-rejection">驳回原因：{{ selectedDetail.rejectionReason }}</view>
        <button v-if="selectedDetail.kind === 'TRANSFER' && selectedDetail.canRetryEffect" class="approve-button retry-effect"
          :disabled="savingKey === keyOf(selectedDetail)" @click="retryTransferEffect(selectedDetail)">
          {{ savingKey === keyOf(selectedDetail) ? '处理中…' : '重试转店生效' }}</button>
      </view>
    </view>
    <view v-if="!message && !loading && totalPages > 1" class="pagination">
      <button :disabled="page <= 1" @click="changePage(-1)">上一页</button>
      <text>{{ page }} / {{ totalPages }}</text>
      <button :disabled="page >= totalPages" @click="changePage(1)">下一页</button>
    </view>
  </view>
</template>

<style scoped>
.approval-loading-mask{position:fixed;z-index:999;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(247,249,252,.97)}.approval-loading-card{display:flex;flex-direction:column;align-items:center;gap:18rpx;padding:38rpx 44rpx;border:1rpx solid #e8edf4;border-radius:22rpx;background:#fff;box-shadow:0 16rpx 42rpx rgba(25,44,72,.1)}.approval-spinner{width:42rpx;height:42rpx;border:6rpx solid #fce3d5;border-top-color:#ed6427;border-radius:50%;animation:approval-spin .8s linear infinite}.approval-loading-title{color:#24344c;font-size:27rpx;font-weight:700}.approval-loading-stage{color:#7c899b;font-size:22rpx}@keyframes approval-spin{to{transform:rotate(360deg)}}
.approvals-page{padding-top:26rpx;padding-bottom:60rpx}.page-heading{padding:0 6rpx 20rpx}.eyebrow{display:block;color:#d47543;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.title{display:block;margin-top:8rpx;color:#172033;font-size:40rpx;font-weight:750}.subtitle{display:block;margin-top:7rpx;color:#8490a5;font-size:23rpx}.store-card{margin-bottom:18rpx;padding:20rpx 22rpx}.store-label{display:block;margin-bottom:8rpx;color:#8994a5;font-size:20rpx}.store-name{color:#27364d;font-size:26rpx;font-weight:700}.store-picker{display:flex;justify-content:space-between;color:#27364d;font-size:26rpx;font-weight:700}.store-picker text{color:#d45a1d;font-size:22rpx;font-weight:500}.notice{margin-bottom:18rpx;padding:22rpx;color:#9a5a30;font-size:23rpx;line-height:1.55}.list-heading{display:flex;justify-content:space-between;align-items:center;margin:24rpx 4rpx 14rpx;color:#1d2b40;font-size:28rpx;font-weight:700}.count{color:#d45a1d;font-size:23rpx}.approval-card{margin-bottom:16rpx;padding:22rpx}.approval-top{display:flex;justify-content:space-between;align-items:center;gap:12rpx}.kind-tag{padding:8rpx 14rpx;border-radius:999rpx;background:#f0ecff;color:#7155ac;font-size:20rpx;font-weight:700}.submitted{color:#929daf;font-size:20rpx}.approval-title{display:block;margin-top:16rpx;color:#1d2b40;font-size:28rpx;font-weight:700;line-height:1.45}.approval-detail{display:block;margin-top:6rpx;color:#78869a;font-size:22rpx;line-height:1.45}.approval-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8rpx;margin-top:16rpx;padding-top:14rpx;border-top:1rpx solid #f0f2f5;color:#7e8ba0;font-size:21rpx}.reason-input{height:70rpx;margin-top:16rpx;padding:0 16rpx;border:1rpx solid #e4e8ee;border-radius:13rpx;background:#fafbfd;color:#34445d;font-size:22rpx}.decision-actions{display:flex;gap:12rpx;margin-top:14rpx}.decision-actions button{flex:1;margin:0;border:0;border-radius:14rpx;font-size:24rpx}.reject-button{background:#f2f4f7;color:#5b687c}.approve-button{background:#ed6427;color:#fff}.empty-state{display:flex;flex-direction:column;align-items:center;padding:46rpx 20rpx}.empty-mark{display:flex;align-items:center;justify-content:center;width:64rpx;height:64rpx;border-radius:50%;background:#e8f7ef;color:#208150;font-size:40rpx}.empty-title{margin-top:14rpx;color:#34445d;font-size:27rpx;font-weight:700}.empty-copy{margin-top:8rpx;color:#8a95a6;font-size:22rpx;text-align:center}
.status-filter-card{margin-bottom:12rpx;padding:18rpx 22rpx}.retry-button{margin-top:16rpx;padding:0 24rpx;border:0;border-radius:12rpx;background:#ed6427;color:#fff;font-size:22rpx}.retry-button::after{border:0}.approval-top-right{display:flex;flex-direction:column;align-items:flex-end;gap:6rpx}.status-tag{padding:6rpx 12rpx;border-radius:999rpx;background:#f0f2f5;color:#5b687c;font-size:19rpx;font-weight:700}.status-pending{background:#fff2e8;color:#c65b23}.status-approved,.status-effective{background:#e8f7ef;color:#208150}.status-rejected,.status-effective_failed{background:#fff0ef;color:#bd3d34}.status-approved_awaiting_effective{background:#fff7dc;color:#98700a}
.role-picker{display:flex;justify-content:space-between;gap:14rpx;margin-top:16rpx;padding:18rpx 16rpx;border:1rpx solid #e4e8ee;border-radius:13rpx;background:#fafbfd;color:#526176;font-size:22rpx}.role-picker text{color:#d45a1d;font-weight:700}
.pagination{display:flex;align-items:center;justify-content:center;gap:18rpx;padding:16rpx 0 28rpx;color:#68778e;font-size:22rpx}.pagination button{margin:0;padding:0 20rpx;border:1rpx solid #e4e8ee;border-radius:12rpx;background:#fff;color:#34445d;font-size:21rpx}.pagination button[disabled]{color:#aeb7c4;background:#f5f6f8}
.detail-button{margin:14rpx 0 0;padding:0 18rpx;border:1rpx solid #ead4c8;border-radius:12rpx;background:#fff8f4;color:#c5521d;font-size:22rpx;line-height:2.2}.detail-button::after{border:0}.detail-mask{position:fixed;z-index:1000;inset:0;display:flex;align-items:center;justify-content:center;padding:36rpx;background:rgba(15,23,42,.46)}.detail-dialog{box-sizing:border-box;width:100%;max-height:75vh;overflow-y:auto;padding:26rpx}.detail-heading{display:flex;align-items:center;justify-content:space-between;color:#172033;font-size:29rpx;font-weight:700}.detail-close{color:#d45a1d;font-size:23rpx;font-weight:500}.detail-person{display:block;margin:18rpx 0;color:#3b4a62;font-size:25rpx;font-weight:700}.detail-row{display:flex;justify-content:space-between;gap:20rpx;padding:16rpx 0;border-top:1rpx solid #eef1f5;font-size:22rpx;line-height:1.5}.detail-row text:first-child{flex:none;color:#8290a4}.detail-row text:last-child{text-align:right;color:#34445d;overflow-wrap:anywhere}.detail-rejection{margin-top:16rpx;padding:14rpx;border-radius:12rpx;background:#fff1ef;color:#b54708;font-size:22rpx;line-height:1.5}
.retry-effect{margin-top:18rpx}
</style>
