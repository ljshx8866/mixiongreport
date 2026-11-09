<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeCode: string; storeName: string; status: boolean }
type Role = 'ADMIN' | 'REGION_MANAGER' | 'STORE_MANAGER'
type User = { id: number; name: string; mobile: string | null; wechatBound: boolean; role: Role; status: boolean; source: 'LOCAL' | 'POS'; externalUserCode: string | null; lastSyncedAt: string | null; storeIds: number[] }
type HrRole = { id: number; name: string; enabled: boolean }
type Grant = { id: number; userId: number; userName: string; roleId: number; roleName: string; active: boolean }
type DraftGrant = { roleId: number; roleName: string }
type SyncResult = { received: number; created: number; updated: number; deactivated: number; warnings?: string[] }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; enableHrPermissions: boolean }>()
const users = ref<User[]>([])
const stores = ref<Store[]>([])
const hrRoles = ref<HrRole[]>([])
const grants = ref<Grant[]>([])
const loading = ref(false)
const syncing = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')
const warning = ref('')
const hrPermissionError = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const editorOpen = ref(false)
const permissionOnly = ref(false)
const editingId = ref<number | null>(null)
const grantRoleId = ref<number | null>(null)
const roles: Record<Role, string> = { ADMIN: '总部管理员', REGION_MANAGER: '区域经理', STORE_MANAGER: '门店账号' }
const emptyDraft = () => ({ name: '', mobile: '', password: '', role: 'STORE_MANAGER' as Role, status: true, storeIds: [] as number[], hrAssignments: [] as DraftGrant[] })
const draft = reactive(emptyDraft())
const visibleUsers = computed(() => {
  const value = keyword.value.trim().toLowerCase()
  return !value ? users.value : users.value.filter((user) =>
    [user.name, user.mobile, user.externalUserCode].some((field) => String(field ?? '').toLowerCase().includes(value)))
})
const pagedUsers = computed(() => visibleUsers.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch(keyword, () => { page.value = 1 })
watch(() => Math.max(1, Math.ceil(visibleUsers.value.length / pageSize.value)), count => { if (page.value > count) page.value = count })
const enabledStores = computed(() => stores.value.filter((item) => item.status))
const enabledHrRoles = computed(() => hrRoles.value.filter((item) => item.enabled))

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, { ...init, headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? '请求失败')
  return body
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [userList, storeList] = await Promise.all([request('/api/users'), request('/api/stores')])
    users.value = userList
    stores.value = storeList
    if (props.enableHrPermissions) {
      hrPermissionError.value = ''
      try {
        const [roleList, grantList] = await Promise.all([
          request('/api/hr/access/roles'), request('/api/hr/access/grants'),
        ])
        hrRoles.value = roleList
        grants.value = grantList
      } catch (cause) {
        hrPermissionError.value = cause instanceof Error ? cause.message : '功能角色读取失败'
      }
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取用户数据失败'
  } finally {
    loading.value = false
  }
}

async function syncUsers() {
  syncing.value = true
  message.value = ''
  error.value = ''
  warning.value = ''
  try {
    const result: SyncResult = await request('/api/sync/users', { method: 'POST' })
    message.value = `同步完成：接收 ${result.received} 人，新增 ${result.created} 人，更新 ${result.updated} 人，停用 ${result.deactivated} 人。`
    if (result.warnings?.length) warning.value = result.warnings.join('\n')
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '用户同步失败'
  } finally {
    syncing.value = false
  }
}

