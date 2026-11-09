<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'
import { hrFailureLabel, hrStatusLabel } from '../../utils/hr-labels'

type Store = { id: number; storeName?: string; permissionCodes: string[] }
type AccountRole = { id: number; code: string; name: string }
type JobPosition = { id: number; name: string; scheduleOnly: boolean; hourlyRate: string | null; label?: string }
type TrialEmployee = { id: number; name: string; trialStartedAt: string | null }
type Application = { id: number; employeeName: string; effectiveDate: string; identityMask: string | null; bankMask: string | null;
  identityDetails?: { name?: string | null; phone?: string | null; idNumber?: string | null; sex?: string | null;
    ethnicity?: string | null; birthDate?: string | null; address?: string | null } | null;
  bankDetails?: { accountName?: string | null; bankName?: string | null; branchName?: string | null; cardNumber?: string | null } | null;
  status: string; failureCode?: string | null; rejectionReason?: string | null; storeId: number; canCorrectPhone?: boolean; approval?: { position: number | null; totalSteps: number;
    roleName: string | null; canDecide: boolean; blockedReason: string | null } | null; accountRole?: { code: string; name: string } | null;
  accountHrRole?: { id: number; code: string; name: string } | null;
  jobPosition?: { id: number | null; name: string; scheduleOnly: boolean; hourlyRate: string | null } | null }
type OcrField = { value?: string; confidence?: number | null }
type OcrResult = { fields?: { name?: OcrField; idNumber?: OcrField; sex?: OcrField; ethnicity?: OcrField; birthDate?: OcrField; address?: OcrField } }

const storeId = ref(0)
const permissions = ref<string[]>([])
const applications = ref<Application[]>([])
const correctionStores = ref<Store[]>([])
const accountRoles = ref<AccountRole[]>([])
const jobPositions = ref<JobPosition[]>([])
const trialEmployees = ref<TrialEmployee[]>([])
const selectedTrialEmployeeId = ref<number | null>(null)
const requestedTrialEmployeeId = ref<number | null>(null)
const trialConversionMode = ref(false)
const selectedAccountRoleId = ref<number | null>(null)
const selectedJobPositionId = ref<number | null>(null)
const correctionRoles = ref<Record<number, AccountRole[]>>({})
const correctionPositions = ref<Record<number, JobPosition[]>>({})
const correctionAccountRoleIds = ref<Record<number, number | null>>({})
const correctionJobPositionIds = ref<Record<number, number | null>>({})
const name = ref('')
const phone = ref('')
const idNumber = ref('')
const sex = ref('')
const ethnicity = ref('')
const birthDate = ref('')
const address = ref('')
const cardNumber = ref('')
const bankName = ref('')
const branchName = ref('')
const effectiveDate = ref('')
const verified = ref(false)
const rejectionReason = ref('')
const phoneCorrections = ref<Record<number, string>>({})
const correctionStoreIds = ref<Record<number, number>>({})
const idCardImagePath = ref('')
const draftLoadedFor = ref(0)
const draftSavedAt = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const canCreate = computed(() => permissions.value.includes('HR_ONBOARDING_CREATE'))
const canWrite = computed(() => canCreate.value)
const canStartIntake = computed(() => canCreate.value)
const selectedTrial = computed(() => trialConversionMode.value
  ? trialEmployees.value.find((item) => item.id === selectedTrialEmployeeId.value) ?? null
  : null)
const intakeJobPositions = computed(() => selectedTrial.value
  ? jobPositions.value.filter((position) => !position.scheduleOnly && position.hourlyRate != null)
  : jobPositions.value)
