<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string }
type User = { id: number; name: string; storeIds: number[]; status: boolean }
type Config = {
  storeId: number
  reminderTime: string
  enabled: boolean
  escalationMinutes: number
  recipients: { userId: number; priority: number }[]
}

const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const stores = ref<Store[]>([])
const users = ref<User[]>([])
const configs = ref<Config[]>([])
const storeId = ref('')
const time = ref('18:00')
const minutes = ref(15)
const enabled = ref(true)
const selected = ref<number[]>([])
const message = ref('')
const loading = ref(false)
const candidatePage = ref(1), pageSize = ref(20)

const candidates = computed(() => users.value.filter((user) => user.status && user.storeIds.includes(Number(storeId.value))))
const pagedCandidates = computed(() => candidates.value.slice((candidatePage.value - 1) * pageSize.value, candidatePage.value * pageSize.value))

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? '请求失败')
  return body
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    ;[stores.value, users.value, configs.value] = await Promise.all([
      request('/api/stores'),
      request('/api/users'),
      request('/api/reminders/config'),
    ])
    if (!storeId.value && stores.value.length) selectStore(String(stores.value[0].id))
  } catch (error) {
    message.value = error instanceof Error ? error.message : '读取提醒设置失败'
  } finally {
    loading.value = false
  }
}

function selectStore(value: string) {
  storeId.value = value
  const config = configs.value.find((item) => item.storeId === Number(value))
  time.value = config?.reminderTime ?? '18:00'
  minutes.value = config?.escalationMinutes ?? 15
  enabled.value = config?.enabled ?? true
  selected.value = config ? [...config.recipients].sort((a, b) => a.priority - b.priority).map((item) => item.userId).filter((userId) => users.value.some((user) => user.id === userId && user.status && user.storeIds.includes(Number(value)))) : []
}

function toggle(userId: number) {
  const index = selected.value.indexOf(userId)
  if (index >= 0) selected.value.splice(index, 1)
  else selected.value.push(userId)
}

function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= selected.value.length) return
  ;[selected.value[index], selected.value[target]] = [selected.value[target], selected.value[index]]
}

async function save() {
  loading.value = true
  message.value = ''
  try {
    await request('/api/reminders/config', {
      method: 'POST',
      body: JSON.stringify({
        storeId: Number(storeId.value),
        reminderTime: time.value,
        enabled: enabled.value,
        escalationMinutes: minutes.value,
        recipientUserIds: selected.value,
      }),
    })
    message.value = '提醒设置已保存'
    await load()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="card reminder-card">
    <div class="section-head">
      <div><h2>填报提醒设置</h2><p>系统按顺位发送提醒，超过间隔时间后自动提醒下一位。</p></div>
      <span class="status-badge" :class="enabled ? 'enabled' : ''">{{ enabled ? '已启用' : '已停用' }}</span>
    </div>

    <div class="reminder-grid">
      <label>门店
        <select :value="storeId" @change="selectStore(($event.target as HTMLSelectElement).value)">
          <option v-for="store in stores" :key="store.id" :value="store.id">{{ store.storeName }}</option>
        </select>
      </label>
      <label>每日提醒时间<input v-model="time" type="time" /></label>
      <label>顺位间隔（分钟）<input v-model.number="minutes" type="number" min="1" max="1440" /></label>
      <label>状态
        <select v-model="enabled"><option :value="true">启用</option><option :value="false">停用</option></select>
      </label>
    </div>

    <h3>同门店提醒人员</h3>
    <p class="hint">勾选人员后，可在下方调整通知优先级。</p>
    <div class="candidate-list">
      <label v-for="user in pagedCandidates" :key="user.id">
        <input type="checkbox" :checked="selected.includes(user.id)" @change="toggle(user.id)" />{{ user.name }}
      </label>
      <span v-if="!candidates.length" class="empty">该门店暂无可选用户</span>
    </div>
    <PaginationControls v-model:page="candidatePage" v-model:page-size="pageSize" :total="candidates.length" />

    <ol class="priority-list">
      <li v-for="(userId, index) in selected" :key="userId">
        <b>优先级 {{ index + 1 }}</b>
        <span>{{ users.find((user) => user.id === userId)?.name }}</span>
        <button class="quiet" :disabled="index === 0" @click="move(index, -1)">上移</button>
        <button class="quiet" :disabled="index === selected.length - 1" @click="move(index, 1)">下移</button>
      </li>
    </ol>

    <p v-if="message" class="form-message" v-popup-error="message === '提醒设置已保存' ? '' : message">{{ message }}</p>
    <button :disabled="loading || !storeId" @click="save">{{ loading ? '保存中…' : '保存提醒设置' }}</button>
  </section>
</template>

<style scoped>
.section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.section-head h2{margin:0}.section-head p,.hint{color:#7b8799;font-size:13px}.status-badge{padding:6px 12px;border-radius:999px;background:#eef1f5;color:#7b8799}.status-badge.enabled{background:#e9f8ef;color:#16854d}.reminder-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 0}.reminder-grid label{display:flex;flex-direction:column;gap:7px;color:#5f6b80;font-size:12px}.candidate-list{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.candidate-list label{display:flex;gap:6px;align-items:center;padding:8px 12px;border:1px solid #e6eaf0;border-radius:8px}.candidate-list input{min-height:auto}.empty{color:#99a2b2}.priority-list{padding:0;list-style:none}.priority-list li{display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid #edf0f4}.priority-list span{margin-right:auto}@media(max-width:800px){.reminder-grid{grid-template-columns:1fr}.section-head{flex-direction:column}}
</style>
