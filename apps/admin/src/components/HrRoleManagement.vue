<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Permission = { code: string; name: string; domain: string; module: string; surface: string }
type Role = { id: number; code: string; name: string; enabled: boolean;
  onboardingAssignable: boolean; participatesInScheduling: boolean; showStoreSwitcher: boolean; permissionCodes: string[] }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const roles = ref<Role[]>([])
const permissions = ref<Permission[]>([])
const roleName = ref('')
const selectedRoleId = ref<number | null>(null)
const selectedPermissions = ref<string[]>([])
const onboardingAssignable = ref(false)
const participatesInScheduling = ref(true)
const showStoreSwitcher = ref(false)
const error = ref('')
const message = ref('')
const busy = ref(false)
const page = ref(1), pageSize = ref(20)
const pagedRoles = computed(() => roles.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const selectedRole = computed(() => roles.value.find((item) => item.id === selectedRoleId.value))
const permissionTree = computed(() => [...new Set(permissions.value.map((permission) => permission.domain))]
  .map((domain) => {
    const domainPermissions = permissions.value.filter((permission) => permission.domain === domain)
    const modules = [...new Set(domainPermissions.map((permission) => permission.module))].map((module) => {
      const items = domainPermissions.filter((permission) => permission.module === module)
      const selectedCount = items.filter((item) => selectedPermissions.value.includes(item.code)).length
      return { module, items, selectedCount, allSelected: items.length > 0 && selectedCount === items.length }
    })
    const selectedCount = domainPermissions.filter((item) => selectedPermissions.value.includes(item.code)).length
    return { domain, modules, selectedCount, total: domainPermissions.length,
      allSelected: domainPermissions.length > 0 && selectedCount === domainPermissions.length }
  }))
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const responseText = await response.text()
  let data: any = null
  try { data = responseText ? JSON.parse(responseText) : null } catch { /* Keep the HTTP status and readable response below. */ }
  if (!response.ok) {
    const raw = data?.message ?? data?.error ?? responseText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const detail = Array.isArray(raw) ? raw.join('；') : typeof raw === 'string' ? raw : ''
    const lower = detail.toLowerCase()
    if (response.status === 401) {
      const accountUnavailable = lower.includes('user is unavailable')
      throw new Error(accountUnavailable
        ? '当前账号已停用，角色设置未保存，请联系管理员恢复账号后重试。'
        : '管理员登录状态已过期或失效，角色设置未保存。请退出后台并重新登录后再保存。')
    }
    if (/foreign key constraint|p2003/.test(lower) && /permission/.test(lower))
      throw new Error('保存失败：权限字典缺少所选权限代码，请检查后台权限配置并重试。')
    if (lower.includes('invalid hr permission codes'))
      throw new Error('保存失败：所选权限已失效，请刷新页面后重新选择。')
    if (lower.includes('administrator is required') || lower.includes('forbidden'))
      throw new Error('保存失败：当前账号没有管理员权限，请重新登录管理员账号。')
    if (detail && /[\u3400-\u9fff]/.test(detail)) throw new Error(detail)
    throw new Error(`角色设置保存失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 240)}` : '，服务器未返回具体原因。'}`)
  }
  return data
}
async function load() {
  error.value = ''
  try {
    const result = await Promise.all([
      api('/api/hr/access/roles'), api('/api/hr/access/permissions'),
    ])
    roles.value = result[0]; permissions.value = result[1]
    if (selectedRoleId.value != null) {
      const availableCodes = new Set(permissions.value.map((item) => item.code))
      selectedPermissions.value = (selectedRole.value?.permissionCodes ?? []).filter((code) => availableCodes.has(code))
      onboardingAssignable.value = selectedRole.value?.onboardingAssignable ?? false
      participatesInScheduling.value = selectedRole.value?.participatesInScheduling ?? true
      showStoreSwitcher.value = selectedRole.value?.showStoreSwitcher ?? false
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取人事权限失败' }
}
function selectRole(role: Role) {
  selectedRoleId.value = role.id
  const availableCodes = new Set(permissions.value.map((item) => item.code))
  selectedPermissions.value = role.permissionCodes.filter((code) => availableCodes.has(code))
  onboardingAssignable.value = role.onboardingAssignable
  participatesInScheduling.value = role.participatesInScheduling
  showStoreSwitcher.value = role.showStoreSwitcher
}
function togglePermissionGroup(group: { items: Permission[]; allSelected: boolean }) {
  const codes = new Set(group.items.map((item) => item.code))
  selectedPermissions.value = group.allSelected
    ? selectedPermissions.value.filter((code) => !codes.has(code))
    : [...new Set([...selectedPermissions.value, ...codes])]
}
function togglePermissionDomain(domain: { domain: string; allSelected: boolean }) {
  const codes = new Set(permissions.value.filter((item) => item.domain === domain.domain).map((item) => item.code))
  selectedPermissions.value = domain.allSelected
    ? selectedPermissions.value.filter((code) => !codes.has(code))
    : [...new Set([...selectedPermissions.value, ...codes])]
}
async function act(run: () => Promise<void>, success: string) {
  busy.value = true; error.value = ''; message.value = ''
  try { await run(); message.value = success; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { busy.value = false }
}
function createRole() { return act(async () => {
  await api('/api/hr/access/roles', { method: 'POST', body: JSON.stringify({ name: roleName.value.trim() }) })
  roleName.value = ''
}, '角色已创建') }
function saveRoleSettings() { if (selectedRoleId.value == null) return; return act(async () => {
  await api(`/api/hr/access/roles/${selectedRoleId.value}/permissions`, { method: 'PUT', body: JSON.stringify({ permissionCodes: selectedPermissions.value }) })
  await api(`/api/hr/access/roles/${selectedRoleId.value}`, { method: 'PATCH', body: JSON.stringify({
    onboardingAssignable: onboardingAssignable.value,
    participatesInScheduling: participatesInScheduling.value,
    showStoreSwitcher: showStoreSwitcher.value,
  }) })
}, '角色权限、入职分配、排班及门店切换设置已保存') }
function toggleRole(role: Role) { return act(async () => {
  await api(`/api/hr/access/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !role.enabled }) })
}, role.enabled ? '角色已停用' : '角色已启用') }
onMounted(load)
</script>

