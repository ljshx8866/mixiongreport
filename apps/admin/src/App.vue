<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import DailyInputForm from './components/DailyInputForm.vue'
import UserManagement from './components/UserManagement.vue'
import MasterDataManagement from './components/MasterDataManagement.vue'
import ReportOperations from './components/ReportOperations.vue'
import ChangePassword from './components/ChangePassword.vue'
import ReminderManagement from './components/ReminderManagement.vue'
import HrRoleManagement from './components/HrRoleManagement.vue'
import HrWorkflowManagement from './components/HrWorkflowManagement.vue'
import HrMonthlyReview from './components/HrMonthlyReview.vue'
import HrEmployeeRoster from './components/HrEmployeeRoster.vue'
import HrTrials from './components/HrTrials.vue'
import HrApprovalInbox from './components/HrApprovalInbox.vue'
import HrOnboarding from './components/HrOnboarding.vue'
import HrJobPositions from './components/HrJobPositions.vue'
import HrOffboarding from './components/HrOffboarding.vue'
import HrSalaryChanges from './components/HrSalaryChanges.vue'
import HrOcrCredentials from './components/HrOcrCredentials.vue'
import HrBankChanges from './components/HrBankChanges.vue'
import MiniappDecoration from './components/MiniappDecoration.vue'
import SystemAlerts from './components/SystemAlerts.vue'
import PasswordPolicy from './components/PasswordPolicy.vue'
import { getShanghaiBusinessDate } from './business-date'

type Metrics = { amount: number | null; customers: number | null; avgOrderValue: number | null }
type Store = { id: number; storeCode: string; storeName: string; status: boolean }
type HrStore = { id: number; storeName: string; permissionCodes: string[] }
type Report = { store: { name: string }; date: string; status: { complete: boolean; manualInputReady: boolean }; sales: { total: Metrics; dineIn: Metrics; delivery: Metrics }; categorySales: { categoryId: number; categoryName: string; quantity: number }[] }
type Module = 'dashboard' | 'reports' | 'input' | 'operations' | 'reminders' | 'users' | 'stores' | 'categories' | 'products' | 'hrRoles' | 'hrWorkflows' | 'hrMonthly' | 'hrEmployeeRoster' | 'hrTrials' | 'hrApprovals' | 'hrOnboarding' | 'hrJobPositions' | 'hrOffboarding' | 'hrSalary' | 'hrOcrCredentials' | 'hrBankChanges' | 'miniappDecoration' | 'systemAlerts' | 'passwordPolicy' | 'account'
const apiBase = import.meta.env.VITE_API_BASE ?? ''
const token = ref(localStorage.getItem('accessToken') ?? ''); const role = ref(localStorage.getItem('userRole') ?? ''); const mobile = ref(''); const password = ref(''); const error = ref(''); const loading = ref(false)
const mustChangePassword = ref(false)
const storeId = ref('ALL'); const stores = ref<Store[]>([]); const date = ref(getShanghaiBusinessDate()); const report = ref<Report | null>(null); const current = ref<Module>('dashboard'); const openTabs = ref<Module[]>(['dashboard'])
const hrStores = ref<HrStore[]>([])
const trialConversionRequest = ref<{ trialEmployeeId: number; storeId: number; nonce: number } | null>(null)
let trialConversionNonce = 0
const canConfigureHr = ref(false)
const hrAccessMessage = ref('')
const hrEmployeeStores = computed(() => hrStores.value.filter(item => item.permissionCodes.includes('HR_EMPLOYEE_LIST_READ')))
const hrTrialStores = computed(() => hrStores.value.filter(item => item.permissionCodes.includes('HR_TRIAL_MANAGE')))
const hrApprovalPermissions = ['HR_APPROVAL_LIST_READ', 'HR_APPROVAL_DETAIL_READ', 'HR_TIME_CORRECTION_EDIT', 'HR_TIME_CORRECTION_DELETE', 'HR_SALARY_CHANGE_APPROVE', 'HR_MONTH_APPROVE',
  'HR_ONBOARDING_APPROVE', 'HR_OFFBOARDING_APPROVE', 'HR_BANK_CHANGE_APPROVE', 'HR_TRANSFER_APPROVE_SOURCE',
  'HR_TRANSFER_APPROVE_DESTINATION', 'HR_TRANSFER_APPROVE_HR']
