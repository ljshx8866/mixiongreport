<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { reactive, ref } from 'vue'
import { request } from '../../utils/api'
import { currentStoreId, errorMessage } from '../../utils/session'
import { ensureWechatLogin, loginWithWechat } from '../../utils/wechat'

const form = reactive({ mobile: '', password: '' })
const message = ref('')
const user = ref<any>(uni.getStorageSync('user') || null)
const stores = ref<Array<{ id: number; storeName: string }>>([])
const selectedStore = ref(currentStoreId())

async function loadStores() {
  if (!user.value) return
  try {
    stores.value = await request('/api/auth/stores')
    if (!selectedStore.value && stores.value.length === 1) selectStore(stores.value[0].id)
  } catch (error) { message.value = errorMessage(error) }
}
onShow(async () => {
  if (!uni.getStorageSync('accessToken')) { try { await ensureWechatLogin() } catch {} }
  user.value = uni.getStorageSync('user') || null
  selectedStore.value = currentStoreId()
  await loadStores()
})
async function bind() {
  message.value = ''
  try { await loginWithWechat(form); user.value = uni.getStorageSync('user'); await loadStores(); uni.showToast({ title: '绑定成功' }) }
  catch (error) { message.value = errorMessage(error) }
}
function selectStore(storeId: number) { uni.setStorageSync('storeId', storeId); selectedStore.value = storeId }
function logout() { for (const key of ['accessToken', 'user', 'storeId']) uni.removeStorageSync(key); user.value = null; selectedStore.value = null; stores.value = [] }
</script>

<template>
  <view v-if="user" class="card">
    <text class="label">我的账号</text><text class="value">{{ user.role }}</text>
    <text class="label">当前门店：{{ stores.find((store) => store.id === selectedStore)?.storeName || '请选择门店' }}</text>
    <view v-for="store in stores" :key="store.id" class="store" @click="selectStore(store.id)">{{ store.storeName }}{{ selectedStore === store.id ? ' ✓' : '' }}</view>
    <text v-if="message" style="color:#dc2626">{{ message }}</text>
    <view class="button" style="margin-top:24rpx" @click="logout">退出登录</view>
  </view>
  <view v-else class="card">
    <text class="value">绑定门店账号</text><text class="label">首次微信登录，请验证已由总部创建的账号。</text>
    <view class="field"><text>手机号</text><input v-model="form.mobile" type="number" /></view>
    <view class="field"><text>密码</text><input v-model="form.password" password /></view>
    <text v-if="message" style="color:#dc2626">{{ message }}</text>
    <view class="button" @click="bind">绑定并登录</view>
  </view>
</template>

<style scoped>.store{padding:18rpx 0;border-bottom:1rpx solid #e2e8f0}</style>
