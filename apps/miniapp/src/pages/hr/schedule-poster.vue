<script setup lang="ts">
import { onLoad, onReady, onShareAppMessage } from '@dcloudio/uni-app'
import { computed, nextTick, ref, watch } from 'vue'
import { request } from '../../utils/api'
import { chinaClockMinutes, formatChinaClock } from '../../utils/china-time'
import { errorMessage } from '../../utils/session'

type Schedule = { id: number; employeeId: number; employeeName: string; status: string;
  shiftTemplateName: string | null; pointId: number | null; pointName: string | null;
  plannedStart: string | null; plannedEnd: string | null; breakMinutes: number | null; scheduleOnly?: boolean }
type EmployeeGroup = { employeeId: number; employeeName: string; pointName: string; shifts: Schedule[] }
type StoreAccess = { id: number; storeName: string }
const storeId = ref(0)
const date = ref('')
const storeName = ref('门店')
const groups = ref<EmployeeGroup[]>([])
const currentPage = ref(0)
const loading = ref(true)
const rendering = ref(false)
const imagePath = ref('')
const message = ref('')
const canvasHeight = ref(2200)
const rowsPerImage = 22
let canvasNode: any
let pageReady = false

const pageCount = computed(() => Math.max(1, Math.ceil(groups.value.length / rowsPerImage)))
const pageGroups = computed(() => groups.value.slice(currentPage.value * rowsPerImage, (currentPage.value + 1) * rowsPerImage))
const pageCaption = computed(() => `第 ${currentPage.value + 1} 张 / 共 ${pageCount.value} 张`)
function shiftWorkMinutes(shift: Schedule) {
  if (!shift.plannedStart || !shift.plannedEnd) return 0
  const elapsed = Math.floor((new Date(shift.plannedEnd).getTime() - new Date(shift.plannedStart).getTime()) / 60000)
  return Math.max(0, elapsed - (shift.breakMinutes ?? 0))
}
function theoreticalMinutes(group: EmployeeGroup) {
  return group.shifts.filter((shift) => !shift.scheduleOnly).reduce((total, shift) => total + shiftWorkMinutes(shift), 0)
}
const totalScheduledMinutes = computed(() => groups.value.reduce((total, group) => total + theoreticalMinutes(group), 0))
function hoursLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`
}
const pagePath = () => `/pages/hr/schedule-poster?storeId=${storeId.value}&date=${date.value}`

onLoad(async (options) => {
  storeId.value = Number(options?.storeId || 0)
  if (typeof options?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.date)) date.value = options.date
  if (!storeId.value || !date.value) {
    message.value = '排班门店或日期无效，请返回排班页面重新打开。'
    loading.value = false
    return
  }
  try {
    const [access, schedules] = await Promise.all([
      request<{ stores: StoreAccess[] }>('/api/hr/current-access'),
      request<Schedule[]>(`/api/hr/schedules?storeId=${storeId.value}&date=${date.value}`),
    ])
    storeName.value = access.stores.find((item) => item.id === storeId.value)?.storeName || '门店'
    const byEmployee = new Map<number, EmployeeGroup>()
    for (const shift of schedules.filter((item) => item.status === 'PUBLISHED')) {
      let group = byEmployee.get(shift.employeeId)
      if (!group) {
        group = { employeeId: shift.employeeId, employeeName: shift.employeeName, pointName: '', shifts: [] }
        byEmployee.set(shift.employeeId, group)
      }
      group.shifts.push(shift)
    }
    for (const group of byEmployee.values()) {
      const names = [...new Set(group.shifts.map((item) => item.pointName).filter((item): item is string => !!item))]
      group.pointName = names.length === 1 ? names[0] : names.length > 1 ? '多个点位' : '未设置点位'
    }
    groups.value = Array.from(byEmployee.values())
    if (!groups.value.length) message.value = '所选日期还没有已发布的排班。'
  } catch (error) { message.value = errorMessage(error) }
  finally {
    loading.value = false
    if (pageReady && groups.value.length) {
      await nextTick()
      await renderPoster()
    }
  }
})

onReady(async () => {
  pageReady = true
  if (!loading.value && groups.value.length) await renderPoster()
})

watch(currentPage, async () => {
  imagePath.value = ''
  if (pageReady && groups.value.length) await renderPoster()
})

onShareAppMessage(() => ({
  title: `${storeName.value}${date.value}排班表`,
  path: pagePath(),
}))

function clock(value: string | null) {
  if (!value) return '—'
  return formatChinaClock(value)
}

function clockMinutes(value: string | null) {
  return chinaClockMinutes(value)
}

function employeeColor(index: number) {
  // Use hex colors because some WeChat/Harmony canvas implementations do not
  // consistently render HSL color strings.
  const palette = [
    { fill: '#B42318', soft: '#FEE4E2' },
    { fill: '#B54708', soft: '#FEF0C7' },
    { fill: '#027A48', soft: '#D1FADF' },
    { fill: '#026AA2', soft: '#D1E9FF' },
    { fill: '#3538CD', soft: '#E0E7FF' },
    { fill: '#5925DC', soft: '#E9D7FE' },
    { fill: '#C11574', soft: '#FCE7F6' },
    { fill: '#C01048', soft: '#FFE4E8' },
    { fill: '#344054', soft: '#EAECF0' },
    { fill: '#854A0E', soft: '#FDF2D0' },
    { fill: '#0E9384', soft: '#CCFBF1' },
    { fill: '#B93815', soft: '#FFEAD5' },
    { fill: '#3E4784', soft: '#E0E7FF' },
    { fill: '#6941C6', soft: '#E9D7FE' },
    { fill: '#175CD3', soft: '#D1E9FF' },
    { fill: '#067647', soft: '#D1FADF' },
  ]
  return { ...palette[index % palette.length], text: '#ffffff' }
}

function drawText(ctx: any, value: string, x: number, y: number, width: number, size: number, color: string, weight = 'normal') {
  ctx.fillStyle = color
  ctx.font = `${weight} ${size}px sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let output = value
  while (ctx.measureText(output).width > width && output.length > 2) output = `${output.slice(0, -2)}…`
  ctx.fillText(output, x, y)
}

