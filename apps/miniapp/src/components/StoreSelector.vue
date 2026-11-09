<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { request } from '../utils/api'
import { currentStoreId } from '../utils/session'

type Store = { id: number; storeName: string; permissionCodes?: string[] }
const props = withDefaults(defineProps<{
  modelValue: number | null
  source?: 'user' | 'hr'
  permission?: string | string[]
}>(), { source: 'hr' })
const emit = defineEmits<{
  'update:modelValue': [storeId: number]
  change: [storeId: number]
  ready: [storeId: number]
}>()
const stores = ref<Store[]>([])
const loading = ref(true)
const error = ref('')
const canShowSwitcher = ref(false)
const selectedStore = ref<Store | null>(null)

async function loadStores() {
  loading.value = true; error.value = ''
  try {
    const access = await request<{ stores?: Store[]; canConfigure?: boolean; showStoreSwitcher?: boolean }>('/api/hr/current-access')
    canShowSwitcher.value = Boolean(access.showStoreSwitcher)
    let values: Store[]
    if (props.source === 'hr') {
      values = access.stores ?? []
    } else values = await request<Store[]>('/api/auth/stores')
    const required = props.permission == null ? [] : Array.isArray(props.permission) ? props.permission : [props.permission]
    stores.value = values.filter((store) => !required.length || required.some((code) => store.permissionCodes?.includes(code)))
    const preferred = currentStoreId()
    selectedStore.value = stores.value.find((store) => store.id === props.modelValue)
      ?? stores.value.find((store) => store.id === preferred) ?? stores.value[0] ?? null
    if (selectedStore.value) {
      emit('update:modelValue', selectedStore.value.id)
      emit('ready', selectedStore.value.id)
    }
  } catch {
    error.value = '门店列表读取失败，请返回重试'
    stores.value = []
  } finally { loading.value = false }
}

function changeStore(event: { detail: { value: string } }) {
  const store = stores.value[Number(event.detail.value)]
  if (!store || store.id === selectedStore.value?.id) return
  selectedStore.value = store
  uni.setStorageSync('storeId', store.id)
  emit('update:modelValue', store.id)
  emit('change', store.id)
}

onMounted(loadStores)
</script>

<template>
  <picker v-if="canShowSwitcher && stores.length > 1" mode="selector" :range="stores" range-key="storeName" @change="changeStore">
    <view class="store-selector" :class="{ loading, error }">
      <text class="store-selector-value">{{ selectedStore?.storeName || (loading ? '正在读取…' : error || '选择门店') }}</text>
      <text class="store-selector-arrow">⌄</text>
    </view>
  </picker>
</template>

<style scoped>
.store-selector{display:flex;align-items:center;justify-content:flex-end;gap:8rpx;max-width:230rpx;min-height:48rpx;padding:4rpx 12rpx;border-radius:999rpx;background:rgba(255,255,255,.78);color:#536176}.store-selector-value{overflow:hidden;color:inherit;font-size:21rpx;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.store-selector-arrow{flex:none;color:#8793a5;font-size:23rpx;line-height:1}.store-selector.loading,.store-selector.error{color:#a25c35}
</style>
