<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  title?: string
  start: string
  end: string
  startLabel?: string
  endLabel?: string
  baselineStart?: string
  baselineEnd?: string
  baselineLabel?: string
  breakStart?: string
  breakEnd?: string
  showBreak?: boolean
  readOnly?: boolean
  compact?: boolean
}>(), {
  title: '时间调整', startLabel: '开始时间', endLabel: '结束时间',
  baselineLabel: '计划时间', showBreak: false, readOnly: false, compact: false,
})

const emit = defineEmits<{
  (event: 'update:start', value: string): void
  (event: 'update:end', value: string): void
  (event: 'update:breakStart', value: string): void
  (event: 'update:breakEnd', value: string): void
}>()

function minutes(value?: string) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null
  const [hour, minute] = value.split(':').map(Number)
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null
  return hour * 60 + minute
}

function segmentStyle(from?: string, to?: string) {
  const first = minutes(from)
  const last = minutes(to)
  if (first === null || last === null || last <= first) return { display: 'none' }
  return { left: `${(first / 1440) * 100}%`, width: `${((last - first) / 1440) * 100}%` }
}

const currentRangeVisible = computed(() => minutes(props.start) !== null && minutes(props.end) !== null &&
  minutes(props.end)! > minutes(props.start)!)
const hasBaseline = computed(() => Boolean(props.baselineStart && props.baselineEnd))
const hasBreak = computed(() => Boolean(props.showBreak && props.breakStart && props.breakEnd))
const ticks = ['00', '06', '12', '18', '24']

function chooseTime(event: { detail: { value: string } }, field: 'start' | 'end' | 'breakStart' | 'breakEnd') {
  emit(`update:${field}`, String(event.detail.value))
}
</script>

<template>
  <view class="time-range-editor" :class="{ compact }">
    <view v-if="!compact" class="editor-heading">
      <text class="editor-title">{{ title }}</text>
      <text class="editor-delta">{{ hasBaseline ? `蓝色为${baselineLabel} · 橙色为当前时间` : '橙色显示当前设置的时段' }}</text>
    </view>
    <view class="timeline">
      <view class="track">
        <view v-if="hasBaseline" class="range baseline-range" :style="segmentStyle(baselineStart, baselineEnd)" />
        <view v-if="currentRangeVisible" class="range current-range" :style="segmentStyle(start, end)" />
        <view v-if="hasBreak" class="range break-range" :style="segmentStyle(breakStart, breakEnd)" />
      </view>
      <view class="ticks"><text v-for="tick in ticks" :key="tick">{{ tick }}</text></view>
    </view>
    <view v-if="!readOnly" class="time-fields">
      <picker mode="time" :value="start" @change="(event) => chooseTime(event, 'start')">
        <view class="time-field start-field"><text>{{ startLabel }}</text><strong>{{ start || '--:--' }}</strong></view>
      </picker>
      <picker mode="time" :value="end" @change="(event) => chooseTime(event, 'end')">
        <view class="time-field end-field"><text>{{ endLabel }}</text><strong>{{ end || '--:--' }}</strong></view>
      </picker>
      <picker v-if="showBreak" mode="time" :value="breakStart || '12:00'" @change="(event) => chooseTime(event, 'breakStart')">
        <view class="time-field break-field"><text>休息开始（可选）</text><strong>{{ breakStart || '未设置' }}</strong></view>
      </picker>
      <picker v-if="showBreak" mode="time" :value="breakEnd || '12:30'" @change="(event) => chooseTime(event, 'breakEnd')">
        <view class="time-field break-field"><text>休息结束（可选）</text><strong>{{ breakEnd || '未设置' }}</strong></view>
      </picker>
    </view>
    <view v-if="!compact" class="legend">
      <text v-if="hasBaseline"><i class="legend-dot baseline-dot" />{{ baselineLabel }}</text>
      <text><i class="legend-dot current-dot" />{{ hasBaseline ? '调整后时间' : '当前设置' }}</text>
    </view>
  </view>
</template>

<style scoped>
.time-range-editor{margin:12rpx 0;padding:16rpx;border:1rpx solid #e5eaf1;border-radius:16rpx;background:#fff}
.editor-heading{display:flex;flex-direction:column;gap:4rpx;margin-bottom:14rpx}.editor-title{color:#29374d;font-size:22rpx;font-weight:700}.editor-delta{color:#8793a5;font-size:18rpx}
.timeline{padding:4rpx 2rpx 0}.track{position:relative;height:26rpx;overflow:hidden;border-radius:999rpx;background:#edf1f6}
.track:before{position:absolute;z-index:1;inset:0;content:'';background:repeating-linear-gradient(to right,transparent 0,transparent calc(25% - 1rpx),rgba(124,139,160,.3) calc(25% - 1rpx),rgba(124,139,160,.3) 25%)}
.range{position:absolute;border-radius:999rpx}.baseline-range{z-index:2;top:3rpx;height:9rpx;background:#5792e8;opacity:.95}.current-range{z-index:3;top:14rpx;height:9rpx;background:#f0763a;opacity:.98}.break-range{z-index:4;top:8rpx;height:10rpx;background:#4e596b;opacity:.9}
.ticks{display:flex;justify-content:space-between;margin-top:6rpx;color:#98a2b2;font-size:16rpx;line-height:1}
.time-fields{display:grid;grid-template-columns:1fr 1fr;gap:10rpx;margin-top:14rpx}.time-field{display:flex;align-items:center;justify-content:space-between;gap:8rpx;min-height:62rpx;padding:0 12rpx;border:1rpx solid #e7ebf1;border-radius:11rpx;background:#f9fafc}.time-field text{color:#778398;font-size:18rpx}.time-field strong{font-size:22rpx}.start-field strong{color:#d95a24}.end-field strong{color:#3c76ca}.break-field strong{color:#4e596b}
.legend{display:flex;gap:18rpx;margin-top:12rpx;color:#718096;font-size:18rpx}.legend text{display:flex;align-items:center;gap:6rpx}.legend-dot{display:inline-block;width:12rpx;height:12rpx;border-radius:50%}.baseline-dot{background:#5792e8}.current-dot{background:#f0763a}
.compact{margin:8rpx 0 0;padding:0;border:0;background:transparent}.compact .track{height:12rpx}.compact .ticks{margin-top:4rpx;font-size:14rpx}
</style>