function assignDraft(value: ReturnType<typeof emptyDraft>) { Object.assign(draft, value) }
function openCreate() {
  assignDraft(emptyDraft())
  editingId.value = null
  permissionOnly.value = false
  editorOpen.value = true
  message.value = ''
  error.value = ''
}
function openEdit(user: User, onlyPermissions = false) {
  const currentGrants = grants.value.filter((grant) => grant.userId === user.id && grant.active)
  assignDraft({
    name: user.name,
    mobile: user.mobile ?? '',
    password: '',
    role: user.role,
    status: user.status,
    storeIds: [...user.storeIds],
    hrAssignments: [...new Map(currentGrants.map((grant) => [grant.roleId, {
      roleId: grant.roleId, roleName: grant.roleName,
    }])).values()],
  })
  editingId.value = user.id
  permissionOnly.value = onlyPermissions
  editorOpen.value = true
  message.value = ''
  error.value = ''
}
function toggleStore(storeId: number, checked: boolean) {
  draft.storeIds = checked ? [...new Set([...draft.storeIds, storeId])] : draft.storeIds.filter((id) => id !== storeId)
}
function grantKey(item: Pick<DraftGrant, 'roleId'>) { return String(item.roleId) }
function addHrAssignment() {
  const role = enabledHrRoles.value.find((item) => item.id === grantRoleId.value)
  if (!role) return
  const assignment = { roleId: role.id, roleName: role.name }
  if (draft.hrAssignments.some((item) => grantKey(item) === grantKey(assignment))) return
  draft.hrAssignments.push(assignment)
  grantRoleId.value = null
}
function removeHrAssignment(index: number) { draft.hrAssignments.splice(index, 1) }

async function saveHrAssignments(userId: number) {
  if (!props.enableHrPermissions) return
  if (hrPermissionError.value) throw new Error(`功能角色未能加载：${hrPermissionError.value}`)
  const existing = grants.value.filter((grant) => grant.userId === userId && grant.active)
  const selectedRoleIds = [...new Set(draft.hrAssignments.map((item) => item.roleId))]
  const existingRoleIds = new Set(existing.map((grant) => grant.roleId))
  for (const grant of existing) if (!selectedRoleIds.includes(grant.roleId)) {
    await request(`/api/hr/access/grants/${grant.id}`, { method: 'DELETE' })
  }
  for (const roleId of selectedRoleIds) {
    if (existingRoleIds.has(roleId)) continue
    await request('/api/hr/access/grants', { method: 'POST', body: JSON.stringify({
      userId, roleId,
    }) })
  }
}