const hrApprovalStores = computed(() => hrStores.value.filter(item =>
  hrApprovalPermissions.some(code => item.permissionCodes.includes(code))))
const hrMonthlyStores = computed(() => hrStores.value.filter(item =>
  ['HR_MONTH_LIST_READ', 'HR_MONTH_SUBMIT', 'HR_MONTH_APPROVE', 'HR_MONTH_EXPORT'].some(code => item.permissionCodes.includes(code))))
const signedIn = computed(() => Boolean(token.value)); const headers = () => ({ Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' })
const amount = (value: number | null) => value == null ? '—' : `¥${Number(value).toFixed(2)}`; const number = (value: number | null) => value == null ? '—' : String(value)
const modules: Array<{ id: Module; label: string; icon: string; group: string; admin?: boolean; hr?: boolean; hrPermission?: string; hrPermissions?: string[] }> = [
  { id: 'dashboard', label: '经营看板', icon: '◈', group: '经营管理' },
  { id: 'reports', label: '日报查询', icon: '▤', group: '经营管理' },
  { id: 'input', label: '人工填报', icon: '✎', group: '经营管理' },
  { id: 'operations', label: '数据同步与核验', icon: '↻', group: '经营管理' },
  { id: 'reminders', label: '填报提醒', icon: '◷', group: '经营管理', admin: true },
  { id: 'hrEmployeeRoster', label: '员工列表', icon: '人', group: '人事管理', hr: true, hrPermission: 'HR_EMPLOYEE_LIST_READ' },
  { id: 'hrTrials', label: '试岗管理', icon: '试', group: '人事管理', hr: true, hrPermission: 'HR_TRIAL_MANAGE' },
  { id: 'hrApprovals', label: '审批列表', icon: '✓', group: '人事管理', hr: true, hrPermissions: hrApprovalPermissions },
  { id: 'hrOnboarding', label: '员工入职', icon: '+', group: '人事管理', hr: true, hrPermissions: ['HR_ONBOARDING_CREATE', 'HR_ONBOARDING_LIST_READ', 'HR_ONBOARDING_VERIFY', 'HR_ONBOARDING_APPROVE'] },
  { id: 'hrJobPositions', label: '岗位设置', icon: '¥', group: '人事管理', admin: true, hr: true },
  { id: 'hrOffboarding', label: '离职审批', icon: '↗', group: '人事管理', hr: true, hrPermissions: ['HR_OFFBOARDING_REQUEST', 'HR_OFFBOARDING_LIST_READ', 'HR_OFFBOARDING_APPROVE'] },
  { id: 'hrSalary', label: '调薪申请', icon: '¥', group: '人事管理', hr: true, hrPermissions: ['HR_SALARY_CHANGE_REQUEST', 'HR_SALARY_CHANGE_LIST_READ', 'HR_SALARY_CHANGE_APPROVE'] },
  { id: 'hrBankChanges', label: '银行卡变更', icon: '▣', group: '人事管理', hr: true, hrPermissions: ['HR_BANK_CHANGE_SUBMIT', 'HR_BANK_CHANGE_LIST_READ', 'HR_BANK_CHANGE_VERIFY', 'HR_BANK_CHANGE_APPROVE'] },
  { id: 'hrMonthly', label: '月度工时审核', icon: 'M', group: '排班与工时', hr: true, hrPermissions: ['HR_MONTH_LIST_READ', 'HR_MONTH_SUBMIT', 'HR_MONTH_APPROVE', 'HR_MONTH_EXPORT'] },
  { id: 'stores', label: '门店管理', icon: '⌂', group: '基础资料', admin: true },
  { id: 'categories', label: '菜品分类', icon: '▤', group: '基础资料', admin: true },
  { id: 'products', label: '菜品管理', icon: '▦', group: '基础资料', admin: true },
  { id: 'users', label: '用户与权限', icon: '◉', group: '组织与权限', admin: true },
  { id: 'hrRoles', label: '角色管理', icon: '◉', group: '组织与权限', admin: true, hr: true },
  { id: 'hrWorkflows', label: '人事审批流程', icon: '⇢', group: '人事管理', admin: true, hr: true },
  { id: 'hrOcrCredentials', label: 'OCR 识别配置', icon: '▣', group: '系统设置', admin: true, hr: true },
  { id: 'miniappDecoration', label: '小程序预览与装修', icon: '▣', group: '小程序管理', admin: true },
  { id: 'systemAlerts', label: '系统告警', icon: '⚠', group: '系统设置', admin: true },
  { id: 'passwordPolicy', label: '默认密码策略', icon: '⌑', group: '系统设置', admin: true },
  { id: 'account', label: '密码修改', icon: '⚙', group: '系统设置' },
]
const visibleModules = computed(() => modules.filter(item => {
  if (mustChangePassword.value) return item.id === 'account'
  if (item.admin && role.value !== 'ADMIN') return false
  if (!item.hr) return true
  // Admin-only HR configuration already requires the ADMIN account role above.
  // Keep those navigation entries visible during HR-access API outages; the
  // corresponding backend endpoints still enforce authorization.
  if (!item.hrPermission && !item.hrPermissions) return true
  return hrStores.value.some(store =>
    (item.hrPermission != null && store.permissionCodes.includes(item.hrPermission)) ||
    (item.hrPermissions?.some(code => store.permissionCodes.includes(code)) ?? false))
}))
const openTabModules = computed(() => openTabs.value
  .map(id => visibleModules.value.find(item => item.id === id))
  .filter((item): item is (typeof modules)[number] => Boolean(item)))
watch(visibleModules, () => {
  const allowed = new Set(visibleModules.value.map(item => item.id))
  openTabs.value = openTabs.value.filter(id => allowed.has(id))
  if (mustChangePassword.value) {
    if (!openTabs.value.includes('account')) openTabs.value.push('account')
    current.value = 'account'
    return
  }
  if (!openTabs.value.length) openTabs.value = ['dashboard']
  if (!openTabs.value.includes(current.value)) current.value = openTabs.value[openTabs.value.length - 1] ?? 'dashboard'
}, { deep: true })
const navigationGroups = computed(() => [...new Set(visibleModules.value.map(item => item.group))].map(group => ({
  name: group,
  items: visibleModules.value.filter(item => item.group === group),
})))
const expandedGroups = ref<string[]>([])
const mobileMenuOpen = ref(false)
const isExpanded = (group: string) => expandedGroups.value.includes(group)
const toggleGroup = (group: string) => {
  expandedGroups.value = isExpanded(group)
    ? expandedGroups.value.filter(item => item !== group)
    : [...expandedGroups.value, group]
}
const groupHasActiveItem = (group: { items: Array<{ id: Module }> }) => group.items.some(item => item.id === current.value)
const title = computed(() => modules.find(item => item.id === current.value)?.label ?? '')
async function loadStores() {
  try { const path = role.value === 'ADMIN' ? '/api/stores' : '/api/auth/stores'; const response = await fetch(`${apiBase}${path}`, { headers: headers() }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? '读取门店列表失败'); stores.value = data.filter((store: Store) => store.status !== false).map((store: Store) => ({ ...store, storeCode: store.storeCode ?? '' })); if (stores.value.length && !stores.value.some(store => String(store.id) === storeId.value) && storeId.value !== 'ALL') storeId.value = stores.value.length > 1 ? 'ALL' : String(stores.value[0].id); if (stores.value.length > 1 && !storeId.value) storeId.value = 'ALL'; if (stores.value.length === 1 && storeId.value === 'ALL') storeId.value = String(stores.value[0].id) } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取门店列表失败' }
}
async function loadHrAccess() {
  hrStores.value = []
  canConfigureHr.value = false
  hrAccessMessage.value = ''
  if (!signedIn.value) return
  try {
    const response = await fetch(`${apiBase}/api/hr/current-access`, { headers: headers() })
    if (!response.ok) {
      hrAccessMessage.value = `人事权限读取失败（HTTP ${response.status}），请检查账号权限或联系管理员。`
      return
    }
    const data = await response.json()
    hrStores.value = Array.isArray(data.stores) ? data.stores : []
    canConfigureHr.value = data.canConfigure === true
    if (!hrStores.value.length) hrAccessMessage.value = canConfigureHr.value
      ? '当前账号没有已授权的管理门店，请在用户管理中检查账号门店和功能角色。'
      : '当前账号没有可用的功能角色或管理门店，相关菜单暂不可见。'
  } catch { hrStores.value = []; hrAccessMessage.value = '无法连接人事权限接口，请检查网络或联系管理员。' }
}
async function loadProfile() { if (!signedIn.value) return; try { const response = await fetch(`${apiBase}/api/auth/me`, { headers: headers() }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? '登录状态已失效'); role.value = data.role; mustChangePassword.value = data.mustChangePassword === true; if (mustChangePassword.value) go('account'); localStorage.setItem('userRole', data.role) } catch { logout() } }
async function openAvailableHome() {
  if (mustChangePassword.value) { go('account'); return }
  await loadHrAccess()
  await loadStores()
  if (hrStores.value.length && !stores.value.length) error.value = ''
  if (stores.value.length) await loadReport()
  else if (hrEmployeeStores.value.length) go('hrEmployeeRoster')
  else if (hrMonthlyStores.value.length) go('hrMonthly')
  if (hrAccessMessage.value) error.value = hrAccessMessage.value
}
onMounted(async () => {
  if (!signedIn.value) return
  await loadProfile()
  if (signedIn.value) await openAvailableHome()
})
async function login() {
  loading.value = true; error.value = ''
  try {
    const response = await fetch(`${apiBase}/api/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: mobile.value, password: password.value }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '登录失败')
    token.value = data.accessToken; role.value = data.user?.role ?? ''
    mustChangePassword.value = data.user?.mustChangePassword === true
    localStorage.setItem('accessToken', data.accessToken)
    localStorage.setItem('userRole', role.value)
    if (mustChangePassword.value) go('account')
    else await openAvailableHome()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '登录失败' }
  finally { loading.value = false }
}
async function loadReport() {
  loading.value = true; error.value = ''
  try {
    if (storeId.value === 'ALL') {
      if (!stores.value.length) throw new Error('当前账号没有可查看的门店')
      const results = await Promise.all(stores.value.map(async store => {
        const response = await fetch(`${apiBase}/api/reports/daily?storeId=${store.id}&date=${date.value}`, { headers: headers() })
        const data = await response.json()
        if (!response.ok) throw new Error(`${store.storeName}：${data.message ?? '读取日报失败'}`)
        return data as Report
      }))
      const sum = (items: Array<number | null | undefined>) => items.some(value => value != null)
        ? items.reduce<number>((total, value) => total + (value == null ? 0 : Number(value)), 0) : null
      const combine = (key: 'total' | 'dineIn' | 'delivery') => {
        const amountValue = sum(results.map(item => item.sales[key].amount))
        const customerValue = sum(results.map(item => item.sales[key].customers))
        return { amount: amountValue, customers: customerValue,
          avgOrderValue: amountValue != null && customerValue ? amountValue / customerValue : null }
      }
      const categories = new Map<number, { categoryId: number; categoryName: string; quantity: number }>()
      for (const item of results.flatMap(report => report.categorySales ?? [])) {
        const current = categories.get(item.categoryId)
        categories.set(item.categoryId, { ...item, quantity: (current?.quantity ?? 0) + Number(item.quantity ?? 0) })
      }
      report.value = { store: { name: '全部授权门店' }, date: date.value,
        status: { complete: results.every(item => item.status.complete), manualInputReady: results.every(item => item.status.manualInputReady) },
        sales: { total: combine('total'), dineIn: combine('dineIn'), delivery: combine('delivery') },
        categorySales: [...categories.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'zh-CN')) }
    } else {
      const response = await fetch(`${apiBase}/api/reports/daily?storeId=${storeId.value}&date=${date.value}`, { headers: headers() })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? '读取日报失败')
      report.value = data
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取日报失败' }
  finally { loading.value = false }
}
function go(id: Module) {
  if (!visibleModules.value.some(item => item.id === id)) return
  if (mustChangePassword.value && id !== 'account') return
  if (mustChangePassword.value) openTabs.value = ['account']
  else if (!openTabs.value.includes(id)) openTabs.value = [...openTabs.value, id]
  current.value = id
  const group = modules.find(item => item.id === id)?.group
  if (group && !isExpanded(group)) expandedGroups.value = [...expandedGroups.value, group]
  mobileMenuOpen.value = false
  if (['dashboard','reports','input','operations'].includes(id) && !report.value) void loadReport()
}
function openTrialOnboarding(request: { trialEmployeeId: number; storeId: number }) {
  trialConversionRequest.value = { ...request, nonce: ++trialConversionNonce }
  go('hrOnboarding')
}
function activateWorkspaceTab(id: Module) {
  if (!openTabs.value.includes(id) || !visibleModules.value.some(item => item.id === id)) return
  if (mustChangePassword.value && id !== 'account') return
  current.value = id
  const group = modules.find(item => item.id === id)?.group
  if (group && !isExpanded(group)) expandedGroups.value = [...expandedGroups.value, group]
  if (['dashboard','reports','input','operations'].includes(id) && !report.value) void loadReport()
}
function closeTab(id: Module) {
  if (id === 'dashboard' || (id === 'account' && mustChangePassword.value)) return
  const index = openTabs.value.indexOf(id)
  if (index < 0) return
  const fallback = openTabs.value[index - 1] ?? openTabs.value[index + 1] ?? 'dashboard'
  openTabs.value = openTabs.value.filter(tab => tab !== id)
  if (current.value === id) current.value = fallback
}
function closeOtherTabs() {
  if (mustChangePassword.value) return
  openTabs.value = current.value === 'dashboard' ? ['dashboard'] : ['dashboard', current.value]
}
function passwordChanged(result: { accessToken?: string; user?: { role?: string } }) { if (result.accessToken) { token.value = result.accessToken; localStorage.setItem('accessToken', result.accessToken) }; if (result.user?.role) { role.value = result.user.role; localStorage.setItem('userRole', role.value) }; mustChangePassword.value = false; void openAvailableHome() }
function logout() { token.value = ''; role.value = ''; mustChangePassword.value = false; hrStores.value = []; canConfigureHr.value = false; report.value = null; current.value = 'dashboard'; openTabs.value = ['dashboard']; localStorage.removeItem('accessToken'); localStorage.removeItem('userRole') }
</script>
<template><main v-if="!signedIn" class="login-shell"><section class="login card"><div class="login-badge">MIXIONG</div><h1>登录总部后台</h1><p>使用总部管理员账号进入经营日报系统。</p><label>手机号<input v-model="mobile" autocomplete="username" placeholder="请输入手机号" /></label><label>密码<input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" @keyup.enter="login" /></label><p v-if="error" class="error" v-popup-error="error">{{ error }}</p><button class="login-button" :disabled="loading" @click="login">{{ loading ? '正在登录…' : '登录系统' }}</button></section></main><div v-else class="app-layout"><div v-if="mobileMenuOpen" class="mobile-menu-backdrop" @click="mobileMenuOpen = false"></div><aside class="sidebar" :class="{ 'mobile-open': mobileMenuOpen }"><div class="side-brand"><div class="brand-mark">米</div><div><strong>米熊</strong><span>经营日报系统</span></div><button class="mobile-menu-close" aria-label="关闭菜单" @click="mobileMenuOpen = false">×</button></div><nav class="nav-tree"><section v-for="group in navigationGroups" :key="group.name" class="nav-section"><button class="nav-parent" :class="{ active: groupHasActiveItem(group) }" @click="toggleGroup(group.name)"><span>{{ group.name }}</span><i :class="{ expanded: isExpanded(group.name) }">⌄</i></button><div v-show="isExpanded(group.name)" class="nav-children"><button v-for="item in group.items" :key="item.id" class="nav-item" :class="{ active: current === item.id }" @click="go(item.id)"><i>{{ item.icon }}</i>{{ item.label }}</button></div></section></nav><div class="side-footer"><span><i></i>服务运行正常</span></div></aside><section class="main-panel"><header class="topbar"><button class="mobile-menu-trigger" aria-label="打开功能菜单" @click="mobileMenuOpen = true">☰</button><div><span class="breadcrumb">米熊经营日报 / {{ title }}</span><h1>{{ title }}</h1></div><div class="topbar-actions"><span class="today">{{ date }}</span><button class="quiet" @click="logout">退出登录</button></div></header><div class="workspace-tabbar" role="tablist" aria-label="已打开功能"><div class="workspace-tabs"><div v-for="item in openTabModules" :key="item.id" class="workspace-tab" :class="{ active: current === item.id }"><button type="button" class="workspace-tab-main" role="tab" :aria-selected="current === item.id" @click="activateWorkspaceTab(item.id)"><span class="workspace-tab-icon">{{ item.icon }}</span><span>{{ item.label }}</span></button><button v-if="item.id !== 'dashboard' && !mustChangePassword" type="button" class="workspace-tab-close" :aria-label="'关闭' + item.label" @click.stop="closeTab(item.id)">×</button></div></div><button v-if="openTabModules.length > 1 && !mustChangePassword" type="button" class="close-other-tabs" @click="closeOtherTabs">关闭其他</button></div><div class="page-content"><p v-if="error" class="error alert" v-popup-error="error">{{ error }}</p><template v-if="['dashboard','reports','input','operations'].includes(current)"><section class="toolbar card"><div class="filter-title"><span>日报筛选</span><small>选择门店与营业日期</small></div><label>选择门店<select v-model="storeId"><option v-if="stores.length > 1" value="ALL">全部授权门店</option><option v-if="!stores.length" value="">加载门店中…</option><option v-for="store in stores" :key="store.id" :value="String(store.id)">{{ store.storeName }}（{{ store.storeCode }}）</option></select></label><label>营业日期<input v-model="date" type="date" /></label><button :disabled="loading" @click="loadReport">{{ loading ? '加载中…' : '查询日报' }}</button></section></template><template v-if="current === 'dashboard'"><section class="dashboard-head"><div><span class="eyebrow">DAILY OPERATIONS</span><h2>{{ report?.store.name || '经营数据概览' }}</h2><p>汇总门店当日经营数据与日报完成状态。</p></div><span :class="report?.status.complete ? 'ready' : 'pending'">{{ report?.status.complete ? '数据完整' : '待补充数据' }}</span></section><section v-if="report" class="metrics"><article><span>总销售额</span><b>{{ amount(report.sales.total.amount) }}</b><small>当天累计营业额</small></article><article><span>总入客</span><b>{{ number(report.sales.total.customers) }}</b><small>堂食与外卖合计</small></article><article><span>客单价</span><b>{{ amount(report.sales.total.avgOrderValue) }}</b><small>按入客数自动计算</small></article><article><span>人工填报</span><b>{{ report.status.manualInputReady ? '已完成' : '待填写' }}</b><small>能耗、工时与运营指标</small></article></section><section v-if="report" class="card data-card"><h2>销售渠道</h2><table><thead><tr><th>类型</th><th>销售额</th><th>入客数</th><th>客单价</th></tr></thead><tbody><tr v-for="item in [{ name: '总计', ...report.sales.total }, { name: '堂食', ...report.sales.dineIn }, { name: '外卖', ...report.sales.delivery }]" :key="item.name"><td>{{ item.name }}</td><td>{{ amount(item.amount) }}</td><td>{{ number(item.customers) }}</td><td>{{ amount(item.avgOrderValue) }}</td></tr></tbody></table></section></template><template v-if="current === 'reports'"><section v-if="report" class="card report-detail"><div class="report-heading"><div><span class="eyebrow">DAILY REPORT</span><h2>{{ report.store.name }} · {{ report.date }}</h2></div><span :class="report.status.complete ? 'ready' : 'pending'">{{ report.status.complete ? '数据完整' : '待补充数据' }}</span></div><section class="metrics compact-metrics"><article><span>总销售额</span><b>{{ amount(report.sales.total.amount) }}</b></article><article><span>总入客</span><b>{{ number(report.sales.total.customers) }}</b></article><article><span>客单价</span><b>{{ amount(report.sales.total.avgOrderValue) }}</b></article></section><h2>菜品分类</h2><table><thead><tr><th>分类</th><th>销量</th></tr></thead><tbody><tr v-for="category in report.categorySales" :key="category.categoryId"><td>{{ category.categoryName }}</td><td>{{ category.quantity }}</td></tr></tbody></table></section></template><p v-if="(current === 'input' || current === 'operations') && storeId === 'ALL'" class="card all-store-note">当前为全部授权门店汇总，请选择单家门店后进行填报、同步或审核操作。</p><div v-if="openTabs.includes('input') && storeId !== 'ALL'" v-show="current === 'input'"><DailyInputForm :api-base="apiBase" :headers="headers" :store-id="storeId" :date="date" @saved="loadReport" /></div><div v-if="openTabs.includes('operations') && storeId !== 'ALL'" v-show="current === 'operations'"><ReportOperations :api-base="apiBase" :headers="headers" :store-id="storeId" :date="date" /></div><div v-if="openTabs.includes('operations') && storeId === 'ALL'" v-show="current === 'operations'"><ReportOperations :api-base="apiBase" :headers="headers" :store-id="storeId" :date="date" :stores="stores" /></div><div v-if="openTabs.includes('reminders')" v-show="current === 'reminders'"><ReminderManagement :api-base="apiBase" :headers="headers" /></div><div v-if="openTabs.includes('hrRoles')" v-show="current === 'hrRoles'"><HrRoleManagement :api-base="apiBase" :headers="headers" /></div><div v-if="openTabs.includes('hrWorkflows')" v-show="current === 'hrWorkflows'"><HrWorkflowManagement :api-base="apiBase" :headers="headers" /></div><div v-if="openTabs.includes('hrMonthly')" v-show="current === 'hrMonthly'"><HrMonthlyReview :api-base="apiBase" :headers="headers" :stores="hrMonthlyStores" /></div><div v-if="openTabs.includes('hrEmployeeRoster')" v-show="current === 'hrEmployeeRoster'"><HrEmployeeRoster :api-base="apiBase" :headers="headers" :stores="hrEmployeeStores" :is-admin="role === 'ADMIN'" /></div><div v-if="openTabs.includes('hrTrials')" v-show="current === 'hrTrials'"><HrTrials :api-base="apiBase" :headers="headers" :stores="hrTrialStores" @convert="openTrialOnboarding" /></div><div v-if="openTabs.includes('hrApprovals')" v-show="current === 'hrApprovals'"><HrApprovalInbox :api-base="apiBase" :headers="headers" :stores="hrApprovalStores" /></div><div v-if="openTabs.includes('hrOnboarding')" v-show="current === 'hrOnboarding'"><HrOnboarding :api-base="apiBase" :headers="headers" :stores="hrStores" :trial-conversion-request="trialConversionRequest" /></div><div v-if="openTabs.includes('hrJobPositions')" v-show="current === 'hrJobPositions'"><HrJobPositions :api-base="apiBase" :headers="headers" :stores="stores" /></div><div v-if="openTabs.includes('hrOffboarding')" v-show="current === 'hrOffboarding'"><HrOffboarding :api-base="apiBase" :headers="headers" :stores="hrStores" /></div><div v-if="openTabs.includes('hrSalary')" v-show="current === 'hrSalary'"><HrSalaryChanges :api-base="apiBase" :headers="headers" :stores="hrStores" /></div><div v-if="openTabs.includes('hrBankChanges')" v-show="current === 'hrBankChanges'"><HrBankChanges :api-base="apiBase" :headers="headers" :stores="hrStores" /></div><div v-if="openTabs.includes('miniappDecoration')" v-show="current === 'miniappDecoration'"><MiniappDecoration :api-base="apiBase" :headers="headers" /></div><div v-if="openTabs.includes('hrOcrCredentials')" v-show="current === 'hrOcrCredentials'"><HrOcrCredentials :api-base="apiBase" :headers="headers" /></div><div v-if="openTabs.includes('users')" v-show="current === 'users'"><UserManagement :api-base="apiBase" :headers="headers" :enable-hr-permissions="canConfigureHr" /></div><div v-if="openTabs.includes('stores')" v-show="current === 'stores'"><MasterDataManagement :api-base="apiBase" :headers="headers" section="stores" /></div><div v-if="openTabs.includes('categories')" v-show="current === 'categories'"><MasterDataManagement :api-base="apiBase" :headers="headers" section="categories" /></div><div v-if="openTabs.includes('products')" v-show="current === 'products'"><MasterDataManagement :api-base="apiBase" :headers="headers" section="products" /></div><div v-if="openTabs.includes('systemAlerts')" v-show="current === 'systemAlerts'"><SystemAlerts :api-base="apiBase" :headers="headers" /></div><div v-if="openTabs.includes('passwordPolicy')" v-show="current === 'passwordPolicy'"><PasswordPolicy :api-base="apiBase" :headers="headers" /></div><div v-if="openTabs.includes('account')" v-show="current === 'account'"><ChangePassword :api-base="apiBase" :headers="headers" :required="mustChangePassword" @completed="passwordChanged" /></div></div></section></div></template>
