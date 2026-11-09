<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeCode: string; storeName: string; externalStoreCode: string | null; status: boolean }
type Category = { id: number; categoryCode: string; categoryName: string; sortOrder: number; status: boolean; reportVisible: boolean }
type Product = { id: number; externalProductCode: string; productName: string; categoryId: number; salePrice: number | null; theoreticalCost: number | null; status: boolean; isPackage: boolean; reportCategoryId: number | null; reportCategoryName: string | null; categoryReportVisible: boolean; reportVisible: boolean; reportProductId: number | null; reportProductName: string | null }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; section: 'stores' | 'categories' | 'products' }>()
const stores = ref<Store[]>([])
const categories = ref<Category[]>([])
const products = ref<Product[]>([])
const message = ref('')
const syncMessage = ref('')
const loading = ref(false)
const syncingCatalog = ref(false)
const changingCategoryId = ref<number | null>(null)
const changingProductId = ref<number | null>(null)
const productKeyword = ref('')
const selectedCategoryId = ref('')
const hideInactive = ref(false)
const hidePackages = ref(false)
const page = ref(1)
const storePageSize = ref(20)
const categoryPageSize = ref(20)
const productPageSize = ref(20)
const catalogPage = ref(1)
const pagedStores = computed(() => stores.value.slice((catalogPage.value - 1) * storePageSize.value, catalogPage.value * storePageSize.value))
const pagedCategories = computed(() => categories.value.slice((catalogPage.value - 1) * categoryPageSize.value, catalogPage.value * categoryPageSize.value))
const rollupSource = ref<Product | null>(null)
const rollupTargetId = ref('')
const rollupKeyword = ref('')
const filteredProducts = computed(() => products.value.filter(product => {
  const keyword = productKeyword.value.trim().toLowerCase()
  return (!selectedCategoryId.value || String(product.categoryId) === selectedCategoryId.value)
    && (!hideInactive.value || product.status)
    && (!hidePackages.value || !product.isPackage)
    && (!keyword || product.productName.toLowerCase().includes(keyword) || product.externalProductCode.toLowerCase().includes(keyword))
}))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredProducts.value.length / productPageSize.value)))
const pagedProducts = computed(() => filteredProducts.value.slice((page.value - 1) * productPageSize.value, page.value * productPageSize.value))
const categoryNames = computed(() => new Map(categories.value.map(category => [category.id, category.categoryName])))
const visibleRollupTargets = computed(() => products.value.filter(product => product.reportVisible
  && categories.value.some(category => category.id === product.categoryId && category.reportVisible)
  && product.id !== rollupSource.value?.id
  && (!rollupKeyword.value.trim() || product.productName.toLowerCase().includes(rollupKeyword.value.trim().toLowerCase())
    || product.externalProductCode.toLowerCase().includes(rollupKeyword.value.trim().toLowerCase()))))