<template>
  <section class="card hr-access">
    <h2>角色管理</h2>
    <p>经营与人事权限由后台和小程序共用；每项标明使用端。按“业务类别 → 功能 → 操作”设置，父级全选仅用于批量勾选。</p>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <div class="hr-grid">
      <section>
        <h3>角色</h3>
        <div class="inline"><input v-model="roleName" placeholder="输入角色名称" maxlength="100" @keyup.enter="createRole" /><button :disabled="busy || !roleName.trim()" @click="createRole">新增角色</button></div>
        <table><thead><tr><th>角色</th><th>状态</th><th>入职审批可分配</th><th>参与排班</th><th>显示门店切换</th><th>操作</th></tr></thead><tbody>
          <tr v-for="role in pagedRoles" :key="role.id"><td>{{ role.name }}<small>编号 {{ role.code }}</small></td><td>{{ role.enabled ? '启用' : '停用' }}</td><td>{{ role.onboardingAssignable ? '是' : '否' }}</td><td>{{ role.participatesInScheduling ? '是' : '否' }}</td><td>{{ role.showStoreSwitcher ? '是' : '否' }}</td><td><button class="quiet" @click="selectRole(role)">配置权限</button><button class="quiet" :disabled="busy" @click="toggleRole(role)">{{ role.enabled ? '停用' : '启用' }}</button></td></tr>
        </tbody></table>
        <PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="roles.length" />
      </section>
      <section v-if="selectedRole">
        <h3>{{ selectedRole.name }}的权限</h3>
        <label class="onboarding-role-option"><input v-model="onboardingAssignable" type="checkbox" />允许在员工入职最终审批时分配此人事角色</label>
        <label class="onboarding-role-option"><input v-model="participatesInScheduling" type="checkbox" />参与排班（取消后不显示在小程序排班员工列表）</label>
        <label class="onboarding-role-option"><input v-model="showStoreSwitcher" type="checkbox" />允许在小程序功能页面显示门店切换</label>
        <div class="permission-groups">
          <section v-for="domain in permissionTree" :key="domain.domain" class="permission-domain">
            <header class="domain-header">
              <div><strong>{{ domain.domain }}</strong><small>{{ domain.selectedCount }}/{{ domain.total }} 项已选</small></div>
              <button type="button" class="group-toggle" @click="togglePermissionDomain(domain)">{{ domain.allSelected ? '清空此类' : '全选此类' }}</button>
            </header>
            <section v-for="module in domain.modules" :key="module.module" class="permission-module">
              <header><div><strong>{{ module.module }}</strong><small>{{ module.selectedCount }}/{{ module.items.length }} 项已选</small></div>
                <button type="button" class="group-toggle" @click="togglePermissionGroup(module)">{{ module.allSelected ? '清空' : '全选' }}</button></header>
              <div class="permissions"><label v-for="permission in module.items" :key="permission.code">
                <input v-model="selectedPermissions" type="checkbox" :value="permission.code" /><span>{{ permission.name }}</span><small class="permission-surface">{{ permission.surface }}</small>
              </label></div>
            </section>
          </section>
        </div>
        <button :disabled="busy" @click="saveRoleSettings">保存角色设置</button>
      </section>
    </div>
  </section>
</template>

<style scoped>
.hr-access h2{margin:0 0 8px}.hr-access p{color:#657388}.hr-access h3{margin:22px 0 12px}.hr-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.inline{display:flex;flex-wrap:wrap;align-items:end;gap:10px}.inline input{max-width:180px}.permission-groups{display:grid;gap:12px;margin-bottom:14px}.permission-domain{border:1px solid #d7e0eb;border-radius:11px;background:#f7f9fc;padding:12px}.permission-domain>.domain-header{margin-bottom:10px}.permission-domain header{display:flex;align-items:center;justify-content:space-between;gap:10px}.permission-domain header strong{color:#26364d}.permission-domain header small{margin-top:3px}.permission-module{margin-top:8px;padding:10px;border:1px solid #e5eaf1;border-radius:9px;background:#fff}.permission-module>header{margin-bottom:10px}.permissions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.permissions label{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.permissions input{width:auto}.hr-access small{display:block;color:#8793a5;font-size:11px}.permission-surface{display:inline-block!important;margin-left:auto;padding:2px 6px;border-radius:999px;background:#eef3f9;color:#61758e!important;white-space:nowrap}.hr-access .quiet{margin-right:4px}.group-toggle{padding:5px 9px;border:1px solid #dbe3ed;border-radius:7px;background:#fff;color:#526176;font-size:12px}@media(max-width:900px){.hr-grid{grid-template-columns:1fr}.permissions{grid-template-columns:1fr}}
</style>

