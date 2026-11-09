<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { getShanghaiBusinessMonth } from '../business-date'
import PaginationControls from './PaginationControls.vue'

type Issue = { code: string; ids?: number[]; days?: string[] }
type WorkRow = { employeeId: number; employeeName: string; businessDate: string;
  scheduledMinutes: number; storeRawMinutes: number; organizationRawMinutes: number; statisticalMinutes: number | null;
  discardedMinutes: number | null; hourlyRate?: string | null; basePayAmount?: string | null; trialNotPayable?: boolean;
  storeId?: number; storeName?: string }
type Preview = { snapshot: { rows: WorkRow[]; totalRawMinutes: number; totalScheduledMinutes: number;
  totalStatisticalMinutes: number | null; totalBasePayAmount?: string | null; ruleCode: string }; issues: Issue[] }
type Review = { id: number; revision: number; status: string; invalidatedAt: string | null;
  submittedAt: string; approvedAt: string | null; storeId: number; storeName: string }
type Store = { id: number; storeName: string; permissionCodes: string[] }

const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[] }>()
const storeId = ref(props.stores.length > 1 ? 'ALL' : String(props.stores[0]?.id ?? ''))
const month = ref(getShanghaiBusinessMonth())
const preview = ref<Preview | null>(null)
const reviews = ref<Review[]>([])
const error = ref('')
const message = ref('')
const busy = ref(false)
const reason = ref('')
const rowPage = ref(1), reviewPage = ref(1), rowPageSize = ref(20), reviewPageSize = ref(20)
const pagedRows = computed(() => (preview.value?.snapshot.rows ?? [])
  .slice((rowPage.value - 1) * rowPageSize.value, rowPage.value * rowPageSize.value))
const pagedReviews = computed(() => reviews.value
  .slice((reviewPage.value - 1) * reviewPageSize.value, reviewPage.value * reviewPageSize.value))
watch([storeId, month], () => { rowPage.value = 1; reviewPage.value = 1 })
const selectedStore = computed(() => props.stores.find(item => String(item.id) === storeId.value))
const canSubmit = computed(() => selectedStore.value?.permissionCodes.includes('HR_MONTH_SUBMIT') ?? false)
function canReviewApprove(review: Review) {
  return props.stores.find((store) => store.id === review.storeId)?.permissionCodes.includes('HR_MONTH_APPROVE') ?? false
}
function canReviewExport(review: Review) {
  return props.stores.find((store) => store.id === review.storeId)?.permissionCodes.includes('HR_MONTH_EXPORT') ?? false
}

