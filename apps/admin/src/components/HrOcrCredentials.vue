<script setup lang="ts">
import { onMounted, ref } from 'vue'

type Status = { configured: boolean; enabled: boolean; updatedAt: string | null }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const status = ref<Status>({ configured: false, enabled: false, updatedAt: null })
const accessKeyId = ref('')
const accessKeySecret = ref('')
const error = ref('')
const message = ref('')
const loading = ref(false)

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${props.apiBase}${path}`, {
    ...init,
    headers: { ...props.headers(), ...(init?.headers ?? {}) },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message ?? '操作失败')
  return data
}

async function load() {
  error.value = ''
  try { status.value = await api('/api/hr/ocr-credentials') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取 OCR 配置失败' }
}

async function save() {
  error.value = ''; message.value = ''
  if (!accessKeyId.value.trim() || !accessKeySecret.value.trim()) {
    error.value = '请输入 AccessKey ID 和 AccessKey Secret'
    return
  }
  loading.value = true
  try {
    status.value = await api('/api/hr/ocr-credentials', {
      method: 'PUT',
      body: JSON.stringify({ accessKeyId: accessKeyId.value, accessKeySecret: accessKeySecret.value }),
    })
    accessKeyId.value = ''
    accessKeySecret.value = ''
    message.value = '密钥已加密保存，OCR 当前为关闭状态；确认后可单独启用'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存 OCR 配置失败' }
  finally { loading.value = false }
}

async function toggle() {
  error.value = ''; message.value = ''; loading.value = true
  try {
    status.value = await api('/api/hr/ocr-credentials/enabled', {
      method: 'PATCH', body: JSON.stringify({ enabled: !status.value.enabled }),
    })
    message.value = status.value.enabled ? '身份证 OCR 已启用' : '身份证 OCR 已关闭'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新 OCR 状态失败' }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <section class="card ocr-settings">
    <div class="heading">
      <div><span class="eyebrow">HUMAN RESOURCES</span><h2>身份证 OCR 配置</h2></div>
      <span class="status-pill" :class="status.enabled ? 'enabled' : ''">
        {{ status.enabled ? '已启用' : status.configured ? '已配置 · 已关闭' : '未配置' }}
      </span>
    </div>
    <p class="intro">配置阿里云 RAM 子用户的 AccessKey。建议仅授予身份证识别所需权限，不要使用主账号密钥。</p>
    <div class="security-note">
      密钥仅在保存时提交；服务端使用独立加密密钥保存，页面不会读取或回显 Secret。替换密钥后 OCR 会自动关闭。
    </div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p>
    <p v-if="message" class="success">{{ message }}</p>
    <div class="credentials-form">
      <label>AccessKey ID<input v-model="accessKeyId" autocomplete="off" spellcheck="false" placeholder="请输入 AccessKey ID" /></label>
      <label>AccessKey Secret<input v-model="accessKeySecret" type="password" autocomplete="new-password" placeholder="请输入 AccessKey Secret" /></label>
      <div class="actions">
        <button :disabled="loading" @click="save">{{ loading ? '正在保存…' : status.configured ? '替换密钥' : '保存密钥' }}</button>
        <button v-if="status.configured" class="secondary" :disabled="loading" @click="toggle">
          {{ status.enabled ? '关闭 OCR' : '启用 OCR' }}
        </button>
      </div>
    </div>
    <p v-if="status.updatedAt" class="updated">最近更新：{{ new Date(status.updatedAt).toLocaleString('zh-CN') }}</p>
  </section>
</template>

<style scoped>
.ocr-settings{max-width:920px}.heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.heading h2{margin:5px 0 0;color:#1d2d45}.eyebrow{color:#d16c39;font-size:11px;font-weight:700;letter-spacing:1.5px}.status-pill{padding:7px 12px;border-radius:999px;background:#f1f3f6;color:#687487;font-size:13px;font-weight:700}.status-pill.enabled{background:#e7f7ef;color:#26835a}.intro{margin:18px 0;color:#66758a;line-height:1.6}.security-note{padding:14px 16px;border:1px solid #f1ddce;border-radius:12px;background:#fff8f2;color:#795338;font-size:13px;line-height:1.6}.credentials-form{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}.credentials-form label{display:flex;flex-direction:column;gap:7px;color:#46556a;font-size:13px;font-weight:600}.credentials-form input{box-sizing:border-box;width:100%;min-height:42px;padding:10px 12px;border:1px solid #dbe1ea;border-radius:10px;background:#fff;color:#24344b;font:inherit}.actions{grid-column:1/-1;display:flex;gap:10px}.actions button{min-width:120px}.actions .secondary{border:1px solid #d5dce6;background:#fff;color:#34445c}.error{color:#b42318}.success{color:#18794e}.updated{margin:14px 0 0;color:#8792a2;font-size:12px}@media(max-width:700px){.credentials-form{grid-template-columns:1fr}.actions{grid-column:auto;flex-wrap:wrap}}
</style>