async function save() {
  if (!permissionOnly.value && !draft.name.trim()) { error.value = '请填写姓名'; return }
  if (!permissionOnly.value && !editingId.value && draft.password.length < 8) { error.value = '初始密码至少需要 8 位'; return }
  if (props.enableHrPermissions && hrPermissionError.value) { error.value = `功能角色未能加载：${hrPermissionError.value}`; return }
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    let targetUserId = editingId.value
    if (!permissionOnly.value) {
      const payload = {
        name: draft.name.trim(), mobile: draft.mobile.trim() || null, role: draft.role,
        status: draft.status, storeIds: draft.storeIds,
        ...(draft.password ? { password: draft.password } : {}),
      }
      if (targetUserId) {
        await request(`/api/users/${targetUserId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        await request(`/api/users/${targetUserId}/stores`, { method: 'PUT', body: JSON.stringify({ storeIds: draft.storeIds }) })
      } else {
        const created: { id: number } = await request('/api/users', { method: 'POST', body: JSON.stringify(payload) })
        targetUserId = created.id
        editingId.value = created.id
      }
    }
    if (targetUserId != null) await saveHrAssignments(targetUserId)
    message.value = permissionOnly.value ? '用户权限已更新。' : editingId.value ? '用户信息及权限已保存。' : '用户已保存。'
    editorOpen.value = false
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存用户失败'
  } finally {
    saving.value = false
  }
}

async function removeUser(user: User) {
  const label = user.source === 'POS' ? '已停用的 POS 用户' : '本地用户'
  if (!window.confirm(`确定删除${label}“${user.name}”吗？此操作不可恢复。`)) return
  error.value = ''
  message.value = ''
  try {
    await request(`/api/users/${user.id}`, { method: 'DELETE' })
    message.value = '用户已删除。'
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除用户失败'
  }
}
async function resetWechatBinding(user: User) {
  if (!window.confirm(`确定重置“${user.name}”的小程序绑定吗？重置后，该员工需要重新登录并授权手机号，系统会重新获取并绑定 OpenID。`)) return
  error.value = ''
  message.value = ''
  try {
    const result: { reset: boolean } = await request(`/api/users/${user.id}/wechat-binding`, { method: 'DELETE' })
    message.value = result.reset ? `已重置“${user.name}”的小程序绑定，请让员工重新授权登录。` : `“${user.name}”当前没有小程序绑定。`
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '重置小程序绑定失败'
  }
}
function storeNames(ids: number[]) { return ids.length ? ids.map((id) => stores.value.find((store) => store.id === id)?.storeName ?? `门店 ${id}`).join('、') : '无门店权限' }
function userHrGrants(userId: number) {
  return [...new Map(grants.value.filter((grant) => grant.userId === userId && grant.active)
    .map((grant) => [grant.roleId, grant])).values()]
}
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }
onMounted(load)
</script>

<template>
  <section class="card users">
    <div class="user-heading"><div><span class="eyebrow">USER & ACCESS</span><h2>用户与权限</h2><p>管理账号、门店范围和可用功能。</p></div><div class="header-actions"><button class="secondary" :disabled="syncing || loading" @click="syncUsers">{{ syncing ? '正在同步…' : '同步 POS 用户' }}</button><button @click="openCreate">新增本地用户</button></div></div>
    <div class="user-summary"><article><span>用户总数</span><b>{{ users.length }}</b></article><article><span>本地用户</span><b>{{ users.filter((user) => user.source === 'LOCAL').length }}</b></article><article><span>POS 用户</span><b>{{ users.filter((user) => user.source === 'POS').length }}</b></article><label>搜索用户<input v-model="keyword" placeholder="姓名、手机号或员工编号" /></label></div>

    <div v-if="editorOpen" class="editor-backdrop" @click.self="editorOpen = false"><section class="editor">
      <div><h3>{{ permissionOnly ? `设置${draft.name}的功能角色` : editingId ? '编辑本地用户' : '新增本地用户' }}</h3><p v-if="!permissionOnly">手机号在所有本地和 POS 账户中保持唯一。</p></div>
      <div v-if="!permissionOnly" class="editor-grid"><label>姓名<input v-model="draft.name" maxlength="100" placeholder="请输入姓名" /></label><label>手机号<input v-model="draft.mobile" inputmode="tel" maxlength="30" placeholder="用于登录，留空则不能手机号登录" /></label><label>经营系统角色<select v-model="draft.role"><option v-for="(label, value) in roles" :key="value" :value="value">{{ label }}</option></select></label><label>{{ editingId ? '重置密码' : '初始密码' }}<input v-model="draft.password" type="password" autocomplete="new-password" :placeholder="editingId ? '不修改请留空' : '至少 8 位'" /></label></div>
      <div v-if="!permissionOnly" class="permission-block"><strong>管理门店</strong><label v-for="store in enabledStores" :key="store.id" class="checkbox"><input type="checkbox" :checked="draft.storeIds.includes(store.id)" @change="toggleStore(store.id, ($event.target as HTMLInputElement).checked)" />{{ store.storeName }}</label></div>
      <div v-if="enableHrPermissions" class="hr-assignment-block">
        <strong>功能角色</strong>
        <p v-if="hrPermissionError" class="error" v-popup-error="hrPermissionError">功能角色加载失败：{{ hrPermissionError }}</p>
        <div v-else class="hr-assignment-form"><label>功能角色<select v-model.number="grantRoleId"><option :value="null">请选择角色</option><option v-for="role in enabledHrRoles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label><button class="secondary" :disabled="!grantRoleId" @click="addHrAssignment">添加角色</button></div>
        <div v-if="draft.hrAssignments.length" class="assignment-list"><div v-for="(assignment, index) in draft.hrAssignments" :key="grantKey(assignment)" class="assignment-chip"><span><b>{{ assignment.roleName }}</b></span><button class="text-action danger" @click="removeHrAssignment(index)">移除</button></div></div><p v-else class="empty-grants">尚未配置功能角色</p>
      </div>
      <div class="editor-actions"><label v-if="!permissionOnly" class="checkbox"><input v-model="draft.status" type="checkbox" />启用账户</label><span /><button class="quiet" :disabled="saving" @click="editorOpen = false">取消</button><button :disabled="saving || (enableHrPermissions && !!hrPermissionError)" @click="save">{{ saving ? '保存中…' : '保存' }}</button></div>
    </section></div>

    <p v-if="message" class="form-message">{{ message }}</p><p v-if="warning" class="form-warning">{{ warning }}</p><p v-if="error" class="error" v-popup-error="error">{{ error }}</p>
    <div class="table-scroll"><table><thead><tr><th>用户</th><th>手机号</th><th>小程序绑定</th><th>来源</th><th>本地角色与操作</th><th>管理门店</th><th>状态</th><th>最近同步</th></tr></thead><tbody><tr v-for="user in pagedUsers" :key="user.id"><td><strong>{{ user.name }}</strong><small>{{ user.externalUserCode ? `员工编号 ${user.externalUserCode}` : '本地创建' }}</small></td><td>{{ user.mobile ?? '—' }}</td><td><span :class="user.wechatBound ? 'status-on' : 'status-off'">{{ user.wechatBound ? '已绑定' : '未绑定' }}</span><button v-if="user.wechatBound" class="text-action danger reset-binding" @click="resetWechatBinding(user)">重置绑定</button></td><td><span :class="user.source === 'POS' ? 'tag-pos' : 'tag-local'">{{ user.source === 'POS' ? 'POS 同步' : '本地' }}</span></td><td class="role-cell"><strong v-if="user.source === 'LOCAL'" class="role-label">{{ roles[user.role] }}</strong><span v-else-if="!enableHrPermissions || !userHrGrants(user.id).length" class="role-empty">—</span><div v-if="enableHrPermissions && userHrGrants(user.id).length" class="hr-role-tags"><span v-for="grant in userHrGrants(user.id)" :key="grant.id">{{ grant.roleName }}</span></div><div class="role-actions"><button v-if="user.source === 'LOCAL'" class="text-action" @click="openEdit(user)">编辑</button><button v-if="enableHrPermissions" class="text-action" @click="openEdit(user, true)">功能角色</button><button v-if="user.source === 'LOCAL' || !user.status" class="text-action danger" @click="removeUser(user)">删除</button><span v-if="user.source === 'POS' && user.status && !enableHrPermissions">同步管理</span></div></td><td class="stores-cell">{{ storeNames(user.storeIds) }}</td><td><span :class="user.status ? 'status-on' : 'status-off'">{{ user.status ? '启用' : '停用' }}</span></td><td>{{ formatTime(user.lastSyncedAt) }}</td></tr><tr v-if="!visibleUsers.length"><td colspan="8">{{ loading ? '正在读取用户…' : '没有符合条件的用户' }}</td></tr></tbody></table></div>
    <PaginationControls v-model:page="page" v-model:page-size="pageSize" :total="visibleUsers.length" />
  </section>
</template>

<style scoped>
.user-heading{display:flex;justify-content:space-between;gap:24px;margin-bottom:22px}.user-heading h2{margin:6px 0}.user-heading p,.editor p{margin:0;color:#758196;font-size:13px}.header-actions,.editor-actions{display:flex;align-items:center;gap:10px}.secondary{background:#eef3f9;color:#2b517d}.user-summary{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr)) minmax(260px,2fr);gap:12px;margin-bottom:18px}.user-summary article{padding:14px 16px;border:1px solid #e7ebf1;border-radius:11px;background:#f8fafc}.user-summary span{display:block;color:#7b8798;font-size:11px}.user-summary b{display:block;margin-top:5px;color:#283750;font-size:21px}.user-summary label{display:flex;flex-direction:column;gap:6px;color:#69768a;font-size:12px}.editor-backdrop{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:20px;background:#10182888;overflow:auto}.editor{width:min(900px,100%);max-height:90vh;overflow:auto;padding:22px;border:1px solid #dbe5f0;border-radius:14px;background:#fff;box-shadow:0 22px 70px #10182855}.editor h3{margin:0 0 5px}.editor-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}.editor-grid label,.hr-assignment-form label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#5d6c80}.permission-block,.hr-assignment-block{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;margin-top:16px}.permission-block strong,.hr-assignment-block>strong{width:100%;font-size:13px}.checkbox{display:inline-flex!important;align-items:center;gap:6px;cursor:pointer}.checkbox input{width:auto}.hr-assignment-block{display:block;padding-top:14px;border-top:1px solid #e4eaf2}.hr-assignment-block .hint{margin:5px 0 12px;color:#7e8a9b;font-size:12px}.hr-assignment-form{display:flex;align-items:end;flex-wrap:wrap;gap:10px}.hr-assignment-form label{min-width:150px}.assignment-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.assignment-chip{display:flex;align-items:center;gap:14px;padding:8px 10px;border:1px solid #dce6f2;border-radius:10px;background:#fff}.assignment-chip span,.assignment-chip small{display:block}.assignment-chip b{font-size:12px;color:#37475e}.assignment-chip small{margin-top:3px;color:#8490a1;font-size:11px}.empty-grants{margin-top:10px!important;color:#8a95a5!important;font-size:12px!important}.editor-actions{margin-top:18px}.editor-actions>span{flex:1}.users td strong,.users td small{display:block}.users td small{margin-top:4px;color:#929daf;font-size:11px}.stores-cell{max-width:260px;line-height:1.55}.status-on,.status-off,.tag-pos,.tag-local{display:inline-block;padding:4px 8px;border-radius:99px;font-size:11px;font-weight:700}.status-on{background:#e6f7ed;color:#24744a}.status-off{background:#f2f3f5;color:#777f8c}.tag-pos{background:#eaf2ff;color:#336da9}.tag-local{background:#f5efff;color:#7454a5}.actions{white-space:nowrap}.text-action{border:0;background:transparent;color:#2e6fbe;padding:2px 6px;font-size:12px;box-shadow:none}.text-action.danger{color:#c84949}.actions span{color:#98a2b2;font-size:12px}.table-scroll{overflow-x:auto}.users table{min-width:1040px}@media(max-width:900px){.user-heading{display:block}.header-actions{margin-top:16px;flex-wrap:wrap}.user-summary{grid-template-columns:1fr 1fr}.user-summary label{grid-column:span 2}.editor-grid{grid-template-columns:1fr 1fr}.hr-assignment-form{align-items:stretch}.hr-assignment-form label{flex:1 1 140px}.assignment-chip{max-width:100%}}
.role-cell{min-width:230px}.role-label{color:#2e4260}.role-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.role-cell .text-action{padding:4px 7px;border-radius:6px;background:#f1f5fa}.role-cell .text-action.danger{background:#fff1f0}.role-actions>span{color:#98a2b2;font-size:12px}.hr-role-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.hr-role-tags span{padding:3px 6px;border-radius:6px;background:#eff8f3;color:#347453;font-size:11px;line-height:1.3}.users table{min-width:960px}
.role-empty{color:#aab3c0}
.form-warning{padding:10px 12px;border:1px solid #f2d08b;border-radius:8px;background:#fff9e8;color:#86520c;white-space:pre-line;line-height:1.5}
.users table{min-width:1120px}.reset-binding{display:block;margin-top:4px;padding-left:0!important}
</style>