async function renderPoster() {
  if (rendering.value || loading.value || !groups.value.length) return
  rendering.value = true
  message.value = ''
  try {
    const width = 750
    const headerHeight = 232
    const tableHeaderHeight = 64
    const footerHeight = 94
    const left = 28
    const nameWidth = 156
    const pointWidth = 102
    const timelineOffset = nameWidth + pointWidth
    const timelineWidth = width - left * 2 - timelineOffset
    const rows = pageGroups.value.map((group) => {
      const shifts = group.shifts.map((shift) => ({
        shift,
        start: clockMinutes(shift.plannedStart),
        end: clockMinutes(shift.plannedEnd),
      })).filter((item): item is { shift: Schedule; start: number; end: number } =>
        item.start !== null && item.end !== null && item.end > item.start)
        .sort((a, b) => a.start - b.start)
      const laneEnds: number[] = []
      const placed = shifts.map((item) => {
        let lane = laneEnds.findIndex((end) => end <= item.start)
        if (lane < 0) lane = laneEnds.length
        laneEnds[lane] = item.end
        return { ...item, lane }
      })
      return { group, shifts: placed, laneCount: Math.max(1, laneEnds.length), height: Math.max(48, laneEnds.length * 24 + 12) }
    })
    const scheduleTimes = rows.flatMap((row) => row.shifts.flatMap((item) => [item.start, item.end]))
    const timelineStart = scheduleTimes.length ? Math.floor(Math.min(...scheduleTimes) / 60) * 60 : 8 * 60
    const timelineEnd = scheduleTimes.length ? Math.min(24 * 60, Math.ceil(Math.max(...scheduleTimes) / 60) * 60) : 20 * 60
    const timelineMinutes = Math.max(60, timelineEnd - timelineStart)
    const totalRowsHeight = rows.reduce((sum, row) => sum + row.height, 0)
    const height = headerHeight + tableHeaderHeight + totalRowsHeight + footerHeight
    canvasHeight.value = height
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 80))
    await new Promise<void>((resolve, reject) => {
      uni.createSelectorQuery().select('#schedule-poster-canvas').fields({ node: true, size: true }).exec((result: any[]) => {
        canvasNode = result?.[0]?.node
        if (canvasNode) resolve()
        else reject(new Error('图片画布未能初始化，请返回重试。'))
      })
    })

    const deviceDpr = uni.getSystemInfoSync().pixelRatio || 1
    const dpr = Math.min(deviceDpr, 2, 4096 / Math.max(width, height))
    canvasNode.width = Math.round(width * dpr)
    canvasNode.height = Math.round(height * dpr)
    const ctx = canvasNode.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#f5f7fb'
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = '#e85d21'
    ctx.fillRect(0, 0, width, 10)
    drawText(ctx, `${storeName.value} · 排班表`, 34, 62, width - 68, 36, '#26344b', '600')
    drawText(ctx, `${date.value}  ·  已发布 ${groups.value.reduce((sum, item) => sum + item.shifts.length, 0)} 个班次`,
      36, 112, width - 72, 22, '#738096')
    drawText(ctx, `理论出勤工时 ${hoursLabel(totalScheduledMinutes.value)}（不含仅排班岗位）`,
      36, 144, width - 72, 20, '#53647b')
    drawText(ctx, pageCaption.value, 36, 174, width - 72, 18, '#a0a9b7')

    const legendY = 208
    for (let index = 0; index < 3; index++) {
      ctx.fillStyle = employeeColor(index).fill
      ctx.fillRect(left + index * 22, legendY - 8, 16, 16)
    }
    drawText(ctx, '每位员工使用不同颜色，同一员工的所有班次保持同色', left + 76, legendY,
      width - left * 2 - 76, 16, '#66758b')

    let y = headerHeight
    ctx.fillStyle = '#25354d'
    ctx.fillRect(left, y, width - left * 2, tableHeaderHeight)
    drawText(ctx, '员工', left + 14, y + tableHeaderHeight / 2, nameWidth - 24, 19, '#ffffff', '600')
    drawText(ctx, '点位', left + nameWidth + 12, y + tableHeaderHeight / 2, pointWidth - 20, 18, '#ffffff', '600')
    const tickHours = Math.max(1, Math.ceil(timelineMinutes / 60 / 6))
    for (let minute = timelineStart; minute <= timelineEnd; minute += tickHours * 60) {
      const x = left + timelineOffset + ((minute - timelineStart) / timelineMinutes) * timelineWidth
      drawText(ctx, `${String(Math.floor(minute / 60)).padStart(2, '0')}:00`, x - 19, y + tableHeaderHeight / 2,
        48, 14, '#ffffff')
    }
    y += tableHeaderHeight

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const group = row.group
      const rowTop = y
      const rowHeight = row.height
      const colors = employeeColor(index)
      ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#edf1f6'
      ctx.fillRect(left, rowTop, width - left * 2, rowHeight)
      ctx.fillStyle = colors.soft
      ctx.fillRect(left, rowTop, nameWidth, rowHeight)
      ctx.fillStyle = colors.fill
      ctx.fillRect(left, rowTop, 6, rowHeight)
      ctx.fillStyle = '#f7f9fc'
      ctx.fillRect(left + nameWidth, rowTop, pointWidth, rowHeight)
      ctx.strokeStyle = '#dce2eb'
      ctx.lineWidth = 1
      ctx.strokeRect(left, rowTop, width - left * 2, rowHeight)
      ctx.beginPath(); ctx.moveTo(left + nameWidth, rowTop); ctx.lineTo(left + nameWidth, rowTop + rowHeight); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(left + timelineOffset, rowTop); ctx.lineTo(left + timelineOffset, rowTop + rowHeight); ctx.stroke()
      drawText(ctx, group.employeeName, left + 12, rowTop + rowHeight / 2 - 8, nameWidth - 20, 17, colors.fill, '600')
      drawText(ctx, group.shifts.some((shift) => shift.scheduleOnly)
        ? '仅排班，不计工时' : `理论出勤 ${hoursLabel(theoreticalMinutes(group))}`,
      left + 12, rowTop + rowHeight / 2 + 10, nameWidth - 20, 12, '#66758b')
      drawText(ctx, group.pointName, left + nameWidth + 10, rowTop + rowHeight / 2,
        pointWidth - 18, 15, '#526176', '500')
      for (let minute = timelineStart; minute <= timelineEnd; minute += tickHours * 60) {
        const x = left + timelineOffset + ((minute - timelineStart) / timelineMinutes) * timelineWidth
        ctx.strokeStyle = '#e4e9f0'
        ctx.beginPath(); ctx.moveTo(x, rowTop); ctx.lineTo(x, rowTop + rowHeight); ctx.stroke()
      }
      for (const item of row.shifts) {
        const start = Math.max(item.start, timelineStart)
        const end = Math.min(item.end, timelineEnd)
        const blockX = left + timelineOffset + ((start - timelineStart) / timelineMinutes) * timelineWidth + 2
        const blockWidth = Math.max(8, ((end - start) / timelineMinutes) * timelineWidth - 4)
        const blockHeight = 18
        const blockY = rowTop + (row.laneCount === 1 ? (rowHeight - blockHeight) / 2 : 6 + item.lane * 24)
        ctx.fillStyle = colors.fill
        ctx.fillRect(blockX, blockY, blockWidth, blockHeight)
        if (blockWidth >= 64) {
          const timeLabel = `${clock(item.shift.plannedStart)}–${clock(item.shift.plannedEnd)}`
          const label = blockWidth >= 158 && item.shift.shiftTemplateName
            ? `${item.shift.shiftTemplateName} ${timeLabel}` : timeLabel
          drawText(ctx, label, blockX + 6, blockY + blockHeight / 2, blockWidth - 12, 13, colors.text, '600')
        }
      }
      if (!row.shifts.length) drawText(ctx, '未设置有效时段', left + timelineOffset + 12, rowTop + rowHeight / 2,
        timelineWidth - 24, 16, '#8995a7')
      y += rowHeight
    }

    drawText(ctx, '排班如需调整，请联系门店负责人。', left + 4, y + 43,
      width - left * 2 - 8, 16, '#8995a7')
    const exported = await new Promise<string>((resolve, reject) => {
      uni.canvasToTempFilePath({ canvas: canvasNode, x: 0, y: 0, width, height,
        destWidth: Math.round(width * dpr), destHeight: Math.round(height * dpr),
        fileType: 'png', quality: 1, success: (result) => resolve(result.tempFilePath), fail: reject })
    })
    imagePath.value = exported
  } catch (error) { message.value = errorMessage(error) }
  finally { rendering.value = false }
}

