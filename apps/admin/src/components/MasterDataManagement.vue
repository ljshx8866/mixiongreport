<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

type Store = { id: number; storeCode: string; storeName: string; externalStoreCode: string | null; status: boolean }
type Category = { id: number; categoryCode: string; categoryName: string; sortOrder: number; status: boolean }
type Product = { id: number; externalProductCode: string; productName: string; categoryId: number; salePrice: number | null; theoreticalCost: number | null; status: boolean }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const stores = ref<Store[]>([]); const categories = ref<Category[]>([]); const products = ref<Product[]>([]); const message = ref(''); const loading = ref(false)
const storeForm = reactive({ storeCode: '', storeName: '', externalStoreCode: '' })
const categoryForm = reactive({ categoryCode: '', categoryName: '', sortOrder: '0' })
const productForm = reactive({ externalProductCode: '', productName: '', categoryId: '', salePrice: '', theoreticalCost: '' })
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const body = await response.json(); if (!response.ok) throw new Error(body.message ?? '请求失败'); return body
}
async function load() {
  loading.value = true; message.value = ''
  try { [stores.value, categories.value, products.value] = await Promise.all([request('/api/stores'), request('/api/categories'), request('/api/products')]) }
  catch (cause) { message.value = cause instanceof Error ? cause.message : '读取主数据失败' } finally { loading.value = false }
}
async function createStore() { await create('/api/stores', storeForm, () => { storeForm.storeCode = ''; storeForm.storeName = ''; storeForm.externalStoreCode = '' }) }
async function createCategory() { await create('/api/categories', { ...categoryForm, sortOrder: Number(categoryForm.sortOrder) }, () => { categoryForm.categoryCode = ''; categoryForm.categoryName = ''; categoryForm.sortOrder = '0' }) }
async function createProduct() { await create('/api/products', { ...productForm, categoryId: Number(productForm.categoryId), salePrice: productForm.salePrice === '' ? undefined : Number(productForm.salePrice), theoreticalCost: productForm.theoreticalCost === '' ? undefined : Number(productForm.theoreticalCost) }, () => { productForm.externalProductCode = ''; productForm.productName = ''; productForm.categoryId = ''; productForm.salePrice = ''; productForm.theoreticalCost = '' }) }
async function create(path: string, body: unknown, clear: () => void) {
  loading.value = true; message.value = ''
  try { await request(path, { method: 'POST', body: JSON.stringify(body) }); clear(); message.value = '已保存。'; await load() }
  catch (cause) { message.value = cause instanceof Error ? cause.message : '保存失败' } finally { loading.value = false }
}
async function toggle(path: string, item: { id: number; status: boolean }) {
  try { await request(`${path}/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: !item.status }) }); await load() }
  catch (cause) { message.value = cause instanceof Error ? cause.message : '更新失败' }
}
onMounted(load)
</script>

<template>
  <section class="card master"><h2>门店管理</h2><div class="entry-grid"><label>内部编码<input v-model="storeForm.storeCode" /></label><label>门店名称<input v-model="storeForm.storeName" /></label><label>POS 门店编码<input v-model="storeForm.externalStoreCode" /></label><button :disabled="loading" @click="createStore">新增门店</button></div><table><thead><tr><th>编码</th><th>门店</th><th>POS 编码</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="store in stores" :key="store.id"><td>{{ store.storeCode }}</td><td>{{ store.storeName }}</td><td>{{ store.externalStoreCode ?? '—' }}</td><td>{{ store.status ? '启用' : '停用' }}</td><td><button class="quiet" @click="toggle('/api/stores', store)">{{ store.status ? '停用' : '启用' }}</button></td></tr></tbody></table></section>
  <section class="card master"><h2>菜品分类</h2><div class="entry-grid"><label>分类编码<input v-model="categoryForm.categoryCode" /></label><label>分类名称<input v-model="categoryForm.categoryName" /></label><label>排序<input v-model="categoryForm.sortOrder" type="number" /></label><button :disabled="loading" @click="createCategory">新增分类</button></div><table><thead><tr><th>编码</th><th>分类</th><th>排序</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="category in categories" :key="category.id"><td>{{ category.categoryCode }}</td><td>{{ category.categoryName }}</td><td>{{ category.sortOrder }}</td><td>{{ category.status ? '启用' : '停用' }}</td><td><button class="quiet" @click="toggle('/api/categories', category)">{{ category.status ? '停用' : '启用' }}</button></td></tr></tbody></table></section>
  <section class="card master"><h2>商品管理</h2><p>POS 接入模式下，商品分类由 POS 同步维护。</p><div class="entry-grid product-entry"><label>POS 商品编码<input v-model="productForm.externalProductCode" /></label><label>商品名称<input v-model="productForm.productName" /></label><label>分类<select v-model="productForm.categoryId"><option value="">请选择</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.categoryName }}</option></select></label><label>售价<input v-model="productForm.salePrice" type="number" min="0" step="0.01" /></label><label>理论成本<input v-model="productForm.theoreticalCost" type="number" min="0" step="0.01" /></label><button :disabled="loading" @click="createProduct">新增商品</button></div><table><thead><tr><th>POS 编码</th><th>商品</th><th>分类</th><th>售价</th><th>理论成本</th><th>状态</th></tr></thead><tbody><tr v-for="product in products" :key="product.id"><td>{{ product.externalProductCode }}</td><td>{{ product.productName }}</td><td>{{ categories.find(category => category.id === product.categoryId)?.categoryName ?? product.categoryId }}</td><td>{{ product.salePrice ?? '—' }}</td><td>{{ product.theoreticalCost ?? '—' }}</td><td>{{ product.status ? '启用' : '停用' }}</td></tr></tbody></table><p v-if="message" class="form-message">{{ message }}</p></section>
</template>
