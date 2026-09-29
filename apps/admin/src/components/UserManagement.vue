<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

type Store = { id: number; storeCode: string; storeName: string; status: boolean }
type User = { id: number; name: string; mobile: string | null; role: string; status: boolean; storeIds: number[] }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const users = ref<User[]>([]); const stores = ref<Store[]>([]); const message = ref(''); const loading = ref(false)
const form = reactive({ name: '', mobile: '', password: '', role: 'STORE_MANAGER', storeId: '' })
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const body = await response.json(); if (!response.ok) throw new Error(body.message ?? '请求失败'); return body
}
async function load() {
  loading.value = true; message.value = ''
  try { [users.value, stores.value] = await Promise.all([request('/api/users'), request('/api/stores')]) }
  catch (cause) { message.value = cause instanceof Error ? cause.message : '读取管理数据失败' } finally { loading.value = false }
}
async function create() {
  loading.value = true; message.value = ''
  try {
    const created = await request('/api/users', { method: 'POST', body: JSON.stringify({ name: form.name, mobile: form.mobile || null, password: form.password, role: form.role }) })
    if (form.storeId) await request(`/api/users/${created.id}/stores`, { method: 'POST', body: JSON.stringify({ storeId: Number(form.storeId) }) })
    form.name = ''; form.mobile = ''; form.password = ''; form.role = 'STORE_MANAGER'; form.storeId = ''; message.value = '用户已创建。'; await load()
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '创建用户失败' } finally { loading.value = false }
}
async function toggle(user: User) {
  try { await request(`/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ status: !user.status }) }); await load() }
  catch (cause) { message.value = cause instanceof Error ? cause.message : '更新失败' }
}
onMounted(load)
</script>

<template>
  <section class="card users"><h2>用户与门店权限</h2><div class="create-user"><label>姓名<input v-model="form.name" /></label><label>手机号<input v-model="form.mobile" /></label><label>初始密码<input v-model="form.password" type="password" /></label><label>角色<select v-model="form.role"><option value="ADMIN">总部管理员</option><option value="REGION_MANAGER">区域经理</option><option value="STORE_MANAGER">店长</option></select></label><label>门店权限<select v-model="form.storeId"><option value="">不分配</option><option v-for="store in stores" :key="store.id" :value="store.id">{{ store.storeName }}</option></select></label><button :disabled="loading" @click="create">创建用户</button></div><p v-if="message" class="form-message">{{ message }}</p><table><thead><tr><th>姓名</th><th>手机号</th><th>角色</th><th>门店</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="user in users" :key="user.id"><td>{{ user.name }}</td><td>{{ user.mobile ?? '—' }}</td><td>{{ user.role }}</td><td>{{ user.storeIds.map(id => stores.find(store => store.id === id)?.storeName ?? id).join('、') || '全部/未分配' }}</td><td>{{ user.status ? '启用' : '停用' }}</td><td><button class="quiet" @click="toggle(user)">{{ user.status ? '停用' : '启用' }}</button></td></tr></tbody></table></section>
</template>