function saveImage() {
  if (!imagePath.value) return
  uni.saveImageToPhotosAlbum({ path: imagePath.value,
    success: () => uni.showToast({ title: '已保存到相册' }), fail: (error) => { message.value = errorMessage(error) } })
}

function shareImage() {
  if (!imagePath.value) return
  const showMenu = (uni as any).showShareImageMenu
  if (typeof showMenu === 'function') {
    showMenu({ path: imagePath.value, fail: () => uni.previewImage({ urls: [imagePath.value] }) })
    return
  }
  uni.showToast({ title: '预览后可长按图片转发', icon: 'none' })
  uni.previewImage({ urls: [imagePath.value] })
}
</script>

<template>
  <view class="page poster-page">
    <view class="poster-top">
      <view><text class="poster-title">排班汇总图片</text><text class="poster-subtitle">员工专属颜色区分班次，显示排班总工时，保存图片或转发</text></view>
      <view class="date-tag">{{ date }}</view>
    </view>
    <view v-if="message" class="message">{{ message }}</view>
    <view v-if="loading" class="message muted">正在读取已发布排班…</view>
    <view v-else-if="groups.length" class="poster-content">
      <view class="page-count">{{ pageCaption }} · {{ pageGroups.length }} 名员工</view>
      <view class="canvas-card"><canvas id="schedule-poster-canvas" type="2d" class="poster-canvas"
        :style="{ height: `${canvasHeight}rpx` }" /></view>
      <view class="page-controls" v-if="pageCount > 1">
        <button class="page-button" :disabled="currentPage === 0" @click="currentPage--">上一张</button>
        <button class="page-button" :disabled="currentPage + 1 >= pageCount" @click="currentPage++">下一张</button>
      </view>
      <view class="actions">
        <button class="secondary" :disabled="rendering || !imagePath" @click="saveImage">保存图片</button>
        <button class="primary" :disabled="rendering || !imagePath" @click="shareImage">转发图片</button>
      </view>
      <view class="tips">{{ rendering ? '正在生成图片…' : '图片只包含当前门店、当前日期已发布的排班' }}</view>
    </view>
  </view>
