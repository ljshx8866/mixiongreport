<script setup lang="ts">
import { computed, ref } from 'vue'
import DailyInputForm from './components/DailyInputForm.vue'
import UserManagement from './components/UserManagement.vue'
import MasterDataManagement from './components/MasterDataManagement.vue'
import ReportOperations from './components/ReportOperations.vue'

type Report = { store: { name: string }; date: string; status: { complete: boolean; manualInputReady: boolean }; sales: { total: Metrics; dineIn: Metrics; delivery: Metrics }; categorySales: { categoryId: number; categoryName: string; quantity: number }[] }
type Metrics = { amount: number | null; customers: number | null; avgOrderValue: number | null }
const apiBase = import.meta.env.VITE_API_BASE ?? ''
const token = ref(localStorage.getItem('accessToken') ?? '')
const mobile = ref(''); const password = ref(''); const error = ref(''); const loading = ref(false)
const storeId = ref('2'); const date = ref(new Date().toISOString().slice(0, 10)); const report = ref<Report | null>(null)
const signedIn = computed(() => Boolean(token.value))
const headers = () => ({ Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' })
const amount = (value: number | null) => value == null ? '—' : `¥${Number(value).toFixed(2)}`
const number = (value: number | null) => value == null ? '—' : String(value)

async function login() {
  loading.value = true; error.value = ''
  try {
    const response = await fetch(`${apiBase}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: mobile.value, password: password.value }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '登录失败')
    token.value = data.accessToken; localStorage.setItem('accessToken', data.accessToken); await loadReport()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '登录失败' } finally { loading.value = false }
}
async function loadReport() {
  loading.value = true; error.value = ''
  try {
    const response = await fetch(`${apiBase}/api/reports/daily?storeId=${storeId.value}&date=${date.value}`, { headers: headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '读取日报失败')
    report.value = data
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取日报失败' } finally { loading.value = false }
}
function logout() { token.value = ''; report.value = null; localStorage.removeItem('accessToken') }
</script>

<template>
  <main class="shell">
    <header><strong>米熊经营日报</strong><span>总部管理后台</span><button v-if="signedIn" class="quiet" @click="logout">退出</button></header>
    <section v-if="!signedIn" class="login card"><h1>登录</h1><p>使用总部或门店账号进入系统。</p><label>手机号<input v-model="mobile" autocomplete="username" /></label><label>密码<input v-model="password" type="password" autocomplete="current-password" @keyup.enter="login" /></label><p v-if="error" class="error">{{ error }}</p><button :disabled="loading" @click="login">登录</button></section>
    <template v-else>
      <section class="toolbar card"><label>门店 ID<input v-model="storeId" type="number" min="1" /></label><label>营业日期<input v-model="date" type="date" /></label><button :disabled="loading" @click="loadReport">查询日报</button></section>
      <p v-if="error" class="error">{{ error }}</p>
      <UserManagement :api-base="apiBase" :headers="headers" />
      <MasterDataManagement :api-base="apiBase" :headers="headers" />
      <ReportOperations :api-base="apiBase" :headers="headers" :store-id="storeId" :date="date" />
      <template v-if="report"><section class="title"><h1>{{ report.store.name }} · {{ report.date }} 经营日报</h1><span :class="report.status.complete ? 'ready' : 'pending'">{{ report.status.complete ? '数据完整' : '待补充数据' }}</span></section><section class="metrics"><article><span>总销售</span><b>{{ amount(report.sales.total.amount) }}</b></article><article><span>总入客</span><b>{{ number(report.sales.total.customers) }}</b></article><article><span>客单价</span><b>{{ amount(report.sales.total.avgOrderValue) }}</b></article><article><span>人工填报</span><b>{{ report.status.manualInputReady ? '已完成' : '未完成' }}</b></article></section><DailyInputForm :api-base="apiBase" :headers="headers" :store-id="storeId" :date="date" @saved="loadReport" /><section class="card"><h2>销售渠道</h2><table><thead><tr><th>类型</th><th>销售额</th><th>入客数</th><th>客单价</th></tr></thead><tbody><tr v-for="item in [{ name: '总计', ...report.sales.total }, { name: '堂食', ...report.sales.dineIn }, { name: '外卖', ...report.sales.delivery }]" :key="item.name"><td>{{ item.name }}</td><td>{{ amount(item.amount) }}</td><td>{{ number(item.customers) }}</td><td>{{ amount(item.avgOrderValue) }}</td></tr></tbody></table></section><section class="card"><h2>菜品分类</h2><table><tbody><tr v-for="category in report.categorySales" :key="category.categoryId"><td>{{ category.categoryName }}</td><td>{{ category.quantity }}</td></tr></tbody></table></section></template>
    </template>
  </main>
</template>
