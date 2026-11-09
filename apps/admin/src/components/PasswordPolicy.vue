<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const enabled = ref(true)
const configured = ref(false)
const defaultPassword = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')

async function load() {
  loading.value = true
  try {
    const response = await fetch(`${props.apiBase}/api/system-settings/password-policy`, { headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '读取密码策略失败')
    enabled.value = data.enabled === true
    configured.value = data.defaultPasswordConfigured === true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取密码策略失败' }
  finally { loading.value = false }
}

async function save() {
  message.value = ''; error.value = ''
  if (defaultPassword.value && defaultPassword.value.length < 8) { error.value = '默认密码至少需要 8 位'; return }
  saving.value = true
  try {
    const response = await fetch(`${props.apiBase}/api/system-settings/password-policy`, {
      method: 'PUT', headers: props.headers(),
      body: JSON.stringify({ enabled: enabled.value, ...(defaultPassword.value ? { defaultPassword: defaultPassword.value } : {}) }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '保存密码策略失败')
    configured.value = data.defaultPasswordConfigured === true
    defaultPassword.value = ''
    message.value = enabled.value ? '已保存：使用默认密码的账号下次密码登录时必须先修改密码。' : '已保存：已关闭默认密码强制修改。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存密码策略失败' }
  finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <section class="card password-policy">
    <h2>默认密码策略</h2>
    <p>密码登录适用于后台和小程序。微信手机号授权登录不受此策略影响。默认密码只保存加密校验值。</p>
    <label class="switch-row"><input v-model="enabled" type="checkbox" />启用首次密码登录强制修改</label>
    <label>默认密码（首次配置或更换时填写）
      <input v-model="defaultPassword" type="password" autocomplete="new-password" placeholder="至少 8 位；留空则沿用当前设置" />
    </label>
    <small>{{ loading ? '正在读取设置…' : configured ? '已配置默认密码' : '尚未配置默认密码；首次保存时使用 66666666，或在上方填写新密码' }}</small>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p>
    <p v-if="message" class="success">{{ message }}</p>
    <button :disabled="loading || saving" @click="save">{{ saving ? '正在保存…' : '保存设置' }}</button>
  </section>
</template>

<style scoped>
.password-policy{max-width:760px}.password-policy h2{margin:0 0 10px;color:#1d2d45}.password-policy p{color:#66758a;line-height:1.6}.password-policy>label:not(.switch-row){display:flex;flex-direction:column;gap:8px;margin:18px 0;color:#46556a;font-size:14px}.password-policy input[type=password]{box-sizing:border-box;width:100%;min-height:42px;padding:10px 12px;border:1px solid #dbe1ea;border-radius:10px;background:#fff;color:#24344b;font:inherit}.switch-row{display:flex;align-items:center;gap:10px;margin-top:18px;color:#34445c}.password-policy small{display:block;color:#8490a5}.success{color:#18794e}
</style>