</template>

<style scoped>
.poster-page{padding-top:28rpx;padding-bottom:42rpx}.poster-top{display:flex;align-items:center;justify-content:space-between;gap:14rpx;margin:0 2rpx 20rpx}.poster-title{display:block;color:#1d2939;font-size:34rpx;font-weight:700}.poster-subtitle{display:block;margin-top:7rpx;color:#7b879b;font-size:21rpx}.date-tag{flex:none;padding:10rpx 14rpx;border-radius:14rpx;background:#fff0e7;color:#dd5618;font-size:21rpx;font-weight:700}.message{margin-bottom:16rpx;padding:16rpx 18rpx;border-radius:14rpx;background:#fff1ef;color:#bc3327;font-size:23rpx}.message.muted{background:#fff;color:#718096}.page-count{margin-bottom:12rpx;color:#718096;text-align:right;font-size:20rpx}.canvas-card{overflow:hidden;border-radius:18rpx;background:#fff;box-shadow:0 12rpx 30rpx rgba(45,55,72,.12)}.poster-canvas{display:block;width:750rpx;background:#f5f7fb}.page-controls{display:flex;gap:14rpx;margin-top:16rpx}.page-button{flex:1;margin:0;border:1rpx solid #e5e9f0;border-radius:14rpx;background:#fff;color:#42536c;font-size:23rpx}.page-button[disabled]{opacity:.4}.actions{display:flex;gap:16rpx;margin-top:16rpx}.actions button{flex:1;margin:0;border-radius:16rpx;font-size:26rpx;line-height:82rpx}.secondary{border:1rpx solid #e9a783;background:#fff;color:#d45519}.primary{border:0;background:#ed5a18;color:#fff}.primary[disabled],.secondary[disabled]{opacity:.55}.tips{padding:17rpx 0;color:#8792a6;text-align:center;font-size:20rpx}
</style>
