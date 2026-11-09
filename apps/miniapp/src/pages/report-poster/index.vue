<script setup lang="ts">
import { onLoad, onReady, onShareAppMessage } from '@dcloudio/uni-app'
import { nextTick, ref } from 'vue'
import { request } from '../../utils/api'
import { businessDate, currentStoreId, errorMessage } from '../../utils/session'

const report = ref<any>(null)
const date = ref(businessDate())
const message = ref('')
const rendering = ref(false)
const imagePath = ref('')
const canvasHeight = ref(980)
let canvasNode: any
let pageReady = false

const display = (value: number | null | undefined, digits = 0) => value == null ? '—' : Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const amount = (value: number | null | undefined) => display(value, 2)
const quantity = (value: number | null | undefined) => {
  if (value == null) return '—'
  const number = Number(value)
  return Number.isInteger(number) ? display(number) : number.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
const rate = (value: number | null | undefined) => value == null ? '—' : `${(Number(value) * 100).toFixed(1)}%`
const title = () => `米熊（${report.value?.store?.name || '门店'}）${date.value.slice(5).replace('-', '月')}日简报`

onLoad(async (options) => {
  if (typeof options?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.date)) date.value = options.date
  const storeId = Number(options?.storeId) || currentStoreId()
  if (!storeId) { message.value = '请先登录并选择门店'; return }
  try {
    const access = await request<{ stores?: Array<{ id: number; permissionCodes: string[] }> }>('/api/hr/current-access')
    const permissions = access.stores?.find((store) => store.id === storeId)?.permissionCodes ?? []
    const reportPermission = date.value < businessDate() ? 'HR_HISTORY_REPORT_READ' : 'HR_DAILY_REPORT_READ'
    if (!permissions.includes(reportPermission) || !permissions.includes('HR_DAILY_REPORT_POSTER')) {
      message.value = '当前账号没有生成日报图片的权限'
      return
    }
    report.value = await request(`/api/reports/daily/poster?storeId=${storeId}&date=${date.value}`)
    if (pageReady) await renderPoster()
  } catch (error) { message.value = errorMessage(error) }
})

onReady(async () => {
  pageReady = true
  if (report.value) await renderPoster()
})

onShareAppMessage(() => ({
  title: title(),
  path: `/pages/report/index?date=${date.value}&storeId=${report.value?.store?.id || currentStoreId()}`,
}))

