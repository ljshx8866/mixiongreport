<script setup lang="ts">
import { onMounted, ref } from 'vue'
type Role = { id: number; name: string; enabled: boolean; permissionCodes: string[] }
type Flow = { kind: 'TIME_CORRECTION' | 'SALARY_CHANGE' | 'MONTHLY_REVIEW' | 'ONBOARDING' | 'OFFBOARDING' | 'BANK_CHANGE'; version: number; steps: { position: number; roleId: number; roleName: string; roleEnabled: boolean }[] }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const flows = ref<Flow[]>([])
const roles = ref<Role[]>([])
const selected = ref<Flow['kind']>('TIME_CORRECTION')
const roleIds = ref<number[]>([])
const error = ref('')
const message = ref('')
const busy = ref(false)
const label: Record<Flow['kind'], string> = { TIME_CORRECTION: '工时更正', SALARY_CHANGE: '调薪申请', MONTHLY_REVIEW: '月度审核', ONBOARDING: '入职审批', OFFBOARDING: '离职审批', BANK_CHANGE: '银行卡变更' }
const permission: Record<Flow['kind'], string> = { TIME_CORRECTION: 'HR_TIME_CORRECTION_EDIT', SALARY_CHANGE: 'HR_SALARY_CHANGE_APPROVE', MONTHLY_REVIEW: 'HR_MONTH_APPROVE', ONBOARDING: 'HR_ONBOARDING_APPROVE', OFFBOARDING: 'HR_OFFBOARDING_APPROVE', BANK_CHANGE: 'HR_BANK_CHANGE_APPROVE' }
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message ?? '操作失败')
  return data
}
async function load() {
  error.value = ''
  try {
    [flows.value, roles.value] = await Promise.all([api('/api/hr/access/workflows'), api('/api/hr/access/roles')])
    choose(selected.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取审批链失败' }
}
function choose(kind: Flow['kind']) { selected.value = kind; roleIds.value = flows.value.find((item) => item.kind === kind)?.steps.map((item) => item.roleId) ?? [] }
function move(index: number, direction: number) {
  const other = index + direction
  if (other < 0 || other >= roleIds.value.length) return
  const values = [...roleIds.value]; [values[index], values[other]] = [values[other], values[index]]; roleIds.value = values
}
async function save() {
  const flow = flows.value.find((item) => item.kind === selected.value)
  if (!flow) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api(`/api/hr/access/workflows/${selected.value}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: flow.version, roleIds: roleIds.value }) })
    message.value = `${label[selected.value]}审批链已保存，新申请将按此顺序审批。`
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <section class="card workflow">
    <h2>审批链配置</h2><p>按顺序逐级审批；已发起申请保留发起时的审批角色。任一步拒绝即结束。</p>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <div class="flow-tabs"><button v-for="flow in flows" :key="flow.kind" :class="{ active: selected === flow.kind }" @click="choose(flow.kind)">{{ label[flow.kind] }}</button></div>
    <div class="steps">
      <div v-for="(_, index) in roleIds" :key="index" class="step"><strong>{{ index + 1 }}</strong>
        <select v-model.number="roleIds[index]"><option v-for="role in roles.filter(item => item.enabled && item.permissionCodes.includes(permission[selected]))" :key="role.id" :value="role.id">{{ role.name }}</option></select>
        <button class="quiet" :disabled="index === 0" @click="move(index, -1)">上移</button><button class="quiet" :disabled="index === roleIds.length - 1" @click="move(index, 1)">下移</button><button class="quiet" @click="roleIds.splice(index, 1)">移除</button>
      </div>
    </div>
    <div class="actions"><button class="secondary" :disabled="roleIds.length >= 10 || !roles.some(item => item.enabled && item.permissionCodes.includes(permission[selected]))" @click="roleIds.push(roles.find(item => item.enabled && item.permissionCodes.includes(permission[selected]))!.id)">增加审批步骤</button><button :disabled="busy || !roleIds.length" @click="save">保存审批链</button></div>
    <small>审批人须拥有对应功能角色，并已被授权管理申请所属门店。</small>
  </section>
</template>

<style scoped>
.workflow h2{margin:0 0 8px}.workflow p,.workflow small{color:#657388}.flow-tabs,.actions{display:flex;gap:10px;margin:20px 0}.flow-tabs button{background:#eaf0f6;color:#38506e}.flow-tabs button.active{background:#e9680c;color:white}.steps{display:grid;gap:10px}.step{display:flex;align-items:center;gap:8px;padding:12px;background:#f7f9fc;border-radius:10px}.step strong{width:28px;text-align:center}.step select{flex:1}.step .quiet{white-space:nowrap}.secondary{background:#eef3f9;color:#2b517d}@media(max-width:720px){.step{flex-wrap:wrap}.step select{min-width:70%}}
</style>

