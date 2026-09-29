<script setup lang="ts">
import { businessDate } from '../../utils/session'
const dates = Array.from({ length: 14 }, (_, index) => businessDate(-index))
</script>

<template>
  <view class="card" v-for="date in dates" :key="date" @click="uni.navigateTo({ url: `/pages/report/index?date=${date}` })">
    <text class="value">{{ date }}</text>
    <text class="label">查看经营日报</text>
  </view>
</template>