function drawText(ctx: any, value: string, x: number, y: number, width: number, size = 22, color = '#1f2937', weight = 'normal') {
  ctx.fillStyle = color
  ctx.font = `${weight} ${size}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = String(value)
  let output = text
  while (ctx.measureText(output).width > width - 14 && output.length > 1) output = `${output.slice(0, -2)}…`
  ctx.fillText(output, x + width / 2, y)
}

function fillCell(ctx: any, x: number, y: number, width: number, height: number, value: string, background = '#ffffff', fontSize = 21, bold = false) {
  ctx.fillStyle = background
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = '#28323b'
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, width, height)
  drawText(ctx, value, x, y + height / 2, width, fontSize, '#17202a', bold ? '600' : 'normal')
}

async function renderPoster() {
  if (!report.value || rendering.value) return
  rendering.value = true
  message.value = ''
  try {
    const categories = report.value.categorySales || []
    const productGroups = report.value.productSales || []
    const periods = report.value.periods || []
    const platforms = report.value.groupBuy?.platforms || []
    const rowH = 48
    const detailRowH = 42
    let productDetailRows = 0
    for (let index = 0; index < productGroups.length; index += 2) {
      const left = productGroups[index]
      const right = productGroups[index + 1]
      productDetailRows += 1 + Math.max(1, left?.items?.length || 0, right?.items?.length || 0)
    }
    const standardRows = 4 + 1 + periods.length + 1 + Math.max(1, platforms.length) + 5 + 1
    const height = Math.max(1040, 170 + standardRows * rowH + productDetailRows * detailRowH + 78)
    canvasHeight.value = height
    // Wait for Vue to apply the new canvas height before requesting its node.
    // Without this, some devices retain the initial 980rpx canvas and crop rows.
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 80))
    await new Promise<void>((resolve, reject) => {
      uni.createSelectorQuery().select('#poster-canvas').fields({ node: true, size: true }).exec((result: any[]) => {
        canvasNode = result?.[0]?.node
        if (canvasNode) resolve(); else reject(new Error('画布初始化失败'))
      })
    })
    const width = 750
    // A long poster can exceed the Mini Program canvas maximum dimension. Keep
    // the whole image in one canvas instead of allowing its lower content to clip.
    const deviceDpr = uni.getSystemInfoSync().pixelRatio || 1
    const dpr = Math.min(deviceDpr, 2, 4096 / Math.max(width, height))
    canvasNode.width = width * dpr
    canvasNode.height = height * dpr
    const ctx = canvasNode.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, 132)
    ctx.fillStyle = '#ed6b2f'
    ctx.fillRect(0, 0, width, 8)
    ctx.font = '600 34px serif'
    ctx.fillStyle = '#101828'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(title(), width / 2, 58)
    ctx.font = '20px sans-serif'
    ctx.fillStyle = '#667085'
    ctx.fillText(`${date.value}  ·  门店经营日报`, width / 2, 96)

    let y = 132
    const x = 28
    const tableW = 694
    // Give the ratio column enough room for its full label while keeping the
    // first category column compact. These widths add up to tableW.
    const summaryColWidths = [110, 130, 130, 130, 194]
    const header = (name: string, color: string) => {
      let cellX = x
      ;[name, '销售额', '入客数', '客单价', '占比（总销售）'].forEach((value, index) => {
        const cellWidth = summaryColWidths[index]
        fillCell(ctx, cellX, y, cellWidth, rowH, value, color, index === 0 ? 22 : 20, true)
        cellX += cellWidth
      })
      y += rowH
    }
    const row = (values: string[], color = '#ffffff') => {
      let cellX = x
      values.forEach((value, index) => {
        const cellWidth = summaryColWidths[index]
        fillCell(ctx, cellX, y, cellWidth, rowH, value, color)
        cellX += cellWidth
      })
      y += rowH
    }
    const grid4 = (values: string[], color = '#ffffff') => {
      const cell = tableW / 4
      values.forEach((value, index) => fillCell(ctx, x + index * cell, y, cell, rowH, value, color))
      y += rowH
    }

    header('销售统计', '#f6b37f')
    row(['总计', amount(report.value.sales?.total?.amount), display(report.value.sales?.total?.customers), amount(report.value.sales?.total?.avgOrderValue), '100.0%'], '#f9c89f')
    row(['堂食', amount(report.value.sales?.dineIn?.amount), display(report.value.sales?.dineIn?.customers), amount(report.value.sales?.dineIn?.avgOrderValue), rate(report.value.sales?.dineIn?.ratio)], '#f9c89f')
    row(['外卖', amount(report.value.sales?.delivery?.amount), display(report.value.sales?.delivery?.customers), amount(report.value.sales?.delivery?.avgOrderValue), rate(report.value.sales?.delivery?.ratio)], '#f9c89f')

    header('时段统计', '#ffe06b')
    periods.forEach((item: any) => row([item.name || '—', amount(item.amount), display(item.customers), amount(item.avgOrderValue), rate(item.ratio)], '#ffea95'))

    header('团购统计', '#f6b37f')
    if (!platforms.length) row(['暂无团购数据', '—', '—', '—', '—'], '#f9c89f')
    platforms.forEach((item: any) => row([item.name || '其他', amount(item.amount), display(item.customers), amount(item.avgOrderValue), rate(item.ratio)], '#f9c89f'))

    fillCell(ctx, x, y, tableW, rowH, '能耗效率', '#ffe06b', 22, true)
    y += rowH
    grid4(['用电度数', display(report.value.energy?.totalPower, 2), '电效率', display(report.value.energy?.powerEfficiency, 2)], '#ffea95')
    grid4(['厨房用电', display(report.value.energy?.kitchenPower, 2), '餐区用电', display(report.value.energy?.diningPower, 2)], '#ffea95')
    grid4(['用水吨数', display(report.value.energy?.waterUsage, 2), '水效率', display(report.value.energy?.waterEfficiency, 2)], '#ffea95')
    fillCell(ctx, x, y, tableW, rowH, '工时效率', '#ffe06b', 22, true)
    y += rowH
    grid4(['工时数量', display(report.value.labor?.hours, 2), '工时收入', display(report.value.labor?.salesPerHour, 2)], '#ffea95')

    fillCell(ctx, x, y, tableW, rowH, '菜品销售明细', '#7bd1ca', 23, true)
    y += rowH
    const categoryQuantity = (group: any) => {
      const category = categories.find((item: any) => item.categoryId === group.categoryId)
      return category?.quantity ?? (group.items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0)
    }
    if (!productGroups.length) {
      fillCell(ctx, x, y, tableW, detailRowH, '暂无菜品销售明细', '#e2f5f2', 20)
      y += detailRowH
    }
    for (let groupIndex = 0; groupIndex < productGroups.length; groupIndex += 2) {
      const left = productGroups[groupIndex]
      const right = productGroups[groupIndex + 1]
      const halfWidth = tableW / 2
      const categoryHeader = (group: any, startX: number) => {
        fillCell(ctx, startX, y, halfWidth * 0.64, detailRowH, group?.categoryName || '', '#9fdfdc', 20, true)
        fillCell(ctx, startX + halfWidth * 0.64, y, halfWidth * 0.36, detailRowH, group ? `销量 ${quantity(categoryQuantity(group))}` : '', '#9fdfdc', 17, true)
      }
      categoryHeader(left, x)
      categoryHeader(right, x + halfWidth)
      y += detailRowH
      const productCell = (item: any, startX: number) => {
        const rankWidth = 44
        const quantityWidth = 76
        const nameWidth = halfWidth - rankWidth - quantityWidth
        fillCell(ctx, startX, y, rankWidth, detailRowH, item ? String(item.rank ?? '—') : '', '#e2f5f2', 17)
        fillCell(ctx, startX + rankWidth, y, nameWidth, detailRowH, item?.productName || '', '#e2f5f2', 18)
        fillCell(ctx, startX + rankWidth + nameWidth, y, quantityWidth, detailRowH, item ? quantity(item.quantity) : '', '#e2f5f2', 18, true)
      }
      const rowCount = Math.max(1, left?.items?.length || 0, right?.items?.length || 0)
      for (let itemIndex = 0; itemIndex < rowCount; itemIndex++) {
        productCell(left?.items?.[itemIndex], x)
        productCell(right?.items?.[itemIndex], x + halfWidth)
        y += detailRowH
      }
    }

    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, y, width, height - y)
    ctx.font = '18px sans-serif'
    ctx.fillStyle = '#667085'
    ctx.textAlign = 'center'
    ctx.fillText('米熊 · 连锁餐饮门店每日经营数据平台', width / 2, y + 42)

    const exported = await new Promise<string>((resolve, reject) => {
      uni.canvasToTempFilePath({ canvas: canvasNode, x: 0, y: 0, width, height, destWidth: Math.round(width * dpr), destHeight: Math.round(height * dpr), fileType: 'png', quality: 1, success: result => resolve(result.tempFilePath), fail: reject })
    })
    imagePath.value = exported
  } catch (error) { message.value = errorMessage(error) } finally { rendering.value = false }
}

function shareImage() {
  if (!imagePath.value) { message.value = '图片尚未生成完成'; return }
  const showMenu = (uni as any).showShareImageMenu
  if (typeof showMenu === 'function') {
    showMenu({ path: imagePath.value, fail: () => uni.previewImage({ urls: [imagePath.value] }) })
  } else uni.previewImage({ urls: [imagePath.value] })
}

function saveImage() {
  if (!imagePath.value) { message.value = '图片尚未生成完成'; return }
  uni.saveImageToPhotosAlbum({ path: imagePath.value, success: () => uni.showToast({ title: '已保存到相册' }), fail: () => { message.value = '保存失败，请在预览图片后长按保存' } })
}
</script>

<template>
  <view class="page poster-page">
    <view class="poster-top">
      <view><text class="poster-title">经营日报简报</text><text class="poster-subtitle">生成图片后发送给门店群或区域负责人</text></view>
      <view class="date-tag">{{ date.slice(5) }}</view>
    </view>
    <view v-if="message" class="message">{{ message }}</view>
    <view class="canvas-card"><canvas id="poster-canvas" type="2d" class="poster-canvas" :style="{ height: `${canvasHeight}rpx` }" /></view>
    <view class="tips">图片内容使用当前日报数据生成</view>
    <view class="actions"><button class="secondary" :disabled="rendering || !imagePath" @click="saveImage">保存图片</button><button class="primary" :disabled="rendering || !imagePath" @click="shareImage">{{ rendering ? '正在生成…' : '转发图片' }}</button></view>
  </view>
</template>

<style scoped>
.poster-page{padding-top:28rpx;padding-bottom:42rpx}.poster-top{display:flex;align-items:center;justify-content:space-between;margin:0 2rpx 20rpx}.poster-title{display:block;color:#1d2939;font-size:34rpx;font-weight:700}.poster-subtitle{display:block;margin-top:7rpx;color:#7b879b;font-size:21rpx}.date-tag{padding:10rpx 16rpx;border-radius:14rpx;background:#fff0e7;color:#dd5618;font-size:23rpx;font-weight:700}.canvas-card{overflow:hidden;border-radius:18rpx;background:#fff;box-shadow:0 12rpx 30rpx rgba(45,55,72,.12)}.poster-canvas{display:block;width:750rpx;background:#fff}.message{margin-bottom:16rpx;padding:16rpx 18rpx;border-radius:14rpx;background:#fff1ef;color:#bc3327;font-size:23rpx}.tips{padding:17rpx 0;color:#8792a6;text-align:center;font-size:21rpx}.actions{display:flex;gap:18rpx}.actions button{flex:1;margin:0;border-radius:16rpx;font-size:27rpx;line-height:82rpx}.secondary{border:1rpx solid #e9a783;background:#fff;color:#d45519}.primary{border:0;background:#ed5a18;color:#fff}.primary[disabled],.secondary[disabled]{opacity:.55}
</style>
