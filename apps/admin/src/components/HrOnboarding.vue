<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getShanghaiBusinessDate } from '../business-date'
import PaginationControls from './PaginationControls.vue'

type Store = { id: number; storeName: string; permissionCodes: string[] }
type AccountRole = { id: number; code: string; name: string }
type JobPosition = { id: number; name: string; scheduleOnly: boolean; hourlyRate: string | null }
type TrialEmployee = { id: number; name: string; trialStartedAt: string | null }
type Application = { id: number; employeeId: number; storeId: number; employeeName: string; status: string;
  storeName: string; effectiveDate: string; identityMask: string | null; bankMask: string | null; failureCode?: string | null;
  identityDetails?: { name?: string | null; phone?: string | null; idNumber?: string | null; sex?: string | null;
    ethnicity?: string | null; birthDate?: string | null; address?: string | null } | null;
  bankDetails?: { accountName?: string | null; bankName?: string | null; branchName?: string | null; cardNumber?: string | null } | null;
  rejectionReason?: string | null;
  accountRole?: { code: string; name: string } | null;
  accountHrRole?: { id: number; code: string; name: string } | null;
  jobPosition?: { id: number | null; name: string; scheduleOnly: boolean; hourlyRate: string | null } | null;
  canCorrectPhone?: boolean;
  approval?: { status?: string; position: number | null; totalSteps: number; roleName: string | null;
    canDecide: boolean; blockedReason: string | null } | null }
type HistoryEvent = { id: number; entityType: string; action: string; actorName: string;
  createdAt: string; reason: string | null; beforeData: unknown; afterData: unknown }
type HistoryResponse = { revisions: Array<{ id: number; revision: number; status: string;
  failureCode: string | null; createdAt: string; updatedAt: string }>; events: HistoryEvent[] }
type OcrField = { value?: string; confidence?: number | null }
type OcrResult = { fields?: Record<string, OcrField> }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string>; stores: Store[];
  trialConversionRequest?: { trialEmployeeId: number; storeId: number; nonce: number } | null }>()
