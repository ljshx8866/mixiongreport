<script setup lang="ts">
withDefaults(defineProps<{ text?: string }>(), { text: '正在加载经营数据' })
</script>
<template><view class="loading-mask"><view class="loading-card"><view class="loader"><i></i><i></i><i></i></view><text>{{ text }}</text></view></view></template>
<style scoped>.loading-mask{position:fixed;z-index:999;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#f7f9fc,#eff3f8)}.loading-card{display:flex;flex-direction:column;align-items:center;gap:20rpx;color:#6f7c90;font-size:25rpx}.loader{display:flex;gap:10rpx;align-items:center;height:44rpx}.loader i{width:16rpx;height:16rpx;border-radius:50%;background:#ed5a18;animation:bounce 1s infinite ease-in-out}.loader i:nth-child(2){animation-delay:.15s;background:#f38b4e}.loader i:nth-child(3){animation-delay:.3s;background:#ffc099}@keyframes bounce{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-16rpx);opacity:1}}</style>
