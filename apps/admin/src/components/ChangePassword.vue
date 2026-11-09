<script setup lang="ts">
import { reactive, ref } from 'vue'

const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; required?: boolean }>()
const emit = defineEmits<{ completed: [result: { accessToken?: string; user?: { role?: string } }] }>()
const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const message = ref('')
const error = ref('')
const saving = ref(false)

async function submit() {
  message.value = ''; error.value = ''
  if (!form.currentPassword || !form.newPassword || !form.confirmPassword) { error.value = '请填写当前密码和新密码'; return }
  if (form.newPassword.length < 8) { error.value = '新密码至少需要 8 位'; return }
  if (form.newPassword !== form.confirmPassword) { error.value = '两次输入的新密码不一致'; return }
  saving.value = true
  try {
    const response = await fetch(`${props.apiBase}/api/auth/change-password`, { method: 'POST', headers: props.headers(), body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message ?? '密码修改失败')
    form.currentPassword = ''; form.newPassword = ''; form.confirmPassword = ''
    if (data.accessToken) emit('completed', data)
    message.value = props.required ? '密码已修改，可以继续使用系统。' : '密码已修改。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '密码修改失败' }
  finally { saving.value = false }
}
</script>

<template>
  <section class="card password-card">
    <h2>修改密码</h2>
    <p>{{ required ? '首次登录使用默认密码，请先修改后再继续。新密码至少 8 位。' : '新密码至少 8 位，请妥善保管。' }}</p>
    <div class="password-grid">
      <label>当前密码<input v-model="form.currentPassword" type="password" autocomplete="current-password" /></label>
      <label>新密码<input v-model="form.newPassword" type="password" autocomplete="new-password" /></label>
      <label>确认新密码<input v-model="form.confirmPassword" type="password" autocomplete="new-password" @keyup.enter="submit" /></label>
    </div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <button :disabled="saving" @click="submit">{{ saving ? '正在保存…' : '确认修改' }}</button>
  </section>
</template>