watch([productKeyword, selectedCategoryId, hideInactive, hidePackages], () => { page.value = 1 })
watch(pageCount, count => { if (page.value > count) page.value = count })
let loadRequestId = 0

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init.headers ?? {}) } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? '请求失败')
  return body
}
async function load() {
  const requestId = ++loadRequestId
  const section = props.section
  loading.value = true; message.value = ''
  try {
    if (section === 'stores') {
      const result = await request('/api/stores')
      if (requestId !== loadRequestId) return false
      stores.value = result
      catalogPage.value = Math.min(catalogPage.value, Math.max(1, Math.ceil(stores.value.length / storePageSize.value)))
    } else if (section === 'categories') {
      const result = await request('/api/categories')
      if (requestId !== loadRequestId) return false
      categories.value = result
      catalogPage.value = Math.min(catalogPage.value, Math.max(1, Math.ceil(categories.value.length / categoryPageSize.value)))
    } else {
      const [categoryResult, productResult] = await Promise.allSettled([request('/api/categories'), request('/api/products')])
      if (requestId !== loadRequestId) return false
      const errors: string[] = []
      if (categoryResult.status === 'fulfilled') categories.value = categoryResult.value
      else errors.push(`分类读取失败：${categoryResult.reason instanceof Error ? categoryResult.reason.message : '请重试'}`)
      if (productResult.status === 'fulfilled') products.value = productResult.value
      else errors.push(`菜品读取失败：${productResult.reason instanceof Error ? productResult.reason.message : '请重试'}`)
      if (errors.length) message.value = errors.join('；')
      page.value = Math.min(page.value, Math.max(1, Math.ceil(filteredProducts.value.length / productPageSize.value)))
      return errors.length === 0
    }
    return true
  }
  catch (cause) {
    if (requestId === loadRequestId) message.value = cause instanceof Error ? cause.message : '读取同步资料失败'
    return false
  }
  finally { if (requestId === loadRequestId) loading.value = false }
}
async function syncCatalog() {
  syncingCatalog.value = true; syncMessage.value = ''; message.value = ''
  try {
    const result = await request('/api/sync/master', { method: 'POST' })
    if (!(await load())) throw new Error(message.value || '同步成功，但读取本地目录失败')
    syncMessage.value = `POS 同步完成：${result.stores} 家门店、${result.categoriesProcessed} 个分类、${result.productsProcessed} 个菜品；停用 ${result.categoriesDeactivated} 个分类、${result.productsDeactivated} 个菜品。`
  } catch (cause) { message.value = cause instanceof Error ? cause.message : 'POS 菜品目录同步失败' }
  finally { syncingCatalog.value = false }
}
async function toggleReportVisible(category: Category) {
  changingCategoryId.value = category.id; message.value = ''
  try {
    await request(`/api/categories/${category.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportVisible: !category.reportVisible }) })
    category.reportVisible = !category.reportVisible
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '更新日报显示设置失败' }
  finally { changingCategoryId.value = null }
}
async function toggleProductVisible(product: Product) {
  changingProductId.value = product.id; message.value = ''
  try {
    await request(`/api/products/${product.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportVisible: !product.reportVisible }) })
    product.reportVisible = !product.reportVisible
    if (product.reportVisible) { product.reportProductId = null; product.reportProductName = null }
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '更新菜品显示设置失败' }
  finally { changingProductId.value = null }
}
async function setProductReportTarget(product: Product, value: string) {
  changingProductId.value = product.id; message.value = ''
  const reportProductId = value ? Number(value) : null
  try {
    await request(`/api/products/${product.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportProductId }) })
    product.reportProductId = reportProductId
    product.reportProductName = reportProductId ? products.value.find(item => item.id === reportProductId)?.productName ?? null : null
    return true
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '更新菜品归集目标失败' }
  finally { changingProductId.value = null }
  return false
}
function openRollup(product: Product) {
  rollupSource.value = product
  rollupTargetId.value = product.reportProductId ? String(product.reportProductId) : ''
  rollupKeyword.value = ''
}
async function saveRollup() {
  if (!rollupSource.value) return
  if (await setProductReportTarget(rollupSource.value, rollupTargetId.value)) rollupSource.value = null
}
watch(() => props.section, () => {
  page.value = 1
  catalogPage.value = 1
  message.value = ''
  syncMessage.value = ''
  void load()
}, { immediate: true })
const statusText = (status: boolean) => status ? '启用' : '停用'
</script>
<template>
  <section v-if="section === 'stores'" class="card master">
    <div class="master-header"><div><h2>门店同步资料</h2><p>门店信息由经营系统同步维护，仅供查看。</p></div><button class="quiet" :disabled="loading" @click="load">{{ loading ? '刷新中…' : '刷新数据' }}</button></div>
    <div class="table-scroll"><table><thead><tr><th>内部编码</th><th>门店名称</th><th>POS 门店编码</th><th>状态</th></tr></thead><tbody><tr v-for="store in pagedStores" :key="store.id"><td>{{ store.storeCode }}</td><td>{{ store.storeName }}</td><td>{{ store.externalStoreCode ?? '—' }}</td><td><span :class="store.status ? 'status-on' : 'status-off'">{{ statusText(store.status) }}</span></td></tr><tr v-if="!stores.length && !loading"><td colspan="4">暂无同步门店数据</td></tr></tbody></table></div><PaginationControls v-model:page="catalogPage" v-model:page-size="storePageSize" :total="stores.length" :always="true" />
  </section>
  <section v-if="section === 'categories'" class="card master">
    <div class="master-header"><div><h2>菜品分类同步资料</h2><p>分类来自 POS 商品目录。可控制某分类及其菜品销量是否在日报、简报与导出中显示。</p></div><div class="master-actions"><span class="data-count">{{ loading ? '读取中…' : `${categories.length} 个分类` }}</span><button class="quiet" :disabled="loading" @click="load">刷新数据</button><button class="sync-button" :disabled="loading || syncingCatalog" @click="syncCatalog">{{ syncingCatalog ? '正在同步 POS…' : '从 POS 同步' }}</button></div></div>
    <div v-if="loading" class="master-state">正在读取 POS 同步的分类资料…</div>
    <div v-else class="table-scroll"><table><thead><tr><th>分类编码</th><th>分类名称</th><th>排序</th><th>同步状态</th><th>日报显示</th><th>操作</th></tr></thead><tbody><tr v-for="category in pagedCategories" :key="category.id"><td>{{ category.categoryCode }}</td><td>{{ category.categoryName }}</td><td>{{ category.sortOrder }}</td><td><span :class="category.status ? 'status-on' : 'status-off'">{{ statusText(category.status) }}</span></td><td><span :class="category.reportVisible ? 'status-on' : 'status-off'">{{ category.reportVisible ? '显示' : '隐藏' }}</span></td><td><button class="visibility-button" :disabled="changingCategoryId === category.id" @click="toggleReportVisible(category)">{{ changingCategoryId === category.id ? '处理中…' : category.reportVisible ? '隐藏日报' : '显示日报' }}</button></td></tr><tr v-if="!categories.length"><td colspan="6">暂无同步分类数据</td></tr></tbody></table></div><PaginationControls v-if="!loading" v-model:page="catalogPage" v-model:page-size="categoryPageSize" :total="categories.length" :always="true" />
    <p class="hint">隐藏分类后，该分类不在日报显示；其中单独隐藏并设置菜品归集的销量，会计入指定的显示菜品。</p>
    <p v-if="message" class="error" v-popup-error="message">{{ message }}</p>
    <p v-if="syncMessage" class="sync-message">{{ syncMessage }}</p>
  </section>
  <section v-if="section === 'products'" class="card master">
    <div class="master-header"><div><h2>菜品同步资料</h2><p>菜品编码、名称、分类、售价和启停状态由 POS 同步维护。</p></div><div class="master-actions"><span class="data-count">{{ loading ? '读取中…' : `${products.length} 个菜品` }}</span><button class="quiet" :disabled="loading" @click="load">刷新数据</button><button class="sync-button" :disabled="loading || syncingCatalog" @click="syncCatalog">{{ syncingCatalog ? '正在同步 POS…' : '从 POS 同步' }}</button></div></div>
    <div class="product-filters"><input v-model="productKeyword" placeholder="搜索菜品名称或 POS 编码" /><select v-model="selectedCategoryId"><option value="">全部分类</option><option v-for="category in categories" :key="category.id" :value="String(category.id)">{{ category.categoryName }}</option></select><label><input v-model="hideInactive" type="checkbox" /> 不显示停用菜品</label><label><input v-model="hidePackages" type="checkbox" /> 不显示套餐</label><span>符合 {{ filteredProducts.length }} 道</span></div>
    <div v-if="loading" class="master-state">正在读取菜品和分类资料…</div>
    <div v-else class="table-scroll"><table class="product-table"><colgroup><col style="width:130px"><col style="width:190px"><col style="width:66px"><col style="width:110px"><col style="width:75px"><col style="width:85px"><col style="width:80px"><col style="width:130px"><col style="width:180px"></colgroup><thead><tr><th>POS 商品编码</th><th>菜品名称</th><th>类型</th><th>POS 分类</th><th>售价</th><th>理论成本</th><th>POS 状态</th><th>菜品销量</th><th>归集到菜品</th></tr></thead><tbody><tr v-for="product in pagedProducts" :key="product.id"><td>{{ product.externalProductCode }}</td><td class="product-name-cell" :title="product.productName">{{ product.productName }}</td><td>{{ product.isPackage ? '套餐' : '单品' }}</td><td :title="categoryNames.get(product.categoryId) ?? '—'">{{ categoryNames.get(product.categoryId) ?? '—' }}</td><td>{{ product.salePrice ?? '—' }}</td><td>{{ product.theoreticalCost ?? '—' }}</td><td><span :class="product.status ? 'status-on' : 'status-off'">{{ statusText(product.status) }}</span></td><td><button class="visibility-button" :disabled="changingProductId === product.id" @click="toggleProductVisible(product)">{{ changingProductId === product.id ? '处理中…' : product.reportVisible ? '显示 · 点击隐藏' : '隐藏 · 点击显示' }}</button></td><td><template v-if="!product.reportVisible"><button class="visibility-button" :disabled="changingProductId === product.id" @click="openRollup(product)">{{ product.reportProductName ? `归集至 ${product.reportProductName}` : '设置归集' }}</button></template><span v-else>—</span><small v-if="product.reportCategoryId && !product.reportProductId" class="legacy-rollup">旧分类归集：{{ product.reportCategoryName }}，请改为菜品归集</small></td></tr><tr v-if="!pagedProducts.length"><td colspan="9">没有符合条件的菜品</td></tr></tbody></table></div>
    <PaginationControls v-if="!loading" v-model:page="page" v-model:page-size="productPageSize" :total="filteredProducts.length" :always="true" />
    <p class="hint">列表筛选仅影响本页查看。分类和菜品可分别控制日报销量显示；隐藏的菜品可选归集目标。旧分类归集配置仍保留原报表结果，请逐条改为菜品归集。</p>
    <p v-if="message" class="error" v-popup-error="message">{{ message }}</p>
    <p v-if="syncMessage" class="sync-message">{{ syncMessage }}</p>
  </section>
  <div v-if="rollupSource" class="dialog-backdrop" @click.self="rollupSource = null"><section class="rollup-dialog card"><div class="dialog-heading"><div><h2>设置菜品销量归集</h2><p>{{ rollupSource.productName }} 的销量将计入指定的显示菜品。</p></div><button class="quiet" @click="rollupSource = null">关闭</button></div><input v-model="rollupKeyword" class="target-search" placeholder="搜索目标菜品名称或 POS 编码" /><select v-model="rollupTargetId" size="12" class="target-select"><option value="">不归集</option><option v-for="target in visibleRollupTargets" :key="target.id" :value="String(target.id)">{{ categoryNames.get(target.categoryId) ?? '未分类' }} · {{ target.productName }}（{{ target.externalProductCode }}）</option></select><p v-if="!visibleRollupTargets.length" class="master-state">没有符合条件的可归集菜品。</p><div class="dialog-actions"><button class="quiet" @click="rollupSource = null">取消</button><button class="sync-button" :disabled="changingProductId === rollupSource.id" @click="saveRollup">{{ changingProductId === rollupSource.id ? '保存中…' : '保存归集设置' }}</button></div></section></div>
</template>
<style scoped>
.master-header{display:flex;align-items:start;justify-content:space-between;gap:18px;margin-bottom:16px}.master-header h2{margin:0}.master-header p{margin:5px 0 0;color:#7b8799;font-size:13px}.data-count{padding:6px 9px;border-radius:8px;background:#f3f6fa;color:#637187;font-size:12px}.status-on,.status-off{display:inline-block;padding:4px 8px;border-radius:99px;font-size:11px;font-weight:700}.status-on{background:#e7f7ed;color:#237347}.status-off{background:#f2f4f7;color:#667085}.visibility-button{border:1px solid #d6dde8;background:#fff;color:#344054;border-radius:7px;padding:5px 9px;cursor:pointer;font-size:12px}.visibility-button:disabled{cursor:wait;opacity:.6}.hint{margin:14px 0 0;color:#667085;font-size:12px}.legacy-rollup{display:block;margin-top:5px;color:#a65c16;line-height:1.4}.product-filters{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:2px 0 16px}.product-filters>input{min-width:260px}.product-filters label{display:flex;align-items:center;gap:4px;white-space:nowrap;color:#475467;font-size:13px}.product-filters label input{width:auto;min-width:0}.product-filters span{color:#7b8799;font-size:12px}
.master-actions{display:flex;align-items:center;gap:9px;flex:none}.sync-button{min-height:34px;padding:7px 11px;font-size:12px}.sync-message{margin:12px 0 0;color:#237347;font-size:13px}
.master-state{padding:28px 16px;text-align:center;color:#68778c;background:#f7f9fc;border-radius:10px}.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;color:#667085;font-size:13px}.pagination>div{display:flex;gap:8px}.dialog-backdrop{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:20px;background:#11182788}.rollup-dialog{width:min(680px,100%);max-height:min(85vh,780px);display:flex;flex-direction:column;gap:14px;overflow:hidden}.dialog-heading{display:flex;justify-content:space-between;gap:16px}.dialog-heading h2{margin:0}.dialog-heading p{margin:6px 0 0;color:#667085}.target-search{min-height:38px}.target-select{width:100%;min-height:240px;flex:1;overflow:auto}.dialog-actions{display:flex;justify-content:flex-end;gap:10px}
.product-table{width:1046px;table-layout:fixed}.product-table th,.product-table td{overflow:hidden;text-overflow:ellipsis}.product-name-cell{white-space:nowrap}.master .table-scroll{max-width:100%;overflow:auto}.master .target-select{box-sizing:border-box;max-width:100%}
@media(max-width:720px){.master-header{flex-direction:column}.master-actions{flex-wrap:wrap}.pagination{font-size:12px}.rollup-dialog{max-height:90vh}}
</style>
