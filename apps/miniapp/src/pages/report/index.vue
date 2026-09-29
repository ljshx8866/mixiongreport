<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { request } from '../../utils/api'
import { businessDate, currentStoreId, errorMessage } from '../../utils/session'

const report = ref<any>(null)
const message = ref('')
const date = ref(businessDate())
const show = (value: number | null | undefined) => value == null ? '—' : String(value)
const percent = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`

onLoad(async (options) => {
  if (typeof options?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.date)) date.value = options.date
  const storeId = currentStoreId()
  if (!storeId) { message.value = '请先在“我的”页面登录并选择门店'; return }
  try { report.value = await request(`/api/reports/daily?storeId=${storeId}&date=${date.value}`) }
  catch (error) { message.value = errorMessage(error) }
})
</script>

<template>
  <view v-if="message" class="card">{{ message }}</view>
  <template v-if="report">
    <view class="card"><text class="label">{{ report.title }}</text><text v-if="!report.status.complete" class="label">日报数据尚未完整</text></view>
    <view class="card"><text class="label">经营概览</text><text class="value">¥{{ show(report.sales?.total?.amount) }}</text><text>入客 {{ show(report.sales?.total?.customers) }} · 客单价 {{ show(report.sales?.total?.avgOrderValue) }}</text></view>
    <view class="card"><text class="label">销售渠道</text><view v-for="item in [{ name: '堂食', data: report.sales?.dineIn }, { name: '外卖', data: report.sales?.delivery }]" :key="item.name" class="row"><text>{{ item.name }}</text><text>¥{{ show(item.data?.amount) }} · {{ show(item.data?.customers) }} 人 · 客单 {{ show(item.data?.avgOrderValue) }} · {{ percent(item.data?.ratio) }}</text></view></view>
    <view class="card"><text class="label">营业时段</text><view v-for="item in report.periods" :key="item.code" class="row"><text>{{ item.name }}</text><text>¥{{ show(item.amount) }} · {{ show(item.customers) }} 人 · 客单 {{ show(item.avgOrderValue) }} · {{ percent(item.ratio) }}</text></view></view>
    <view class="card"><text class="label">团购统计</text><view class="row"><text>合计</text><text>¥{{ show(report.groupBuy.total.amount) }} · {{ show(report.groupBuy.total.customers) }} 人 · 客单 {{ show(report.groupBuy.total.avgOrderValue) }}</text></view><view v-for="item in report.groupBuy.platforms" :key="item.code" class="row"><text>{{ item.name }}</text><text>¥{{ show(item.amount) }} · {{ show(item.customers) }} 人 · 客单 {{ show(item.avgOrderValue) }}</text></view></view>
    <view class="card"><text class="label">毛利情况</text><view v-for="item in [{name:'理论毛利率',value:report.grossMargin.theoreticalRate},{name:'总毛利率',value:report.grossMargin.totalRate},{name:'堂食毛利率',value:report.grossMargin.dineInRate},{name:'外卖毛利率',value:report.grossMargin.deliveryRate}]" :key="item.name" class="row"><text>{{ item.name }}</text><text>{{ percent(item.value) }}</text></view></view>
    <view class="card"><text class="label">能源效率</text><view v-for="item in [{name:'总用电',value:report.energy.totalPower},{name:'厨房用电',value:report.energy.kitchenPower},{name:'餐区用电',value:report.energy.diningPower},{name:'24 小时用电',value:report.energy.fullDayPower},{name:'空调用电',value:report.energy.airConditionPower},{name:'电效率',value:report.energy.powerEfficiency},{name:'用水吨数',value:report.energy.waterUsage},{name:'水效率',value:report.energy.waterEfficiency}]" :key="item.name" class="row"><text>{{ item.name }}</text><text>{{ show(item.value) }}</text></view></view>
    <view class="card"><text class="label">人工效率</text><view class="row"><text>总工时</text><text>{{ show(report.labor.hours) }}</text></view><view class="row"><text>工时收入</text><text>{{ show(report.labor.salesPerHour) }}</text></view></view>
    <view class="card"><text class="label">菜品结构</text><view v-for="item in report.categorySales" :key="item.categoryId" class="row"><text>{{ item.categoryName }}</text><text>{{ item.quantity }}</text></view></view>
    <view class="card"><text class="label">运营指标</text><view v-for="item in [{name:'加点人数',value:report.operations.addonCustomers},{name:'千人加点',value:report.operations.addonPerThousand},{name:'套餐人数',value:report.operations.comboCustomers},{name:'千人套餐',value:report.operations.comboPerThousand}]" :key="item.name" class="row"><text>{{ item.name }}</text><text>{{ show(item.value) }}</text></view></view>
    <view class="card"><text class="label">菜品销售明细</text><view v-for="category in report.productSales" :key="category.categoryId"><text class="section">{{ category.categoryName }}</text><view v-for="item in category.items" :key="item.productId" class="row"><text>{{ item.rank }}. {{ item.productName }}</text><text>{{ item.quantity }}</text></view></view></view>
  </template>
</template>

<style scoped>.row{display:flex;justify-content:space-between;gap:20rpx;padding:14rpx 0;border-bottom:1rpx solid #f1f5f9;font-size:26rpx}.row text:last-child{text-align:right}.section{display:block;font-weight:700;margin-top:28rpx}</style>