const issueText: Record<string, string> = {
  NO_CONFIRMED_WORK: '本月没有已确认工时',
  CROSS_STORE_DAY_UNRESOLVED: '同一自然日跨门店工时尚未分摊',
  UNCONFIRMED_SHIFTS: '有未确认班次',
  PENDING_TIME_CORRECTIONS: '有待处理的工时更正',
  PENDING_TRANSFERS: '有待处理的转店申请',
  MISSING_OR_OVERLAPPING_HOURLY_RATE: '员工当日时薪缺失或重叠',
  PENDING_SALARY_CHANGES: '有待审批或生效的调薪',
}
const statusText: Record<string, string> = {
  SUBMITTED: '审批中', APPROVED: '已批准', REJECTED: '已拒绝', INVALIDATED: '已失效',
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init,
    headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '操作失败')
  return data
}
async function load() {
  busy.value = true; error.value = ''; message.value = ''
  preview.value = null; reviews.value = []
  try {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)) throw new Error('请选择有效月份')
    const stores = storeId.value === 'ALL' ? props.stores :
      props.stores.filter((item) => String(item.id) === storeId.value)
    if (!stores.length) throw new Error('当前账号没有可查询的月审门店')
    const results = await Promise.all(stores.map(async (store) => {
      const query = `storeId=${encodeURIComponent(String(store.id))}&month=${encodeURIComponent(month.value)}`
      const [nextPreview, nextReviews] = await Promise.all([
        request(`/api/hr/monthly-reviews/preview?${query}`) as Promise<Preview>,
        request(`/api/hr/monthly-reviews?${query}`) as Promise<Omit<Review, 'storeId' | 'storeName'>[]>,
      ])
      return { store, preview: nextPreview, reviews: nextReviews.map((item) => ({
        ...item, storeId: store.id, storeName: store.storeName,
      })) }
    }))
    const first = results[0].preview
    const allRows = results.flatMap(({ store, preview: item }) => item.snapshot.rows.map((row) => ({
      ...row, storeId: store.id, storeName: store.storeName,
    })))
    const hasPay = results.some(({ preview: item }) => item.snapshot.totalBasePayAmount !== undefined)
    const totalPayCents = results.reduce((sum, item) =>
      sum + Math.round(Number(item.preview.snapshot.totalBasePayAmount ?? 0) * 100), 0)
    preview.value = { issues: results.flatMap(({ preview: item }) => item.issues), snapshot: {
      ...first.snapshot, rows: allRows,
      totalRawMinutes: results.reduce((sum, item) => sum + item.preview.snapshot.totalRawMinutes, 0),
      totalScheduledMinutes: results.reduce((sum, item) => sum + item.preview.snapshot.totalScheduledMinutes, 0),
      totalStatisticalMinutes: results.some((item) => item.preview.snapshot.totalStatisticalMinutes == null)
        ? null : results.reduce((sum, item) => sum + (item.preview.snapshot.totalStatisticalMinutes ?? 0), 0),
      ...(hasPay ? { totalBasePayAmount: results.every((item) => item.preview.snapshot.totalBasePayAmount != null)
        ? `${Math.floor(totalPayCents / 100)}.${String(totalPayCents % 100).padStart(2, '0')}` : null } : {}),
    } }
    reviews.value = results.flatMap((item) => item.reviews)
    rowPage.value = 1; reviewPage.value = 1
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取失败' }
  finally { busy.value = false }
}
onMounted(load)
async function submit() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    if (!canSubmit.value) throw new Error('没有当前门店的月审提交权限')
    if (!preview.value || preview.value.issues.length) throw new Error('请先查询并解决本月异常')
    await request('/api/hr/monthly-reviews', { method: 'POST',
      body: JSON.stringify({ storeId: Number(storeId.value), month: month.value }) })
    await load(); message.value = '月审已提交，等待按配置顺序审批。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '提交失败' }
  finally { busy.value = false }
}
async function decide(review: Review, decision: 'APPROVE' | 'REJECT') {
  if (!canReviewApprove(review)) { error.value = '没有当前门店的月审审批权限'; return }
  if (decision === 'REJECT' && !reason.value.trim()) { error.value = '拒绝时请填写原因'; return }
  busy.value = true; error.value = ''; message.value = ''
  try {
    await request(`/api/hr/monthly-reviews/${review.id}/decisions`, { method: 'POST',
      body: JSON.stringify({ decision, reason: reason.value.trim() }) })
    reason.value = ''; await load(); message.value = '审批结果已记录。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '审批失败' }
  finally { busy.value = false }
}
async function download(review: Review) {
  busy.value = true; error.value = ''
  try {
    if (!canReviewExport(review)) throw new Error('没有当前门店的月审导出权限')
    const response = await fetch(`${props.apiBase}/api/hr/monthly-reviews/${review.id}/export.xlsx`,
      { headers: props.headers() })
    if (!response.ok) {
      const data = await response.json(); throw new Error(data.message ?? '导出失败')
    }
    const url = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a'); anchor.href = url
    anchor.download = `hr-monthly-${month.value}-store-${storeId.value}-v${review.revision}.xlsx`
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导出失败' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="card monthly-review">
    <h2>月度工时审核</h2>
    <p>每个班次单独按 30 分钟向下统计，再汇总到自然日。存在未确认或待处理事项时，不能提交。</p>
    <div class="filters">
      <label>门店<select v-model="storeId"><option v-if="stores.length > 1" value="ALL">全部授权门店</option>
        <option v-for="store in stores" :key="store.id" :value="String(store.id)">{{ store.storeName }}</option>
      </select></label>
      <label>月份<input v-model="month" type="month" /></label>
      <button :disabled="busy" @click="load">查询</button>
    </div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <template v-if="preview">
      <div class="totals"><span>排班工时 {{ (preview.snapshot.totalScheduledMinutes / 60).toFixed(2) }} 小时</span>
        <span>统计工时 {{ preview.snapshot.totalStatisticalMinutes == null ? '待核对' : `${(preview.snapshot.totalStatisticalMinutes / 60).toFixed(2)} 小时` }}</span>
        <span v-if="preview.snapshot.totalBasePayAmount !== undefined">基础时薪应发 {{ preview.snapshot.totalBasePayAmount ?? '待核对' }} 元</span>
        <span>规则 {{ preview.snapshot.ruleCode }}</span></div>
      <div v-if="preview.issues.length" class="issues"><strong>待处理事项</strong>
        <ul><li v-for="(issue, index) in preview.issues" :key="index">
          {{ issueText[issue.code] ?? issue.code }}
          <small>{{ [...(issue.ids ?? []), ...(issue.days ?? [])].join('、') }}</small>
        </li></ul>
      </div>
      <div class="table-scroll"><table><thead><tr><th>日期</th><th>员工</th><th v-if="storeId === 'ALL'">门店</th><th>排班工时</th><th>统计工时</th><th v-if="preview.snapshot.totalBasePayAmount !== undefined">时薪</th><th v-if="preview.snapshot.totalBasePayAmount !== undefined">当日基础应发</th></tr></thead>
        <tbody><tr v-for="row in pagedRows" :key="`${row.storeId}-${row.employeeId}-${row.businessDate}`">
          <td>{{ row.businessDate }}</td><td>{{ row.employeeName }}</td><td v-if="storeId === 'ALL'">{{ row.storeName }}</td>
          <td>{{ (row.scheduledMinutes / 60).toFixed(2) }} 小时</td>
          <td>{{ row.statisticalMinutes == null ? '—' : `${(row.statisticalMinutes / 60).toFixed(2)} 小时` }}</td>
          <td v-if="preview.snapshot.totalBasePayAmount !== undefined">{{ row.trialNotPayable ? '试岗不计薪' : row.hourlyRate ?? '—' }}</td>
          <td v-if="preview.snapshot.totalBasePayAmount !== undefined">{{ row.trialNotPayable ? '试岗不计薪' : row.basePayAmount ?? '—' }}</td></tr></tbody></table></div>
      <PaginationControls v-model:page="rowPage" v-model:page-size="rowPageSize" :total="preview.snapshot.rows.length" />
      <p v-if="storeId === 'ALL'" class="hint">全部门店模式用于汇总查看；提交月审时请切换到单家门店。</p>
      <button v-if="canSubmit && storeId !== 'ALL'" :disabled="busy || !!preview.issues.length" @click="submit">提交月审</button>
    </template>
    <h3>审核记录</h3>
    <p v-if="!reviews.length">当前月份没有审核记录。</p>
    <div v-for="review in pagedReviews" :key="review.id" class="review-item">
      <div><strong v-if="storeId === 'ALL'">{{ review.storeName }} · 第 {{ review.revision }} 版 · {{ statusText[review.status] ?? review.status }}</strong>
        <strong v-else>第 {{ review.revision }} 版 · {{ statusText[review.status] ?? review.status }}</strong>
        <small v-if="review.invalidatedAt">数据已变化，此版本失效</small>
        <small>提交于 {{ review.submittedAt }}</small></div>
      <div class="review-actions">
        <template v-if="canReviewApprove(review) && review.status === 'SUBMITTED' && !review.invalidatedAt">
          <input v-model="reason" placeholder="拒绝原因（拒绝时必填）" />
          <button :disabled="busy" @click="decide(review, 'APPROVE')">批准当前步骤</button>
          <button class="secondary" :disabled="busy" @click="decide(review, 'REJECT')">拒绝</button>
        </template>
        <button v-if="canReviewExport(review) && review.status === 'APPROVED' && !review.invalidatedAt"
          :disabled="busy" @click="download(review)">导出 Excel</button>
      </div>
    </div>
    <PaginationControls v-if="reviews.length" v-model:page="reviewPage" v-model:page-size="reviewPageSize" :total="reviews.length" />
    <small>Excel 是工时审核快照，不是工资支付指令。操作权限由账号功能角色及其管理门店决定。</small>
  </section>
</template>

<style scoped>
.monthly-review h2{margin:0 0 8px}.monthly-review p,.monthly-review small{color:#64748b}
.filters,.totals,.review-item,.review-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.filters{margin:20px 0}.filters label{display:grid;gap:6px;min-width:180px}.filters select,.filters input{min-height:38px}
.totals{padding:14px;margin:16px 0;background:#f1f5f9;border-radius:10px}
.issues{padding:12px 16px;margin:12px 0;background:#fff7ed;border:1px solid #fdba74;border-radius:10px}
.issues ul{margin:8px 0;padding-left:20px}.issues small{margin-left:8px}
.table-scroll{overflow:auto;margin:14px 0 20px}.table-scroll table{width:100%;min-width:660px}
.review-item{justify-content:space-between;border-top:1px solid #e2e8f0;padding:14px 0}.review-item>div:first-child{display:grid;gap:4px}
.secondary{background:#eef3f9;color:#2b517d}.monthly-review h3{margin-top:28px}
</style>