const canVerify = computed(() => permissions.value.includes('HR_ONBOARDING_VERIFY'))
const canApprove = computed(() => permissions.value.includes('HR_ONBOARDING_APPROVE'))
const canReadList = computed(() => ['HR_ONBOARDING_LIST_READ', 'HR_ONBOARDING_VERIFY', 'HR_ONBOARDING_APPROVE'].some((permission) => permissions.value.includes(permission)))
const missingIntakePermissions = computed(() => ([
  ['HR_ONBOARDING_CREATE', '填写并提交入职申请'],
  ['HR_ONBOARDING_VERIFY', '门店现场核验'],
] as const).filter(([code]) => !permissions.value.includes(code)).map(([, label]) => label))
function isValidIdentityNumber(value: string) {
  const number = value.trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(number)) return false
  const birth = number.slice(6, 14)
  const year = Number(birth.slice(0, 4)); const month = Number(birth.slice(4, 6)); const day = Number(birth.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = '10X98765432'
  const remainder = [...number.slice(0, 17)].reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0) % 11
  return checks[remainder] === number[17]
}
const identityNumberValid = computed(() => isValidIdentityNumber(idNumber.value))
const bankCardValid = computed(() => /^\d{12,25}$/.test(cardNumber.value.replace(/\s/g, '')))
const canSubmit = computed(() => canCreate.value && canWrite.value && canVerify.value && name.value.trim() && /^1\d{10}$/.test(phone.value.trim()) &&
  identityNumberValid.value && bankCardValid.value && bankName.value.trim() && effectiveDate.value && verified.value &&
  selectedAccountRoleId.value != null && selectedJobPositionId.value != null &&
  (!selectedTrial.value || (effectiveDate.value >= (selectedTrial.value.trialStartedAt ?? '9999-99-99') &&
    intakeJobPositions.value.some((position) => position.id === selectedJobPositionId.value &&
      !position.scheduleOnly && position.hourlyRate != null))))

onLoad((options) => {
  storeId.value = Number(options?.storeId || 0)
  const trialEmployeeId = Number(options?.trialEmployeeId || 0) || null
  trialConversionMode.value = trialEmployeeId != null
  selectedTrialEmployeeId.value = null
  requestedTrialEmployeeId.value = trialEmployeeId
  const today = new Date()
  effectiveDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
})
onShow(() => { if (storeId.value) void load() })

async function load() {
  loading.value = true; message.value = ''
  try {
    const access = await request<{ stores: Store[] }>('/api/hr/current-access')
    permissions.value = access.stores.find((store) => store.id === storeId.value)?.permissionCodes ?? []
    correctionStores.value = access.stores.filter((store) => ['HR_ONBOARDING_CREATE',
      'HR_ONBOARDING_VERIFY'].every((permission) => store.permissionCodes.includes(permission)))
    applications.value = canReadList.value
      ? await request<Application[]>(`/api/hr/onboarding?storeId=${storeId.value}`) : []
    if (canCreate.value) {
      const [roles, positions, trials] = await Promise.all([
        request<AccountRole[]>(`/api/hr/onboarding/account-roles?storeId=${storeId.value}`),
        request<JobPosition[]>(`/api/hr/job-positions/selectable?storeId=${storeId.value}`),
        request<TrialEmployee[]>(`/api/hr/employees/trials?storeId=${storeId.value}`),
      ])
      accountRoles.value = roles
      trialEmployees.value = trials
      if (selectedTrialEmployeeId.value != null && !trials.some((item) => item.id === selectedTrialEmployeeId.value))
        selectedTrialEmployeeId.value = null
      jobPositions.value = positions.map((position) => ({ ...position,
        label: `${position.name} · ${position.scheduleOnly ? '仅排班' : `¥${position.hourlyRate}/小时`}` }))
      if (selectedAccountRoleId.value == null || !roles.some((role) => role.id === selectedAccountRoleId.value))
        selectedAccountRoleId.value = roles.find((role) => role.code === 'EMPLOYEE')?.id ??
          roles.find((role) => role.name.trim() === '员工')?.id ?? roles[0]?.id ?? null
      if (selectedJobPositionId.value != null && !positions.some((position) => position.id === selectedJobPositionId.value))
        selectedJobPositionId.value = null
      if (selectedJobPositionId.value == null) selectedJobPositionId.value = positions[0]?.id ?? null
    } else { accountRoles.value = []; jobPositions.value = []; trialEmployees.value = [] }
    if (canCreate.value && draftLoadedFor.value !== storeId.value) {
      const draft = await request<Record<string, string> | null>(`/api/hr/onboarding/draft?storeId=${storeId.value}`)
      draftLoadedFor.value = storeId.value
      if (draft && requestedTrialEmployeeId.value == null) {
        name.value = draft.name ?? ''; phone.value = draft.phone ?? ''; idNumber.value = draft.idNumber ?? ''
        sex.value = draft.sex ?? ''; ethnicity.value = draft.ethnicity ?? ''; birthDate.value = draft.birthDate ?? ''
        address.value = draft.address ?? ''; cardNumber.value = draft.cardNumber ?? ''; bankName.value = draft.bankName ?? ''
        branchName.value = draft.branchName ?? ''; effectiveDate.value = draft.effectiveDate || effectiveDate.value
        selectedAccountRoleId.value = Number(draft.accountHrRoleId) || selectedAccountRoleId.value
        selectedJobPositionId.value = Number(draft.jobPositionId) || selectedJobPositionId.value
        draftSavedAt.value = draft.updatedAt ?? ''
        message.value = '已恢复加密暂存资料，请核对后继续；现场核验确认需要重新勾选。'
      }
    }
    if (requestedTrialEmployeeId.value != null) {
      const trial = trialEmployees.value.find((item) => item.id === requestedTrialEmployeeId.value)
      requestedTrialEmployeeId.value = null
      if (trial) {
        selectedTrialEmployeeId.value = trial.id
        applyTrial(trial)
      } else {
        trialConversionMode.value = false
        selectedTrialEmployeeId.value = null
        message.value = '未找到该试岗人员，请返回试岗列表刷新后重试。'
      }
    } else if (!trialConversionMode.value) selectedTrialEmployeeId.value = null
  } catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}

