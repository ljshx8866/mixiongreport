<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import TimeRangeEditor from '../../components/TimeRangeEditor.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type ShiftTemplate = { id: number; code: string; name: string; startTime: string;
  endTime: string; breakMinutes: number; enabled: boolean; sortOrder: number }
const storeId = ref(0)
const templates = ref<ShiftTemplate[]>([])
const name = ref('')
const startTime = ref('09:00')
const endTime = ref('17:00')
const breakMinutes = ref('0')
const editingId = ref(0)
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const showDisabled = ref(false)
const enabledTemplates = computed(() => templates.value.filter((item) => item.enabled))
const disabledTemplates = computed(() => templates.value.filter((item) => !item.enabled))

onLoad((options) => { storeId.value = Number(options?.storeId || 0) })
onShow(() => { if (storeId.value) void load() })

async function load() {
  loading.value = true; message.value = ''
  try { templates.value = await request<ShiftTemplate[]>(`/api/hr/schedules/shift-templates?storeId=${storeId.value}`) }
  catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}
function reset() {
  editingId.value = 0; name.value = ''; startTime.value = '09:00'; endTime.value = '17:00'; breakMinutes.value = '0'
}
function edit(item: ShiftTemplate) {
  editingId.value = item.id; name.value = item.name; startTime.value = item.startTime
  endTime.value = item.endTime; breakMinutes.value = String(item.breakMinutes)
}
async function save() {
  if (!name.value.trim()) { message.value = '请填写班次名称'; return }
  saving.value = true; message.value = ''
  try {
    const body = { storeId: storeId.value, name: name.value.trim(), startTime: startTime.value,
      endTime: endTime.value, breakMinutes: Number(breakMinutes.value) }
    if (editingId.value) await request(`/api/hr/schedules/shift-templates/${editingId.value}`, 'PATCH', body)
    else await request('/api/hr/schedules/shift-templates', 'POST', body)
    reset(); await load(); message.value = '门店班次已保存'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
async function toggle(item: ShiftTemplate) {
  saving.value = true; message.value = ''
  try {
    await request(`/api/hr/schedules/shift-templates/${item.id}`, 'PATCH', { enabled: !item.enabled })
    await load(); message.value = item.enabled ? '班次已停用，历史排班保留' : '班次已启用'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
function remove(item: ShiftTemplate) {
  uni.showModal({ title: '删除班次',
    content: `确定删除“${item.name}”吗？已用于历史排班的班次不能删除，可以停用保留历史记录。`,
    confirmText: '确认删除', confirmColor: '#c94135',
    success: async (result) => {
      if (!result.confirm) return
      saving.value = true; message.value = ''
      try {
        await request(`/api/hr/schedules/shift-templates/${item.id}`, 'DELETE')
        if (editingId.value === item.id) reset()
        await load(); message.value = '班次已删除'
      } catch (error) {
        if ((error as { statusCode?: number })?.statusCode !== 404) {
          message.value = errorMessage(error)
          return
        }
        // Older API deployments do not have the hard-delete route yet. Fall back
        // to the existing audited disable operation so the shift leaves selection
        // immediately while historical schedules continue to reference it.
        try {
          await request(`/api/hr/schedules/shift-templates/${item.id}`, 'PATCH', { enabled: false })
          if (editingId.value === item.id) reset()
          await load(); message.value = '班次已从可选列表移除，历史排班记录已保留。'
        } catch (fallbackError) { message.value = errorMessage(fallbackError) }
      }
      finally { saving.value = false }
    },
  })
}
</script>

<template>
  <view class="page detail-page shift-page">
    <PageLoading v-if="loading" />
    <view class="page-hero"><view class="store-context-heading"><view class="store-context-title"><text class="eyebrow">班次设置</text><text class="hero-title">门店班次设置</text></view>
      <StoreSelector v-model="storeId" source="hr" :permission="['HR_SHIFT_TEMPLATE_READ','HR_SHIFT_TEMPLATE_EDIT','HR_SHIFT_TEMPLATE_DELETE']" @ready="load" @change="load" /></view>
      <text class="hero-caption">为当前门店维护可选班次，调整模板不会改变已保存的排班记录。</text></view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view class="section-heading"><text class="section-title">{{ editingId ? '编辑班次' : '新增班次' }}</text>
      <text v-if="editingId" class="cancel-edit" @click="reset">取消编辑</text></view>
    <view class="card editor">
      <view class="field"><text>班次名称</text><input v-model="name" maxlength="80" placeholder="例如：早班、午班、晚班" /></view>
      <TimeRangeEditor title="班次时段预览" start-label="开始时间" end-label="结束时间"
        :start="startTime" :end="endTime" @update:start="startTime = $event" @update:end="endTime = $event" />
      <view class="field"><text>休息分钟</text><input v-model="breakMinutes" type="number" /></view>
      <button class="button save-button" :disabled="saving" @click="save">{{ saving ? '保存中…' : editingId ? '保存修改' : '添加班次' }}</button>
    </view>
    <view class="section-heading"><text class="section-title">可用班次</text><text class="section-count">{{ enabledTemplates.length }} 个</text></view>
    <view v-if="!loading && !enabledTemplates.length" class="card empty">当前门店还没有可用班次</view>
    <view v-for="item in enabledTemplates" :key="item.id" class="card shift-row">
      <view class="shift-icon">次</view>
      <view class="shift-info"><view class="shift-name"><text>{{ item.name }}</text>
        <text class="status">启用中</text></view>
        <text class="shift-time">{{ item.startTime }} – {{ item.endTime }}</text>
        <text class="shift-break">休息 {{ item.breakMinutes }} 分钟</text></view>
      <view class="shift-actions"><text @click="edit(item)">编辑</text><text @click="toggle(item)">停用</text>
        <text class="remove" @click="remove(item)">删除</text></view>
    </view>
    <view v-if="disabledTemplates.length" class="section-heading disabled-heading" @click="showDisabled = !showDisabled">
      <text class="section-title">已停用班次</text><text class="section-count">{{ disabledTemplates.length }} 个 · {{ showDisabled ? '收起' : '查看' }}</text>
    </view>
    <template v-if="showDisabled">
      <view v-for="item in disabledTemplates" :key="item.id" class="card shift-row disabled">
        <view class="shift-icon">次</view>
        <view class="shift-info"><view class="shift-name"><text>{{ item.name }}</text><text class="status off">已停用</text></view>
          <text class="shift-time">{{ item.startTime }} – {{ item.endTime }}</text><text class="shift-break">休息 {{ item.breakMinutes }} 分钟</text></view>
        <view class="shift-actions"><text class="enable" @click="toggle(item)">恢复</text><text class="remove" @click="remove(item)">删除</text></view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.shift-page{padding:22rpx 0 70rpx}.page-hero{padding:30rpx;border:1rpx solid #f4e3d9;border-radius:28rpx;background:linear-gradient(135deg,#fff8f2,#fbe8db)}.eyebrow{color:#c96a35;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.hero-title{display:block;margin-top:8rpx;color:#26344b;font-size:40rpx;font-weight:750}.hero-caption{display:block;margin-top:8rpx;color:#876855;font-size:22rpx;line-height:1.5}.notice{margin-top:16rpx;padding:18rpx;color:#a4512a;font-size:22rpx}.section-heading{display:flex;justify-content:space-between;align-items:center;margin:28rpx 4rpx 14rpx}.section-title{color:#26344b;font-size:28rpx;font-weight:700}.section-count,.cancel-edit{color:#d55b25;font-size:21rpx}.editor{padding:22rpx}.field{display:grid;gap:8rpx;margin-bottom:16rpx;color:#7c879a;font-size:21rpx}.field input{height:72rpx;padding:0 18rpx;border:1rpx solid #e6eaf0;border-radius:13rpx;background:#fbfcfe;color:#26344b;font-size:25rpx}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:12rpx;margin-bottom:16rpx}.time-box{display:grid;gap:8rpx;padding:14rpx;border:1rpx solid #e8edf3;border-radius:14rpx;background:#fbfcfe}.time-box text{color:#7c879a;font-size:20rpx}.time-box strong{color:#26344b;font-size:27rpx}.save-button{min-height:76rpx;margin-top:6rpx;background:#e85d21;color:#fff;font-size:25rpx}.empty{color:#8793a4;font-size:23rpx}.shift-row{display:flex;align-items:center;gap:15rpx;margin-bottom:12rpx;padding:20rpx}.shift-row.disabled{opacity:.7}.shift-icon{display:grid;place-items:center;width:62rpx;height:62rpx;border-radius:18rpx;background:#fff0e6;color:#dd591c;font-size:24rpx;font-weight:700}.shift-info{flex:1;min-width:0}.shift-name{display:flex;align-items:center;gap:10rpx;color:#26344b;font-size:26rpx;font-weight:700}.status{padding:4rpx 10rpx;border-radius:999rpx;background:#eaf8f1;color:#178252;font-size:18rpx;font-weight:500}.status.off{background:#f1f3f6;color:#778295}.shift-time{display:block;margin-top:6rpx;color:#df5c21;font-size:24rpx;font-weight:700}.shift-break{display:block;margin-top:4rpx;color:#8a95a6;font-size:20rpx}.shift-actions{display:flex;flex-direction:column;gap:12rpx;color:#d35b24;font-size:21rpx;text-align:right}.shift-actions .enable{color:#27845e}.shift-actions .remove{color:#b63f38}
</style>