const storeId = ref('ALL')
const applications = ref<Application[]>([])
const accountRoles = ref<AccountRole[]>([])
const jobPositions = ref<JobPosition[]>([])
const trialEmployees = ref<TrialEmployee[]>([])
const selectedTrialEmployeeId = ref<number | null>(null)
const pendingTrialConversion = ref<{ trialEmployeeId: number; nonce: number } | null>(null)
const handledTrialConversionNonce = ref(0)
const selectedAccountRoleId = ref<number | null>(null)
const selectedJobPositionId = ref<number | null>(null)
const name = ref(''), phone = ref(''), idNumber = ref(''), sex = ref(''), ethnicity = ref('')
const birthDate = ref(''), address = ref(''), cardNumber = ref(''), bankName = ref(''), branchName = ref('')
const effectiveDate = ref(getShanghaiBusinessDate())
const confirmedOriginals = ref(false)
const draftLoadedFor = ref('')
const draftSavedAt = ref('')
const correctionTarget = ref<Application | null>(null)
const correctionPhone = ref('')
const correctionStoreId = ref<number | null>(null)
const correctionRoles = ref<AccountRole[]>([])
const correctionPositions = ref<JobPosition[]>([])
const correctionRoleId = ref<number | null>(null)
const correctionPositionId = ref<number | null>(null)
const detailsTarget = ref<Application | null>(null)
const historyTarget = ref<Application | null>(null)
const historyLoading = ref(false)
const historyData = ref<HistoryResponse | null>(null)
const imageFile = ref<File | null>(null)
const imageUrl = ref('')
const busy = ref(false), error = ref(''), message = ref(''), rejectionReason = ref('')
const page = ref(1), pageSize = ref(20)
const pagedApplications = computed(() => applications.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const selectedStore = computed(() => props.stores.find(item => String(item.id) === storeId.value))
const selectedTrial = computed(() => trialEmployees.value.find(item => item.id === selectedTrialEmployeeId.value) ?? null)
const intakeJobPositions = computed(() => selectedTrial.value
  ? jobPositions.value.filter(position => !position.scheduleOnly && position.hourlyRate != null)
  : jobPositions.value)
const has = (code: string) => selectedStore.value?.permissionCodes.includes(code) ?? false
const canStartIntake = computed(() => has('HR_ONBOARDING_CREATE'))
const canWrite = computed(() => has('HR_ONBOARDING_CREATE'))
const missingIntakePermissions = computed(() => ([
  ['HR_ONBOARDING_CREATE', '填写并提交入职申请'],
  ['HR_ONBOARDING_VERIFY', '门店现场核验'],
] as const).filter(([code]) => !has(code)).map(([, label]) => label))
const canApprove = computed(() => storeId.value === 'ALL'
  ? props.stores.some(item => item.permissionCodes.includes('HR_ONBOARDING_APPROVE'))
  : has('HR_ONBOARDING_APPROVE'))
const canRead = computed(() => storeId.value === 'ALL'
  ? props.stores.some(item => item.permissionCodes.includes('HR_ONBOARDING_LIST_READ') || item.permissionCodes.includes('HR_ONBOARDING_VERIFY') || item.permissionCodes.includes('HR_ONBOARDING_APPROVE'))
  : has('HR_ONBOARDING_LIST_READ') || has('HR_ONBOARDING_VERIFY') || canApprove.value)
const canSubmit = computed(() => canWrite.value && has('HR_ONBOARDING_VERIFY') && !!name.value.trim() && /^1\d{10}$/.test(phone.value.trim()) &&
  /^\d{17}[\dXx]$/.test(idNumber.value.trim()) && !!cardNumber.value.trim() && !!bankName.value.trim() &&
  !!effectiveDate.value && confirmedOriginals.value && selectedAccountRoleId.value != null && selectedJobPositionId.value != null &&
  (!selectedTrial.value || (effectiveDate.value >= (selectedTrial.value.trialStartedAt ?? '9999-99-99') &&
    jobPositions.value.some(position => position.id === selectedJobPositionId.value && !position.scheduleOnly && position.hourlyRate != null))))

async function request<T = any>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${props.apiBase}${path}`, { ...init,
    headers: { ...props.headers(), ...(init?.headers ?? {}) } })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '操作失败')
  return data as T
}
async function perform(action: () => Promise<void>) {
  busy.value = true; error.value = ''; message.value = ''
  try { await action() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { busy.value = false }
}
async function load() {
  applications.value = []
  if (!canRead.value && !canWrite.value) return
  await perform(async () => {
    const storeQuery = storeId.value === 'ALL' ? '' : `?storeId=${encodeURIComponent(storeId.value)}`
    applications.value = canRead.value ? await request(`/api/hr/onboarding${storeQuery}`) : []
    if (storeId.value !== 'ALL' && canWrite.value) {
      const [roles, positions, trials] = await Promise.all([
        request<AccountRole[]>(`/api/hr/onboarding/account-roles?storeId=${encodeURIComponent(storeId.value)}`),
        request<JobPosition[]>(`/api/hr/job-positions/selectable?storeId=${encodeURIComponent(storeId.value)}`),
        request<TrialEmployee[]>(`/api/hr/employees/trials?storeId=${encodeURIComponent(storeId.value)}`),
      ])
      accountRoles.value = roles; jobPositions.value = positions; trialEmployees.value = trials
      if (selectedTrialEmployeeId.value != null && !trials.some(item => item.id === selectedTrialEmployeeId.value))
        selectedTrialEmployeeId.value = null
      if (!roles.some((role) => role.id === selectedAccountRoleId.value))
        selectedAccountRoleId.value = roles.find((role) => role.code === 'EMPLOYEE')?.id ?? roles.find((role) => role.name === '员工')?.id ?? roles[0]?.id ?? null
      if (!positions.some((position) => position.id === selectedJobPositionId.value))
        selectedJobPositionId.value = positions[0]?.id ?? null
      if (pendingTrialConversion.value) {
        const trial = trials.find(item => item.id === pendingTrialConversion.value?.trialEmployeeId)
        if (trial) {
          selectedTrialEmployeeId.value = trial.id
          selectTrialEmployee()
          handledTrialConversionNonce.value = pendingTrialConversion.value.nonce
          pendingTrialConversion.value = null
        } else {
          error.value = '未找到该试岗人员，请返回试岗列表刷新后重试。'
          pendingTrialConversion.value = null
        }
      }
    } else {
      accountRoles.value = []; jobPositions.value = []; trialEmployees.value = []
    }
    if (storeId.value !== 'ALL' && canWrite.value && draftLoadedFor.value !== storeId.value) {
      const draft = await request(`/api/hr/onboarding/draft?storeId=${encodeURIComponent(storeId.value)}`)
      draftLoadedFor.value = storeId.value
      if (draft) {
        name.value = draft.name ?? ''; phone.value = draft.phone ?? ''; idNumber.value = draft.idNumber ?? ''
        sex.value = draft.sex ?? ''; ethnicity.value = draft.ethnicity ?? ''; birthDate.value = draft.birthDate ?? ''
        address.value = draft.address ?? ''; cardNumber.value = draft.cardNumber ?? ''; bankName.value = draft.bankName ?? ''
        branchName.value = draft.branchName ?? ''; effectiveDate.value = draft.effectiveDate || effectiveDate.value
        selectedAccountRoleId.value = Number(draft.accountHrRoleId) || selectedAccountRoleId.value
        selectedJobPositionId.value = Number(draft.jobPositionId) || selectedJobPositionId.value
        draftSavedAt.value = draft.updatedAt ?? ''
        message.value = '已恢复本账号加密暂存的入职资料，请核对后继续。现场核验确认需要重新勾选。'
      }
    }
  })
}
function selectStore() {
  resetForm(); draftSavedAt.value = ''; draftLoadedFor.value = ''; void load()
}
let mounted = false
function selectInitialIntakeStore() {
  if (storeId.value !== 'ALL') return false
  const candidate = props.stores.find(store => store.permissionCodes.includes('HR_ONBOARDING_CREATE'))
  if (!candidate) return false
  storeId.value = String(candidate.id)
  selectStore()
  return true
}
watch(() => props.stores.map(store => `${store.id}:${store.permissionCodes.join(',')}`).join('|'), () => {
  if (mounted) selectInitialIntakeStore()
})
onMounted(() => {
  mounted = true
  if (!selectInitialIntakeStore()) void load()
})
watch(() => props.trialConversionRequest?.nonce, () => {
  const request = props.trialConversionRequest
  if (!request || request.nonce === handledTrialConversionNonce.value) return
  storeId.value = String(request.storeId)
  resetForm()
  effectiveDate.value = getShanghaiBusinessDate()
  draftSavedAt.value = ''; draftLoadedFor.value = storeId.value
  pendingTrialConversion.value = { trialEmployeeId: request.trialEmployeeId, nonce: request.nonce }
  void load()
}, { immediate: true })
function clearImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''; imageFile.value = null
}
onBeforeUnmount(clearImage)
function selectImage(event: Event) {
  clearImage()
  const input = event.target as HTMLInputElement
  imageFile.value = input.files?.[0] ?? null
  if (imageFile.value) imageUrl.value = URL.createObjectURL(imageFile.value)
  input.value = ''
}
async function recognizeIdCard() {
  if (!imageFile.value || !storeId.value || !canWrite.value) return
  await perform(async () => {
    const payload = new FormData()
    payload.append('documentType', 'ID_CARD_FRONT'); payload.append('image', imageFile.value!)
    const headers = props.headers()
    const response = await fetch(`${props.apiBase}/api/hr/onboarding/ocr-preview?storeId=${encodeURIComponent(storeId.value)}`,
      { method: 'POST', headers: { Authorization: headers.Authorization ?? '' }, body: payload })
    const result = await response.json()
    if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : '身份证识别失败')
    const fields = (result as OcrResult).fields ?? {}
    name.value = fields.name?.value ?? name.value; idNumber.value = fields.idNumber?.value ?? idNumber.value
    sex.value = fields.sex?.value ?? sex.value; ethnicity.value = fields.ethnicity?.value ?? ethnicity.value
    birthDate.value = fields.birthDate?.value ?? birthDate.value; address.value = fields.address?.value ?? address.value
    message.value = '识别信息已完整显示并填入表单，请核验后提交。身份证图片仅用于本次识别，不保存原图。'
  })
}
function resetForm() {
  name.value = ''; phone.value = ''; idNumber.value = ''; sex.value = ''; ethnicity.value = ''
  birthDate.value = ''; address.value = ''; cardNumber.value = ''; bankName.value = ''; branchName.value = ''
  selectedAccountRoleId.value = accountRoles.value.find((role) => role.code === 'EMPLOYEE')?.id ?? accountRoles.value.find((role) => role.name === '员工')?.id ?? accountRoles.value[0]?.id ?? null
  selectedJobPositionId.value = jobPositions.value[0]?.id ?? null
  confirmedOriginals.value = false; clearImage()
  selectedTrialEmployeeId.value = null
}
function selectTrialEmployee() {
  if (!selectedTrial.value) return
  name.value = selectedTrial.value.name
  if (!intakeJobPositions.value.some(position => position.id === selectedJobPositionId.value))
    selectedJobPositionId.value = intakeJobPositions.value[0]?.id ?? null
  if (selectedTrial.value.trialStartedAt && effectiveDate.value < selectedTrial.value.trialStartedAt)
    effectiveDate.value = selectedTrial.value.trialStartedAt
}
async function saveDraft() {
  if (!storeId.value || !canWrite.value) return
  await perform(async () => {
    const result = await request('/api/hr/onboarding/draft', { method: 'POST', body: JSON.stringify({
      initialStoreId: Number(storeId.value), name: name.value, phone: phone.value, idNumber: idNumber.value,
      sex: sex.value, ethnicity: ethnicity.value, birthDate: birthDate.value, address: address.value,
      cardNumber: cardNumber.value, bankName: bankName.value, branchName: branchName.value,
      effectiveDate: effectiveDate.value, accountHrRoleId: String(selectedAccountRoleId.value ?? ''),
      jobPositionId: String(selectedJobPositionId.value ?? ''),
    }) })
    draftSavedAt.value = result.cleared ? '' : new Date().toISOString()
    message.value = result.cleared ? '暂存信息已清除。' : '入职资料已加密暂存，可稍后继续填写。'
  })
}
async function clearDraft() {
  if (!storeId.value || !canWrite.value) return
  await perform(async () => {
    await request(`/api/hr/onboarding/draft?storeId=${encodeURIComponent(storeId.value)}`, { method: 'DELETE' })
    resetForm(); draftSavedAt.value = ''; draftLoadedFor.value = storeId.value
    message.value = '暂存资料已清除。'
  })
}
async function submit() {
  if (!canSubmit.value) return
  await perform(async () => {
    await request('/api/hr/onboarding/direct', { method: 'POST', body: JSON.stringify({
      initialStoreId: Number(storeId.value), name: name.value.trim(), phone: phone.value.trim(),
      idNumber: idNumber.value.trim(), sex: sex.value.trim(), ethnicity: ethnicity.value.trim(),
      birthDate: birthDate.value.trim(), address: address.value.trim(), accountName: name.value.trim(),
      cardNumber: cardNumber.value.trim(), bankName: bankName.value.trim(), branchName: branchName.value.trim(),
      effectiveDate: effectiveDate.value, confirmedOriginals: true,
      accountHrRoleId: selectedAccountRoleId.value, jobPositionId: selectedJobPositionId.value,
      ...(selectedTrialEmployeeId.value != null ? { trialEmployeeId: selectedTrialEmployeeId.value } : {}),
    }) })
    const convertedTrial = selectedTrialEmployeeId.value != null
    resetForm(); draftSavedAt.value = ''; await load(); message.value = convertedTrial
      ? '试岗人员的入职资料已提交，审批通过后将沿用原人员和工时记录。' : '入职资料已提交，审批流程已启动。'
  })
}
async function decide(item: Application, decision: 'APPROVE' | 'REJECT') {
  if (!canApprove.value) return
  if (!item.approval?.canDecide) { error.value = item.approval?.blockedReason || '当前账号不符合此审批步骤的角色和门店授权'; return }
  if (decision === 'REJECT' && !rejectionReason.value.trim()) { error.value = '请填写拒绝原因'; return }
  await perform(async () => {
    await request(`/api/hr/onboarding/${item.id}/decisions`, { method: 'POST',
      body: JSON.stringify({ decision, reason: rejectionReason.value.trim() }) })
    rejectionReason.value = ''; await load(); message.value = '审批决定已记录。'
  })
}
function openPhoneCorrection(item: Application) {
  correctionTarget.value = item
  correctionPhone.value = ''
  correctionStoreId.value = item.storeId
  void loadCorrectionOptions(item.storeId, item)
  error.value = ''
}
async function loadCorrectionOptions(storeIdValue: number, item = correctionTarget.value) {
  if (!item) return
  try {
    const [roles, positions] = await Promise.all([
      request<AccountRole[]>(`/api/hr/onboarding/account-roles?storeId=${storeIdValue}`),
      request<JobPosition[]>(`/api/hr/job-positions/selectable?storeId=${storeIdValue}`),
    ])
    correctionRoles.value = roles; correctionPositions.value = positions
    correctionRoleId.value = roles.find((role) => role.id === item.accountHrRole?.id)?.id ?? roles.find((role) => role.code === 'EMPLOYEE')?.id ?? roles[0]?.id ?? null
    correctionPositionId.value = positions.find((position) => position.id === item.jobPosition?.id)?.id ?? positions[0]?.id ?? null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取门店岗位和账号权限失败' }
}
async function correctPhoneAndResubmit() {
  if (!correctionTarget.value) return
  const phone = correctionPhone.value.trim()
  if (phone && !/^1\d{10}$/.test(phone)) {
    error.value = '手机号需为空或填写有效的 11 位手机号'
    return
  }
  if (correctionStoreId.value == null) { error.value = '请选择入职门店'; return }
  await perform(async () => {
    await request(`/api/hr/onboarding/${correctionTarget.value!.id}/correct-phone`, {
      method: 'POST', body: JSON.stringify({ ...(phone ? { phone } : {}), storeId: correctionStoreId.value,
        accountHrRoleId: correctionRoleId.value, jobPositionId: correctionPositionId.value }),
    })
    correctionTarget.value = null
    correctionPhone.value = ''
    correctionStoreId.value = null
    await load()
    message.value = '申请信息已更正，原记录已重新进入审批。'
  })
}
async function openHistory(item: Application) {
  historyTarget.value = item; historyData.value = null; historyLoading.value = true
  try { historyData.value = await request(`/api/hr/onboarding/${item.id}/history`) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取入职记录失败'; historyTarget.value = null }
  finally { historyLoading.value = false }
}
function eventActionText(action: string) {
  const labels: Record<string, string> = {
    DIRECT_CREATE_AND_SUBMIT: '提交入职申请', STORE_VERIFY_AND_SUBMIT: '门店核验并提交',
    PHONE_CORRECTION_RESUBMIT: '补录手机号并重新提交', APPROVAL_ROUND_ARCHIVED: '归档上一轮审批',
    CORRECTION_RESUBMIT: '更正门店/申请信息并重新提交',
    APPROVE: '审批通过', REJECT: '审批退回', EFFECTIVE: '入职生效',
    VIEW_MASKED_LIST: '查看申请列表', REQUEST_REVISIONS_MERGED: '合并重复申请记录',
  }
  return labels[action] ?? action
}
function eventData(value: unknown) {
  if (value == null) return ''
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}
function onboardingStatusText(status: string) {
  const labels: Record<string, string> = {
    SUBMITTED: '审批中', APPROVED_AWAITING_EFFECTIVE: '审批通过·待生效',
    REJECTED: '已退回', EFFECTIVE: '已生效', EFFECTIVE_FAILED: '生效异常',
  }
  return labels[status] ?? status
}
function openDetails(item: Application) { detailsTarget.value = item }
function failureText(code?: string | null) {
  const descriptions: Record<string, string> = {
    SOURCE_CHANGED: '已核验资料发生变化，请重新核对并提交。',
    PHONE_REQUIRED: '员工手机号无效，请核对入职资料。',
    PHONE_ACCOUNT_LINKED: '该手机号已绑定其他员工账号。',
    PHONE_ACCOUNT_DISABLED: '该手机号对应的账号已停用。',
  }
  return code ? descriptions[code] || `生效失败（${code}）` : ''
}
</script>

<template>
  <section class="card hr-onboarding">
    <h2>员工入职</h2>
    <p>入职资料、账号权限和岗位在提交时一并确定；审批人员核对资料并处理审批。身份证原图仅用于识别，不保存。</p>
    <div class="row"><label>查看门店<select v-model="storeId" @change="selectStore"><option value="ALL">全部授权门店</option>
      <option v-for="store in stores" :key="store.id" :value="String(store.id)">{{ store.storeName }}</option></select></label>
      <button :disabled="busy || !storeId" @click="load">刷新</button></div>
    <p v-if="error" class="error" v-popup-error="error">{{ error }}</p><p v-if="message" class="form-message">{{ message }}</p>
    <template v-if="storeId !== 'ALL' && canStartIntake">
      <h3>入职资料</h3>
      <p v-if="selectedTrial" class="trial-select">试岗转入职：{{ selectedTrial.name }} · 开始于 {{ selectedTrial.trialStartedAt || '未记录' }}</p>
      <p v-if="selectedTrial" class="trial-note">审批通过后沿用该试岗人员和排班工时，试岗开始日至入职生效日的已确认工时按所选时薪计薪。转入职岗位必须已配置时薪。</p>
      <p v-if="missingIntakePermissions.length" class="permission-warning">当前门店缺少：{{ missingIntakePermissions.join('、') }}。入职资料可暂存；补齐现场核验权限后才能提交审批。</p>
      <div class="id-upload-frame" :class="{ 'has-image': imageUrl }">
        <img v-if="imageUrl" class="id-preview" :src="imageUrl" alt="身份证图片预览" />
        <div v-else class="id-upload-empty"><b>证</b><strong>身份证正面照片</strong><small>上传后可预览，支持重新上传或删除</small></div>
        <div class="id-upload-actions"><label class="id-upload-action">{{ imageUrl ? '重新上传身份证照片' : '选择身份证照片' }}
          <input type="file" accept="image/jpeg,image/png" @change="selectImage" /></label>
          <button v-if="imageFile" :disabled="busy" @click="recognizeIdCard">识别并填入</button>
          <button v-if="imageFile" class="secondary" :disabled="busy" @click="clearImage">删除照片</button></div>
        <small class="id-upload-note">照片仅用于本次识别，不保存原图。</small>
      </div>
      <div class="form-grid">
        <label>姓名<input v-model="name" maxlength="100" autocomplete="off" /></label>
        <label>身份证号<input v-model="idNumber" maxlength="18" autocomplete="off" /></label>
        <label>性别<input v-model="sex" maxlength="10" /></label>
        <label>民族<input v-model="ethnicity" maxlength="30" /></label>
        <label>出生日期<input v-model="birthDate" maxlength="30" /></label>
        <label class="wide">住址<input v-model="address" maxlength="300" autocomplete="street-address" /></label>
        <label>手机号<input v-model="phone" maxlength="11" inputmode="numeric" autocomplete="tel" /></label>
        <label class="wide">银行卡号<input v-model="cardNumber" maxlength="40" autocomplete="off" /></label>
        <label>开户银行<input v-model="bankName" maxlength="100" /></label>
        <label>开户支行（选填）<input v-model="branchName" maxlength="150" /></label>
        <label>入职账号权限<select v-model.number="selectedAccountRoleId"><option :value="null" disabled>请选择账号权限</option>
          <option v-for="role in accountRoles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label>
        <label>岗位与时薪<select v-model.number="selectedJobPositionId"><option :value="null" disabled>请选择岗位</option>
          <option v-for="position in intakeJobPositions" :key="position.id" :value="position.id">{{ position.name }} · {{ position.scheduleOnly ? '仅排班' : `¥${position.hourlyRate}/小时` }}</option></select></label>
        <label>入职生效日期<input v-model="effectiveDate" type="date" /></label>
      </div>
      <small v-if="!accountRoles.length || !jobPositions.length" class="role-empty-hint">提交前请先在后台启用可分配的人事角色，并为该门店配置岗位与时薪。</small>
      <label class="confirm confirm-prominent"><input v-model="confirmedOriginals" type="checkbox" /><b>我已在门店现场核验身份证和银行卡原件</b>
        <small>请核对本人证件原件及银行卡信息后勾选</small></label>
      <div class="form-actions"><button :disabled="busy" @click="saveDraft">暂存资料</button><button v-if="draftSavedAt" class="secondary" :disabled="busy" @click="clearDraft">清除暂存</button><button class="primary" :disabled="busy || !canSubmit" @click="submit">确认并提交入职审批</button></div>
      <small v-if="draftSavedAt" class="draft-note">已加密暂存，30 天后自动清理；现场核验确认不会暂存。</small>
    </template>
    <p v-else-if="storeId !== 'ALL' && canRead" class="hint">当前账号可查看入职申请列表，但没有入职录入权限；如需录入，请在该门店授权“填写并提交入职申请”和“录入员工敏感资料”。</p>
    <p v-else-if="storeId !== 'ALL' && !canWrite" class="hint">当前账号没有该门店的入职录入权限。</p>
    <h3 v-if="canRead">入职申请</h3>
    <label v-if="canApprove">拒绝原因<input v-model="rejectionReason" maxlength="500" /></label>
    <div v-if="canRead" class="table-scroll"><table><thead><tr><th>员工</th><th>生效日</th><th>身份证</th><th>银行卡</th><th>状态</th><th>操作</th></tr></thead>
      <tbody><tr v-for="item in pagedApplications" :key="item.id"><td>{{ item.employeeName }}</td><td>{{ item.effectiveDate }}</td>
        <td>{{ item.identityDetails?.idNumber ?? '—' }}</td><td>{{ item.bankDetails?.cardNumber ?? '—' }}</td><td>{{ onboardingStatusText(item.status) }}
          <small v-if="item.accountHrRole">入职人事权限：{{ item.accountHrRole.name }}</small>
          <small v-if="item.jobPosition">入职岗位：{{ item.jobPosition.name }} · ¥{{ item.jobPosition.hourlyRate }}/小时</small>
          <small v-else-if="item.accountRole">历史账号角色：{{ item.accountRole.name }}</small>
          <small v-if="item.approval?.status === 'APPROVED'">审批决定：已通过</small>
          <small v-if="item.approval?.position">第{{ item.approval.position }}/{{ item.approval.totalSteps }}步 · {{ item.approval.roleName }}</small>
          <small v-if="item.approval?.blockedReason" class="blocked-reason">{{ item.approval.blockedReason }}</small>
          <small v-if="item.rejectionReason" class="blocked-reason">驳回原因：{{ item.rejectionReason }}</small>
          <small v-if="item.status === 'EFFECTIVE_FAILED'" class="blocked-reason">{{ failureText(item.failureCode) }}</small></td>
        <td><div class="application-actions"><button class="secondary" :disabled="busy" @click="openDetails(item)">核对完整资料</button>
          <template v-if="canApprove && item.status === 'SUBMITTED' && item.approval?.canDecide">
          <button :disabled="busy" @click="decide(item, 'APPROVE')">通过</button>
          <button class="secondary" :disabled="busy" @click="decide(item, 'REJECT')">拒绝</button></template>
          <button v-if="item.canCorrectPhone" class="secondary" :disabled="busy" @click="openPhoneCorrection(item)">补录手机号并重新提交</button>
          <button class="secondary" :disabled="busy" @click="openHistory(item)">查看完整记录</button></div></td></tr></tbody></table></div><PaginationControls v-if="canRead" v-model:page="page" v-model:page-size="pageSize" :total="applications.length" />
  </section>
  <div v-if="detailsTarget" class="correction-backdrop" @click.self="detailsTarget = null"><section class="correction-dialog onboarding-details-dialog">
    <div class="history-heading"><div><h3>入职资料核对</h3><p>{{ detailsTarget.employeeName }} · {{ detailsTarget.storeName }} · 生效日 {{ detailsTarget.effectiveDate }}</p></div>
      <button class="secondary" @click="detailsTarget = null">关闭</button></div>
    <div class="onboarding-detail-grid">
      <h4>身份信息</h4><div><span>姓名</span><b>{{ detailsTarget.identityDetails?.name ?? detailsTarget.employeeName }}</b></div>
      <div><span>手机号</span><b>{{ detailsTarget.identityDetails?.phone ?? '未填写' }}</b></div>
      <div><span>身份证号码</span><b>{{ detailsTarget.identityDetails?.idNumber ?? '未填写' }}</b></div>
      <div><span>性别</span><b>{{ detailsTarget.identityDetails?.sex ?? '未填写' }}</b></div>
      <div><span>民族</span><b>{{ detailsTarget.identityDetails?.ethnicity ?? '未填写' }}</b></div>
      <div><span>出生日期</span><b>{{ detailsTarget.identityDetails?.birthDate ?? '未填写' }}</b></div>
      <div class="wide"><span>住址</span><b>{{ detailsTarget.identityDetails?.address ?? '未填写' }}</b></div>
      <h4>银行卡信息</h4><div><span>账户姓名</span><b>{{ detailsTarget.bankDetails?.accountName ?? '未填写' }}</b></div>
      <div><span>开户银行</span><b>{{ detailsTarget.bankDetails?.bankName ?? '未填写' }}</b></div>
      <div class="wide"><span>开户支行</span><b>{{ detailsTarget.bankDetails?.branchName ?? '未填写' }}</b></div>
      <div class="wide"><span>银行卡号</span><b>{{ detailsTarget.bankDetails?.cardNumber ?? '未填写' }}</b></div>
      <h4>入职分配</h4><div><span>账号权限</span><b>{{ detailsTarget.accountHrRole?.name ?? detailsTarget.accountRole?.name ?? '员工' }}</b></div>
      <div><span>岗位</span><b>{{ detailsTarget.jobPosition?.name ?? '未指定' }}</b></div>
      <div><span>岗位类型</span><b>{{ detailsTarget.jobPosition?.scheduleOnly ? '仅排班，不计工时' : detailsTarget.jobPosition?.hourlyRate ? `¥${detailsTarget.jobPosition.hourlyRate}/小时` : '按时薪' }}</b></div>
      <div class="wide confirm-readonly">门店已确认现场核验身份证和银行卡原件。</div>
    </div>
  </section></div>
  <div v-if="correctionTarget" class="correction-backdrop" @click.self="correctionTarget = null"><section class="correction-dialog card">
    <h3>更正入职申请</h3><p>员工：{{ correctionTarget.employeeName }}。修改后更新原申请，并保留每轮审批记录。</p>
    <label>入职门店<select v-model.number="correctionStoreId" @change="correctionStoreId && loadCorrectionOptions(correctionStoreId)"><option v-for="store in stores.filter(item => ['HR_ONBOARDING_CREATE','HR_ONBOARDING_VERIFY'].every(code => item.permissionCodes.includes(code)))" :key="store.id" :value="store.id">{{ store.storeName }}</option></select></label>
    <label>手机号（不修改可留空）<input v-model="correctionPhone" type="tel" inputmode="numeric" maxlength="11" placeholder="更正时填写 11 位手机号" @keyup.enter="correctPhoneAndResubmit" /></label>
    <label>入职账号权限<select v-model.number="correctionRoleId"><option v-for="role in correctionRoles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label>
    <label>岗位<select v-model.number="correctionPositionId"><option v-for="position in correctionPositions" :key="position.id" :value="position.id">{{ position.name }} · {{ position.scheduleOnly ? '仅排班' : `¥${position.hourlyRate}/小时` }}</option></select></label>
    <div class="correction-actions"><button class="secondary" :disabled="busy" @click="correctionTarget = null">取消</button>
      <button class="primary" :disabled="busy || !correctionStoreId || (!!correctionPhone.trim() && !/^1\d{10}$/.test(correctionPhone.trim()))" @click="correctPhoneAndResubmit">{{ busy ? '提交中…' : '保存并重新提交' }}</button></div>
  </section></div>
  <div v-if="historyTarget" class="correction-backdrop history-backdrop" @click.self="historyTarget = null"><section class="history-dialog card">
    <div class="history-heading"><div><h3>入职申请完整记录</h3><p>{{ historyTarget.employeeName }} · 申请 #{{ historyTarget.id }}</p></div><button class="secondary" @click="historyTarget = null">关闭</button></div>
    <p v-if="historyLoading">正在读取操作记录…</p>
    <template v-else-if="historyData">
      <h4>申请修订</h4><div class="revision-list"><div v-for="revision in historyData.revisions" :key="revision.id + '-' + revision.revision" class="revision-item">
        <b>第 {{ revision.revision }} 次提交</b><span>{{ onboardingStatusText(revision.status) }}</span><small>{{ new Date(revision.createdAt).toLocaleString() }}</small>
      </div></div>
      <h4>审批与操作日志</h4><div v-if="historyData.events.length" class="history-events"><article v-for="event in historyData.events" :key="event.id" class="history-event">
        <div class="event-line"><b>{{ eventActionText(event.action) }}</b><time>{{ new Date(event.createdAt).toLocaleString() }}</time></div>
        <small>{{ event.actorName }} · {{ event.entityType === 'HR_APPROVAL' ? '审批记录' : '申请记录' }}</small>
        <p v-if="event.reason">原因：{{ event.reason }}</p>
        <details v-if="event.beforeData || event.afterData"><summary>查看本次变更详情</summary><pre v-if="event.beforeData">变更前：{{ eventData(event.beforeData) }}</pre><pre v-if="event.afterData">变更后：{{ eventData(event.afterData) }}</pre></details>
      </article></div><p v-else>暂无操作日志。</p>
    </template>
  </section></div>
</template>

<style scoped>
.hr-onboarding h2{margin:0 0 8px}.hr-onboarding h3{margin:24px 0 10px}.hr-onboarding p{color:#64748b}
.permission-warning{padding:12px 14px;border:1px solid #f1c27a;border-radius:9px;background:#fff8e8;color:#8a4b08!important;line-height:1.55}
.row{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:14px 0}.row label{display:grid;gap:6px;min-width:220px}
input,select{min-height:38px}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:14px}
.form-grid label{display:grid;gap:6px}.form-grid .wide{grid-column:1/-1}.id-preview{display:block;max-width:min(480px,100%);max-height:280px;object-fit:contain;margin:8px 0 18px;border-radius:8px}
.confirm{display:flex;align-items:center;gap:8px;margin:18px 0}.confirm input{min-height:auto}.primary{background:#eb5c1c;color:#fff}.secondary{background:#eef3f9;color:#2b517d}.table-scroll{overflow:auto}
.form-actions{display:flex;flex-wrap:wrap;gap:10px}.form-actions button{min-height:40px}.draft-note{display:block;margin-top:8px;color:#64748b}
table{width:100%;min-width:820px}td button{margin-right:6px}
.role-empty-hint{display:block;max-width:240px;color:#a14b20;line-height:1.45}
.id-upload-frame{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:220px;margin:12px 0 18px;padding:18px;border:2px dashed #efb18f;border-radius:14px;background:#fff9f5;text-align:center}.id-upload-frame.has-image{border-style:solid;background:#fff}.id-upload-empty{display:flex;flex-direction:column;align-items:center;gap:8px;color:#56647a}.id-upload-empty b{display:grid;place-items:center;width:56px;height:56px;border-radius:16px;background:#ffeadf;color:#d3541d;font-size:27px}.id-upload-empty strong{font-size:16px}.id-upload-empty small,.id-upload-note{color:#8490a2}.id-upload-actions{display:flex;justify-content:center;align-items:center;gap:9px;flex-wrap:wrap}.id-upload-actions button,.id-upload-action{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 15px;border:0;border-radius:8px;background:#eb5c1c;color:#fff;cursor:pointer}.id-upload-actions .secondary{background:#eef3f9;color:#2b517d}.id-upload-action input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.id-preview{max-width:min(460px,100%);max-height:300px;margin:0;border-radius:8px;object-fit:contain}.confirm-prominent{display:grid;grid-template-columns:22px 1fr;align-items:center;gap:4px 10px;margin:18px 0;padding:14px;border:1px solid #f4b183;border-radius:10px;background:#fff6ef;color:#8b3f20}.confirm-prominent input{grid-row:span 2;width:20px;height:20px;accent-color:#eb5c1c}.confirm-prominent small{color:#9a684e}
.blocked-reason{color:#b45309!important;white-space:normal;max-width:320px}.account-role-select{min-width:160px;min-height:36px;border:1px solid #dce3ec;border-radius:7px;padding:0 8px;background:#fff}
.application-actions{display:flex;flex-wrap:wrap;gap:6px}.correction-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:18px;background:#10182888}.correction-dialog{width:min(460px,100%);padding:22px}.correction-dialog h3{margin:0}.correction-dialog p{line-height:1.6}.correction-dialog label{display:grid;gap:7px}.correction-dialog input,.correction-dialog select{min-height:40px;padding:0 10px;border:1px solid #d7dee8;border-radius:8px}.correction-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
.history-dialog{width:min(900px,100%);max-height:min(88vh,900px);overflow:auto;padding:22px}.history-heading,.event-line{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.history-heading h3{margin:0}.history-heading p{margin:6px 0;color:#64748b}.history-dialog h4{margin:20px 0 8px}.revision-list{display:flex;gap:8px;flex-wrap:wrap}.revision-item{display:grid;gap:5px;padding:10px 14px;background:#f5f7fa;border-radius:8px}.revision-item small,.history-event small{color:#64748b}.history-events{display:grid;gap:10px}.history-event{padding:12px;border:1px solid #e2e8f0;border-radius:9px}.event-line time{color:#64748b;font-size:12px;white-space:nowrap}.history-event details{margin-top:8px}.history-event pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f8fa;padding:10px;border-radius:6px;font-size:12px}
.onboarding-details-dialog{width:min(760px,100%);max-height:88vh;overflow:auto}.onboarding-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}.onboarding-detail-grid h4{grid-column:1/-1;margin:18px 0 5px;padding-bottom:7px;border-bottom:1px solid #e8edf4}.onboarding-detail-grid>div{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid #f0f2f5;line-height:1.5}.onboarding-detail-grid span{flex:none;color:#7b8799}.onboarding-detail-grid b{text-align:right;overflow-wrap:anywhere;font-weight:600;color:#26344b}.onboarding-detail-grid .wide{grid-column:1/-1}.onboarding-detail-grid .confirm-readonly{justify-content:flex-start;color:#81512b;background:#fff8ef;padding:12px;margin-top:14px;border:0;border-radius:8px}@media(max-width:560px){.onboarding-detail-grid{grid-template-columns:1fr}.onboarding-detail-grid .wide{grid-column:auto}}
@media(max-width:720px){.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}}
</style>