async function saveDraft() {
  if (!canCreate.value || !storeId.value) return
  saving.value = true; message.value = ''
  try {
    const result = await request<{ saved: boolean; cleared?: boolean }>('/api/hr/onboarding/draft', 'POST', {
      initialStoreId: storeId.value, name: name.value, phone: phone.value, idNumber: idNumber.value,
      sex: sex.value, ethnicity: ethnicity.value, birthDate: birthDate.value, address: address.value,
      cardNumber: cardNumber.value, bankName: bankName.value, branchName: branchName.value,
      effectiveDate: effectiveDate.value, accountHrRoleId: String(selectedAccountRoleId.value ?? ''),
      jobPositionId: String(selectedJobPositionId.value ?? ''),
    })
    draftSavedAt.value = result.saved ? new Date().toISOString() : ''
    message.value = result.saved ? '入职资料已加密暂存，可稍后继续填写。' : '空白暂存资料已清除。'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}

async function clearDraft() {
  if (!storeId.value || !canWrite.value) return
  saving.value = true; message.value = ''
  try {
    await request(`/api/hr/onboarding/draft?storeId=${storeId.value}`, 'DELETE')
    name.value = ''; phone.value = ''; idNumber.value = ''; sex.value = ''; ethnicity.value = ''; birthDate.value = ''
    address.value = ''; cardNumber.value = ''; bankName.value = ''; branchName.value = ''; draftSavedAt.value = ''
    verified.value = false; draftLoadedFor.value = storeId.value; idCardImagePath.value = ''
    selectedAccountRoleId.value = accountRoles.value.find((role) => role.code === 'EMPLOYEE')?.id ?? null
    selectedJobPositionId.value = jobPositions.value[0]?.id ?? null
    message.value = '暂存资料已清除。'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}

async function recognizeIdCard() {
  if (!canWrite.value || !storeId.value) return
  saving.value = true; message.value = ''
  try {
    const image = await new Promise<string>((resolve, reject) => uni.chooseImage({ count: 1,
      sizeType: ['compressed'], sourceType: ['camera', 'album'],
      success: (result) => resolve(result.tempFilePaths[0]), fail: reject }))
    idCardImagePath.value = image
    const result = await new Promise<OcrResult>((resolve, reject) => uni.uploadFile({
      url: `${import.meta.env.VITE_API_BASE}/api/hr/onboarding/ocr-preview?storeId=${storeId.value}`,
      filePath: image, name: 'image', formData: { documentType: 'ID_CARD_FRONT' },
      header: { Authorization: `Bearer ${uni.getStorageSync('accessToken')}` },
      success: (response) => {
        try {
          const data = JSON.parse(response.data)
          if (response.statusCode < 200 || response.statusCode >= 300) { reject(data); return }
          resolve(data as OcrResult)
        } catch (error) { reject(error) }
      }, fail: reject,
    }))
    const fields = result.fields ?? {}
    name.value = fields.name?.value ?? name.value
    idNumber.value = fields.idNumber?.value ?? idNumber.value
    sex.value = fields.sex?.value ?? sex.value
    ethnicity.value = fields.ethnicity?.value ?? ethnicity.value
    birthDate.value = fields.birthDate?.value ?? birthDate.value
    address.value = fields.address?.value ?? address.value
    message.value = '识别信息已显示并填入表单，请对照身份证原件核对后提交。'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
function removeIdCardImage() { idCardImagePath.value = '' }

function applyTrial(trial: TrialEmployee) {
  name.value = trial.name
  if (!intakeJobPositions.value.some((position) => position.id === selectedJobPositionId.value))
    selectedJobPositionId.value = intakeJobPositions.value[0]?.id ?? null
  if (trial.trialStartedAt && effectiveDate.value < trial.trialStartedAt) effectiveDate.value = trial.trialStartedAt
}

async function submit() {
  if (!canSubmit.value || !storeId.value) return
  saving.value = true; message.value = ''
  try {
    await request('/api/hr/onboarding/direct', 'POST', {
      initialStoreId: storeId.value, displayName: name.value.trim(), phone: phone.value.trim(),
      idNumber: idNumber.value.trim(), sex: sex.value.trim(), ethnicity: ethnicity.value.trim(),
      birthDate: birthDate.value.trim(), address: address.value.trim(),
      accountName: name.value.trim(), cardNumber: cardNumber.value.trim(), bankName: bankName.value.trim(),
      branchName: branchName.value.trim(), effectiveDate: effectiveDate.value, confirmedOriginals: true,
      accountHrRoleId: selectedAccountRoleId.value, jobPositionId: selectedJobPositionId.value,
      ...(selectedTrialEmployeeId.value != null ? { trialEmployeeId: selectedTrialEmployeeId.value } : {}),
    })
    const convertedTrial = selectedTrialEmployeeId.value != null
    name.value = ''; phone.value = ''; idNumber.value = ''; sex.value = ''; ethnicity.value = ''
    birthDate.value = ''; address.value = ''; cardNumber.value = ''; bankName.value = ''; branchName.value = ''
    selectedAccountRoleId.value = accountRoles.value.find((role) => role.code === 'EMPLOYEE')?.id ?? null
    selectedJobPositionId.value = jobPositions.value[0]?.id ?? null
    verified.value = false; idCardImagePath.value = ''; draftSavedAt.value = ''; draftLoadedFor.value = storeId.value
    selectedTrialEmployeeId.value = null; trialConversionMode.value = false
    await load(); message.value = convertedTrial
      ? '试岗人员的入职资料已提交，审批通过后将沿用原人员和工时记录。'
      : '入职资料已提交，审批流程已启动。'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}

async function decide(item: Application, decision: 'APPROVE' | 'REJECT') {
  if (!canApprove.value || item.status !== 'SUBMITTED') return
  if (!item.approval?.canDecide) { message.value = item.approval?.blockedReason || '当前账号不符合此审批步骤的角色和门店授权'; return }
  if (decision === 'REJECT' && !rejectionReason.value.trim()) { message.value = '请填写拒绝原因'; return }
  saving.value = true; message.value = ''
  try {
    await request(`/api/hr/onboarding/${item.id}/decisions`, 'POST',
      { decision, reason: rejectionReason.value.trim() })
    rejectionReason.value = ''; await load(); message.value = '审批决定已记录'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
async function correctPhone(item: Application) {
  const supplied = (phoneCorrections.value[item.id] ?? '').trim().replace(/[\s()-]/g, '')
  const phone = supplied.replace(/^\+?86(?=1\d{10}$)/, '')
  if (phone && !/^1\d{10}$/.test(phone)) { message.value = '手机号需为空或填写有效的 11 位手机号'; return }
  const targetStoreId = correctionStoreIds.value[item.id] || item.storeId
  const accountHrRoleId = correctionAccountRoleIds.value[item.id] ?? item.accountHrRole?.id ?? null
  const jobPositionId = correctionJobPositionIds.value[item.id] ?? item.jobPosition?.id ?? null
  if (accountHrRoleId == null || jobPositionId == null) { message.value = '请为入职申请选择账号权限和岗位'; return }
  saving.value = true; message.value = ''
  try {
    await request(`/api/hr/onboarding/${item.id}/correct-phone`, 'POST', {
      ...(phone ? { phone } : {}), storeId: targetStoreId, accountHrRoleId, jobPositionId,
    })
    phoneCorrections.value[item.id] = ''
    await load(); message.value = '申请信息已更正，原记录已重新提交审批'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
async function loadCorrectionOptions(item: Application, storeIdValue: number) {
  try {
    const [roles, positions] = await Promise.all([
      request<AccountRole[]>(`/api/hr/onboarding/account-roles?storeId=${storeIdValue}`),
      request<JobPosition[]>(`/api/hr/job-positions/selectable?storeId=${storeIdValue}`),
    ])
    correctionRoles.value[item.id] = roles
    correctionPositions.value[item.id] = positions
    correctionAccountRoleIds.value[item.id] = roles.find((role) => role.id === item.accountHrRole?.id)?.id ??
      roles.find((role) => role.code === 'EMPLOYEE')?.id ?? roles[0]?.id ?? null
    correctionJobPositionIds.value[item.id] = positions.find((position) => position.id === item.jobPosition?.id)?.id ??
      positions[0]?.id ?? null
  } catch (error) { message.value = errorMessage(error) }
}
async function openCorrection(item: Application) {
  correctionStoreIds.value[item.id] = item.storeId
  await loadCorrectionOptions(item, item.storeId)
}
async function changeCorrectionStore(item: Application, index: number) {
  const target = correctionStores.value[index]
  if (!target) return
  correctionStoreIds.value[item.id] = target.id
  await loadCorrectionOptions(item, target.id)
}
function statusName(status: string) {
  return hrStatusLabel(status)
}
function failureText(code?: string | null) {
  return hrFailureLabel(code)
}
</script>

<template>
  <view class="page detail-page">
    <PageLoading v-if="loading" text="正在加载入职信息" />
    <view class="store-context-heading"><view class="heading">员工入职</view>
      <StoreSelector v-model="storeId" source="hr" :permission="['HR_ONBOARDING_CREATE','HR_ONBOARDING_LIST_READ','HR_ONBOARDING_DETAIL_READ','HR_ONBOARDING_VERIFY','HR_ONBOARDING_APPROVE']" @ready="load" @change="load" /></view>
    <view class="subheading">一次填写并提交；身份证信息识别后直接显示，请核对原件。</view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view v-if="canStartIntake" class="card section">
      <text class="section-title">入职资料</text>
      <view v-if="selectedTrial" class="field assignment-picker">试岗转入职<text>{{ selectedTrial.name }} · 开始于 {{ selectedTrial.trialStartedAt || '未记录' }}</text></view>
      <text v-if="selectedTrial" class="trial-note">审批通过后沿用原试岗人员及排班工时。试岗期间已确认工时按正式岗位时薪计薪；请选已配置时薪的岗位。</text>
      <view v-if="missingIntakePermissions.length" class="permission-warning">
        当前门店缺少：{{ missingIntakePermissions.join('、') }}。入职资料可暂存；补齐现场核验权限后才能提交审批。
      </view>
      <view class="id-upload-frame" :class="{ 'has-image': idCardImagePath }">
        <image v-if="idCardImagePath" class="id-card-preview" :src="idCardImagePath" mode="aspectFit" />
        <view v-else class="id-upload-empty"><text class="id-upload-icon">证</text><text>身份证正面照片</text></view>
        <button class="id-upload-button" :disabled="saving" @click="recognizeIdCard">{{ idCardImagePath ? '重新上传并识别' : '拍摄或选择照片' }}</button>
        <button v-if="idCardImagePath" class="id-remove-button" :disabled="saving" @click="removeIdCardImage">删除照片</button>
        <text class="id-upload-note">照片仅用于本次识别，不会保存原图</text>
      </view>
      <view class="field"><text>姓名</text><input v-model="name" maxlength="100" placeholder="与身份证一致" /></view>
      <view class="field"><text>身份证号码</text><input v-model="idNumber" maxlength="18" placeholder="识别结果完整显示，可手动核对" /></view>
      <text v-if="idNumber && !identityNumberValid" class="validation-note">身份证号码校验未通过，请核对号码、出生日期和末位校验码。</text>
      <view class="fields-row">
        <view class="field"><text>性别（识别）</text><input v-model="sex" /></view>
        <view class="field"><text>民族（识别）</text><input v-model="ethnicity" /></view>
        <view class="field"><text>出生日期（识别）</text><input v-model="birthDate" /></view>
      </view>
      <view class="field"><text>住址</text><input v-model="address" maxlength="300" placeholder="识别后可修改" /></view>
      <view class="field"><text>手机号</text><input v-model="phone" type="number" maxlength="11" placeholder="员工联系电话" /></view>
      <view class="field bank-number-field"><text>银行卡号</text><input v-model="cardNumber" type="number" maxlength="30" placeholder="现场核验后填写完整卡号" /></view>
      <view class="fields-row">
        <view class="field"><text>开户银行</text><input v-model="bankName" placeholder="银行名称" /></view>
        <view class="field"><text>支行（选填）</text><input v-model="branchName" maxlength="150" placeholder="支行名称" /></view>
      </view>
      <text v-if="cardNumber && !bankCardValid" class="validation-note">银行卡号需为 12 至 25 位数字，请核对后再提交。</text>
      <picker :range="accountRoles" range-key="name" :value="Math.max(0, accountRoles.findIndex((role) => role.id === selectedAccountRoleId))"
        @change="(event) => selectedAccountRoleId = accountRoles[Number(event.detail.value)]?.id ?? null">
        <view class="field assignment-picker">账号权限<text>{{ accountRoles.find((role) => role.id === selectedAccountRoleId)?.name || '请选择账号权限' }}</text></view>
      </picker>
      <picker :range="intakeJobPositions" range-key="label" :value="Math.max(0, intakeJobPositions.findIndex((position) => position.id === selectedJobPositionId))"
        @change="(event) => selectedJobPositionId = intakeJobPositions[Number(event.detail.value)]?.id ?? null">
        <view class="field assignment-picker">岗位<text>{{ intakeJobPositions.find((position) => position.id === selectedJobPositionId)?.label || '请选择岗位' }}</text></view>
      </picker>
      <text v-if="!accountRoles.length || !intakeJobPositions.length" class="blocked-note">{{ selectedTrial ? '试岗转入职前，请先在后台为该门店配置有时薪的正式岗位。' : '提交前请先在后台配置可分配的人事角色和该门店岗位。' }}</text>
      <picker mode="date" :value="effectiveDate" @change="(event) => effectiveDate = String(event.detail.value)">
        <view class="field">入职生效日：{{ effectiveDate }}</view>
      </picker>
      <view class="confirm-card" :class="{ checked: verified }" @click="verified = !verified"><text class="confirm-check">{{ verified ? '✓' : '' }}</text><view><text class="confirm-title">已在门店现场核验原件</text><text class="confirm-copy">请确认身份证与银行卡原件均已当面核验</text></view></view>
      <view class="form-actions"><button class="save-draft" :disabled="saving || !canCreate" @click="saveDraft">暂存资料</button>
        <button v-if="draftSavedAt" class="clear-draft" :disabled="saving || !canWrite" @click="clearDraft">清除暂存</button>
        <text v-if="draftSavedAt" class="draft-note">已加密暂存，30 天后自动清理；现场核验确认不会暂存。</text></view>
      <button class="button" :disabled="saving || !canSubmit" @click="submit">确认并提交入职审批</button>
    </view>
    <view v-else-if="canReadList" class="card hint">当前账号可查看入职申请列表，但没有入职录入权限；如需录入，请在该门店授权“填写并提交入职申请”和“录入员工敏感资料”。</view>
    <view v-else-if="canCreate || canWrite || canVerify" class="card hint">当前门店入职权限不完整，请管理员检查入职录入和门店现场核验权限。</view>
    <view v-if="canReadList" class="section-title list-title">入职申请</view>
    <view v-if="canReadList && !applications.length && !loading" class="card hint">暂无入职申请</view>
    <view v-for="item in applications" :key="item.id" class="card record">
      <view class="record-head"><text class="name">{{ item.employeeName }}</text><text class="status-pill" :class="{ ok: item.status === 'EFFECTIVE' }">{{ statusName(item.status) }}</text></view>
      <text class="detail">生效日 {{ item.effectiveDate }}</text>
      <text class="detail">身份证 {{ item.identityDetails?.idNumber || '—' }} · 银行卡 {{ item.bankDetails?.cardNumber || '—' }}</text>
      <text v-if="item.rejectionReason" class="blocked-note">驳回原因：{{ item.rejectionReason }}</text>
      <text v-if="item.approval?.position && item.status === 'SUBMITTED'" class="approval-note">
        第 {{ item.approval.position }}/{{ item.approval.totalSteps }} 步 · {{ item.approval.roleName || '待审批角色' }}
      </text>
      <text v-if="item.accountRole" class="approval-note">账号权限角色：{{ item.accountRole.name }}</text>
      <text v-if="item.accountHrRole" class="approval-note">账号权限角色：{{ item.accountHrRole.name }}</text>
      <text v-if="item.jobPosition" class="approval-note">岗位：{{ item.jobPosition.name }} · {{ item.jobPosition.scheduleOnly ? '仅排班，不计工时' : `¥${item.jobPosition.hourlyRate}/小时` }}</text>
      <text v-if="item.approval?.blockedReason && item.status === 'SUBMITTED'" class="blocked-note">{{ item.approval.blockedReason }}</text>
      <text v-if="item.status === 'EFFECTIVE_FAILED'" class="blocked-note">{{ failureText(item.failureCode) }}</text>
      <view v-if="item.canCorrectPhone" class="phone-correction">
        <button v-if="correctionStoreIds[item.id] == null" class="small-action" :disabled="saving" @click="openCorrection(item)">更正手机号或门店</button>
        <picker v-if="correctionStores.length" :range="correctionStores" range-key="storeName"
          :value="Math.max(0, correctionStores.findIndex(store => store.id === (correctionStoreIds[item.id] || item.storeId)))"
          @change="(event) => changeCorrectionStore(item, Number(event.detail.value))">
          <view class="field">入职门店：{{ correctionStores.find(store => store.id === (correctionStoreIds[item.id] || item.storeId))?.storeName || '选择有权限的门店' }}</view>
        </picker>
        <picker v-if="correctionRoles[item.id]?.length" :range="correctionRoles[item.id]" range-key="name"
          @change="(event) => correctionAccountRoleIds[item.id] = correctionRoles[item.id][Number(event.detail.value)]?.id ?? null">
          <view class="field">账号权限：{{ correctionRoles[item.id].find(role => role.id === correctionAccountRoleIds[item.id])?.name || '请选择账号权限' }}</view>
        </picker>
        <picker v-if="correctionPositions[item.id]?.length" :range="correctionPositions[item.id]" range-key="label"
          @change="(event) => correctionJobPositionIds[item.id] = correctionPositions[item.id][Number(event.detail.value)]?.id ?? null">
          <view class="field">岗位：{{ correctionPositions[item.id].find(position => position.id === correctionJobPositionIds[item.id])?.name || '请选择岗位' }}</view>
        </picker>
        <input v-model="phoneCorrections[item.id]" class="field" type="number" maxlength="11" placeholder="手机号有误时填写；不改手机号可留空" />
        <button class="small-action" :disabled="saving" @click="correctPhone(item)">更正信息并重新提交</button>
      </view>
      <template v-if="canApprove && item.status === 'SUBMITTED' && item.approval?.canDecide">
        <input v-model="rejectionReason" class="field" maxlength="500" placeholder="拒绝时填写原因" />
        <view class="actions"><button :disabled="saving" @click="decide(item, 'APPROVE')">通过</button>
          <button :disabled="saving" @click="decide(item, 'REJECT')">拒绝</button></view>
      </template>
    </view>
  </view>
</template>

<style scoped>
.heading{font-size:38rpx;font-weight:700;color:#172033}.subheading{margin-top:10rpx;color:#7f8a9c;font-size:23rpx}
.notice{margin-top:20rpx;color:#b45309}.validation-note{display:block;margin:-8rpx 0 14rpx;color:#c2410c;font-size:23rpx;line-height:1.5}.section{margin-top:24rpx}.section-title{display:block;font-size:29rpx;font-weight:700;color:#25334a}
.field{display:block;margin:16rpx 0;padding:18rpx;border:1rpx solid #e2e8f0;border-radius:14rpx;color:#334155}
.field input{margin-top:10rpx}.fields-row{display:flex;gap:14rpx}.fields-row .field{flex:1;min-width:0}.hint{margin:14rpx 0;color:#8794a5;font-size:23rpx;line-height:1.5}
.id-upload-frame{position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:330rpx;margin:20rpx 0;padding:22rpx;border:2rpx dashed #edb99c;border-radius:20rpx;background:#fff9f5;text-align:center}.id-upload-frame.has-image{border-style:solid;background:#f8fafc}.id-card-preview{display:block;width:100%;height:340rpx;object-fit:contain;border-radius:12rpx}.id-upload-empty{display:flex;flex-direction:column;align-items:center;gap:12rpx;color:#6c788b;font-size:23rpx}.id-upload-icon{display:flex;align-items:center;justify-content:center;width:80rpx;height:80rpx;border-radius:24rpx;background:#ffeadf;color:#d7531d;font-size:38rpx;font-weight:800}.id-upload-button{min-width:300rpx;margin:18rpx auto 0;padding:0 25rpx;border:0;border-radius:15rpx;background:#e85c20;color:#fff;font-size:25rpx;font-weight:700}.id-upload-button::after{border:0}.id-remove-button{margin:10rpx auto 0;padding:0 24rpx;border:1rpx solid #e2e8f0;border-radius:12rpx;background:#fff;color:#657187;font-size:22rpx}.id-remove-button::after{border:0}.id-upload-note{margin-top:14rpx;color:#909aaa;font-size:19rpx}.bank-number-field{width:100%;box-sizing:border-box}.assignment-picker{display:flex;justify-content:space-between;gap:20rpx}.assignment-picker text{color:#d45a1d;font-weight:700;text-align:right}.trial-note{display:block;margin:0 0 16rpx;padding:16rpx;border-radius:14rpx;background:#fff5ec;color:#9a572f;font-size:21rpx;line-height:1.5}
.secondary{margin:12rpx 0;border:1rpx solid #f0d3c2;border-radius:14rpx;background:#fff6f1;color:#d4541c;font-size:25rpx}
.confirm-card{display:flex;align-items:center;gap:18rpx;margin:22rpx 0;padding:22rpx;border:2rpx solid #f2b38e;border-radius:18rpx;background:#fff2e9}.confirm-card.checked{border-color:#df5c22;background:#ffeadc}.confirm-check{display:flex;flex:none;align-items:center;justify-content:center;width:48rpx;height:48rpx;border:3rpx solid #df5c22;border-radius:12rpx;background:#fff;color:#fff;font-size:32rpx;font-weight:800}.confirm-card.checked .confirm-check{background:#df5c22}.confirm-title{display:block;color:#8f391b;font-size:25rpx;font-weight:800}.confirm-copy{display:block;margin-top:5rpx;color:#9c684d;font-size:21rpx;line-height:1.45}
.form-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12rpx;margin-bottom:12rpx}.save-draft,.clear-draft{flex:1;min-width:220rpx;border:1rpx solid #f0d3c2;border-radius:12rpx;background:#fff6f1;color:#d4541c;font-size:24rpx}.clear-draft{border-color:#e2e8f0;background:#f8fafc;color:#475569}.draft-note{flex-basis:100%;color:#78879a;font-size:21rpx;line-height:1.5}
.list-title{margin:30rpx 0 14rpx}.record{box-sizing:border-box;width:100%;margin-bottom:16rpx;overflow:hidden}.record-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12rpx;min-width:0}.record-head .name{display:block;flex:1 1 220rpx;min-width:0;font-size:28rpx;font-weight:700;line-height:1.45;white-space:normal;overflow-wrap:anywhere;word-break:break-word}.status-pill{flex:none;max-width:45%;white-space:normal;text-align:right;line-height:1.4;overflow-wrap:anywhere}
.detail{display:block;max-width:100%;margin-top:8rpx;color:#64748b;font-size:23rpx;line-height:1.5;white-space:normal;overflow-wrap:anywhere;word-break:break-word}.actions{display:flex;gap:12rpx}.actions button{flex:1;min-width:0;border:0;border-radius:12rpx;background:#fff0e7;color:#df591b}
.approval-note,.blocked-note{display:block;box-sizing:border-box;max-width:100%;margin-top:12rpx;padding:12rpx 14rpx;border-radius:12rpx;background:#f5f7fb;color:#64748b;font-size:22rpx;line-height:1.5;white-space:normal;overflow-wrap:anywhere;word-break:break-word}.blocked-note{background:#fff4ed;color:#ab4a22}
.role-picker{display:flex;justify-content:space-between;gap:14rpx;margin-top:16rpx;padding:18rpx 16rpx;border:1rpx solid #e4e8ee;border-radius:13rpx;background:#fafbfd;color:#526176;font-size:22rpx}.role-picker text{color:#d45a1d;font-weight:700}
.phone-correction{margin-top:14rpx;padding:14rpx;border-radius:14rpx;background:#fff8f2}.phone-correction .field{box-sizing:border-box;width:100%;background:#fff}.small-action{margin-top:8rpx;border:0;border-radius:12rpx;background:#e85f20;color:#fff;font-size:23rpx}
.permission-warning{margin:14rpx 0;padding:14rpx;border:1rpx solid #f1c27a;border-radius:12rpx;background:#fff8e8;color:#8a4b08;font-size:23rpx;line-height:1.55}
</style>
