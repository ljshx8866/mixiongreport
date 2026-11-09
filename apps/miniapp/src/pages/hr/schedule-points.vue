<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PageLoading from '../../components/PageLoading.vue'
import StoreSelector from '../../components/StoreSelector.vue'
import { request } from '../../utils/api'
import { errorMessage } from '../../utils/session'

type SchedulePoint = { id: number; name: string; sortOrder: number; enabled: boolean }
const storeId = ref(0)
const points = ref<SchedulePoint[]>([])
const name = ref('')
const sortOrder = ref('0')
const editingId = ref(0)
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const showDisabled = ref(false)
const enabledPoints = computed(() => points.value.filter((item) => item.enabled))
const disabledPoints = computed(() => points.value.filter((item) => !item.enabled))

onLoad((options) => { storeId.value = Number(options?.storeId || 0) })
onShow(() => { if (storeId.value) void load() })

async function load() {
  loading.value = true; message.value = ''
  try { points.value = await request<SchedulePoint[]>(`/api/hr/schedules/points?storeId=${storeId.value}`) }
  catch (error) { message.value = errorMessage(error) }
  finally { loading.value = false }
}
function reset() { editingId.value = 0; name.value = ''; sortOrder.value = '0' }
function edit(item: SchedulePoint) {
  editingId.value = item.id; name.value = item.name; sortOrder.value = String(item.sortOrder)
}
async function save() {
  const cleanName = name.value.trim()
  if (!cleanName) { message.value = '请填写点位名称'; return }
  saving.value = true; message.value = ''
  try {
    const body = { storeId: storeId.value, name: cleanName, sortOrder: Number(sortOrder.value) }
    if (editingId.value) await request(`/api/hr/schedules/points/${editingId.value}`, 'PATCH', body)
    else await request('/api/hr/schedules/points', 'POST', body)
    reset(); await load(); message.value = '点位设置已保存'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
async function toggle(item: SchedulePoint) {
  saving.value = true; message.value = ''
  try {
    await request(`/api/hr/schedules/points/${item.id}`, 'PATCH', { enabled: !item.enabled })
    await load(); message.value = item.enabled ? '点位已停用，历史排班记录保留' : '点位已启用'
  } catch (error) { message.value = errorMessage(error) }
  finally { saving.value = false }
}
function remove(item: SchedulePoint) {
  uni.showModal({ title: '删除排班点位', content: `确定删除“${item.name}”吗？历史排班会保留点位名称。`,
    confirmText: '确认删除', confirmColor: '#c94135', success: async (result) => {
      if (!result.confirm) return
      saving.value = true; message.value = ''
      try {
        await request(`/api/hr/schedules/points/${item.id}`, 'DELETE')
        if (editingId.value === item.id) reset()
        await load(); message.value = '点位已删除'
      } catch (error) { message.value = errorMessage(error) }
      finally { saving.value = false }
    },
  })
}
</script>

<template>
  <view class="page detail-page point-page">
    <PageLoading v-if="loading" />
    <view class="page-hero"><view class="store-context-heading"><view class="store-context-title"><text class="eyebrow">排班管理</text><text class="hero-title">门店点位设置</text></view>
      <StoreSelector v-model="storeId" source="hr" :permission="['HR_SCHEDULE_POINT_READ','HR_SCHEDULE_POINT_EDIT','HR_SCHEDULE_POINT_DELETE']" @ready="load" @change="load" /></view>
      <text class="hero-caption">设置门店员工排班时可选择的工作点位。历史排班会保留当时的点位名称。</text></view>
    <view v-if="message" class="card notice">{{ message }}</view>
    <view class="section-heading"><text class="section-title">{{ editingId ? '编辑点位' : '新增点位' }}</text>
      <text v-if="editingId" class="cancel-edit" @click="reset">取消编辑</text></view>
    <view class="card editor">
      <view class="field"><text>点位名称</text><input v-model="name" maxlength="80" placeholder="例如：前厅、收银台、厨房" /></view>
      <view class="field"><text>显示顺序</text><input v-model="sortOrder" type="number" /></view>
      <button class="button save-button" :disabled="saving" @click="save">{{ saving ? '保存中…' : editingId ? '保存修改' : '添加点位' }}</button>
    </view>
    <view class="section-heading"><text class="section-title">可用点位</text><text class="section-count">{{ enabledPoints.length }} 个</text></view>
    <view v-if="!loading && !enabledPoints.length" class="card empty">当前门店还没有可用点位。</view>
    <view v-for="item in enabledPoints" :key="item.id" class="card point-row">
      <view class="point-icon">位</view><view class="point-info"><text class="point-name">{{ item.name }}</text><text class="point-order">显示顺序 {{ item.sortOrder }}</text></view>
      <view class="point-actions"><text @click="edit(item)">编辑</text><text @click="toggle(item)">停用</text><text class="remove" @click="remove(item)">删除</text></view>
    </view>
    <view v-if="disabledPoints.length" class="section-heading disabled-heading" @click="showDisabled = !showDisabled">
      <text class="section-title">已停用点位</text><text class="section-count">{{ disabledPoints.length }} 个 · {{ showDisabled ? '收起' : '查看' }}</text>
    </view>
    <template v-if="showDisabled"><view v-for="item in disabledPoints" :key="item.id" class="card point-row disabled">
      <view class="point-icon">位</view><view class="point-info"><text class="point-name">{{ item.name }}</text><text class="point-order">显示顺序 {{ item.sortOrder }}</text></view>
      <view class="point-actions"><text @click="edit(item)">编辑</text><text class="enable" @click="toggle(item)">恢复</text><text class="remove" @click="remove(item)">删除</text></view>
    </view></template>
  </view>
</template>

<style scoped>
.point-page{padding:22rpx 0 70rpx}.page-hero{padding:30rpx;border:1rpx solid #f4e3d9;border-radius:28rpx;background:linear-gradient(135deg,#fff8f2,#fbe8db)}.eyebrow{color:#c96a35;font-size:19rpx;font-weight:700;letter-spacing:2rpx}.hero-title{display:block;margin-top:8rpx;color:#26344b;font-size:40rpx;font-weight:750}.hero-caption{display:block;margin-top:8rpx;color:#876855;font-size:22rpx;line-height:1.5}.notice{margin-top:16rpx;padding:18rpx;color:#a4512a;font-size:22rpx}.section-heading{display:flex;justify-content:space-between;align-items:center;margin:28rpx 4rpx 14rpx}.section-title{color:#26344b;font-size:28rpx;font-weight:700}.section-count,.cancel-edit{color:#d55b25;font-size:21rpx}.editor{padding:22rpx}.field{display:grid;gap:8rpx;margin-bottom:16rpx;color:#7c879a;font-size:21rpx}.field input{height:72rpx;padding:0 18rpx;border:1rpx solid #e6eaf0;border-radius:13rpx;background:#fbfcfe;color:#26344b;font-size:25rpx}.save-button{min-height:76rpx;margin-top:6rpx;background:#e85d21;color:#fff;font-size:25rpx}.empty{padding:22rpx;color:#8793a4;font-size:23rpx}.point-row{display:flex;align-items:center;gap:15rpx;margin-bottom:12rpx;padding:20rpx}.point-row.disabled{opacity:.7}.point-icon{display:grid;place-items:center;width:62rpx;height:62rpx;border-radius:18rpx;background:#fff0e6;color:#dd591c;font-size:24rpx;font-weight:700}.point-info{flex:1;min-width:0}.point-name{display:block;color:#26344b;font-size:26rpx;font-weight:700}.point-order{display:block;margin-top:6rpx;color:#8a95a6;font-size:20rpx}.point-actions{display:flex;flex-direction:column;gap:12rpx;color:#d35b24;font-size:21rpx;text-align:right}.point-actions .remove{color:#b63f38}.point-actions .enable{color:#27845e}
</style>
