<script setup lang="ts">
type IconName = 'input' | 'report' | 'history' | 'reminder' | 'people' |
  'my-schedule' | 'my-work' | 'schedule' | 'time' | 'correction' | 'transfer'
type Tone = 'orange' | 'blue' | 'mint' | 'purple' | 'rose'

withDefaults(defineProps<{
  title: string
  caption?: string
  badge?: string
  icon: IconName
  tone?: Tone
  variant?: 'compact' | 'card'
}>(), { tone: 'orange', variant: 'card' })

const emit = defineEmits<{ (event: 'activate'): void }>()
const iconPaths: Record<IconName, string> = {
  input: '/static/module-icons/input.svg',
  report: '/static/module-icons/report.svg',
  history: '/static/module-icons/history.svg',
  reminder: '/static/module-icons/reminder.svg',
  people: '/static/module-icons/people.svg',
  'my-schedule': '/static/module-icons/my-schedule.svg',
  'my-work': '/static/module-icons/my-work.svg',
  schedule: '/static/module-icons/schedule.svg',
  time: '/static/module-icons/time.svg',
  correction: '/static/module-icons/correction.svg',
  transfer: '/static/module-icons/transfer.svg',
}
</script>

<template>
  <view class="module-tile" :class="variant" hover-class="module-tile-pressed"
    role="button" :aria-label="`${title}${badge ? `，${badge}` : ''}`" @click="emit('activate')">
    <view class="icon-box" :class="tone">
      <image class="icon-image" :src="iconPaths[icon]" mode="aspectFit" />
    </view>
    <view class="tile-copy">
      <text class="tile-title">{{ title }}</text>
      <text v-if="caption && variant === 'card'" class="tile-caption">{{ caption }}</text>
      <text v-if="badge" class="tile-badge">{{ badge }}</text>
    </view>
  </view>
</template>

<style scoped>
.module-tile{min-width:0;display:flex;align-items:center;border:1rpx solid #edf0f5;background:#fff;box-shadow:0 8rpx 24rpx rgba(27,43,70,.045);transition:transform .15s ease,box-shadow .15s ease}
.module-tile-pressed{transform:scale(.97);box-shadow:0 3rpx 10rpx rgba(27,43,70,.07)}
.module-tile.compact{min-height:174rpx;flex-direction:column;justify-content:center;padding:16rpx 6rpx 12rpx;border-radius:22rpx;text-align:center}
.module-tile.card{min-height:148rpx;gap:18rpx;padding:24rpx 20rpx;border-radius:24rpx}
.icon-box{width:78rpx;height:78rpx;flex:none;display:flex;align-items:center;justify-content:center;border-radius:22rpx}
.icon-box.orange{background:#fff0e7}.icon-box.blue{background:#eaf1ff}.icon-box.mint{background:#e5f7f1}.icon-box.purple{background:#f0ecff}.icon-box.rose{background:#fff0f1}
.icon-image{width:46rpx;height:46rpx}
.tile-copy{min-width:0;flex:1}.compact .tile-copy{width:100%;margin-top:12rpx}
.tile-title{display:block;overflow:hidden;color:#1d2b40;font-size:27rpx;font-weight:700;white-space:nowrap;text-overflow:ellipsis}
.compact .tile-title{font-size:23rpx}
.tile-caption{display:block;margin-top:5rpx;color:#8c99aa;font-size:21rpx;line-height:1.4}
.tile-badge{display:block;margin-top:3rpx;color:#e75b20;font-size:19rpx;line-height:1.3}
.card .tile-badge{margin-top:6rpx}
</style>
