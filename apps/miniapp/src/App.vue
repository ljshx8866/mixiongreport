<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { ensureWechatLogin } from './utils/wechat'
onLaunch(async () => { try { await ensureWechatLogin() } catch {} })
</script>
<style>page{background:#f8fafc;color:#1e293b;font-family:Arial,"Microsoft YaHei",sans-serif}.card{background:#fff;border-radius:16rpx;padding:28rpx;margin:20rpx 24rpx}.label{display:block;color:#64748b;font-size:26rpx}.value{display:block;font-size:44rpx;font-weight:700;margin-top:8rpx}.button{background:#ea580c;color:#fff;border-radius:12rpx;padding:22rpx;text-align:center}.field{margin:18rpx 0}.field text{display:block;font-size:27rpx;margin-bottom:8rpx}.field input,.field textarea{border:1rpx solid #cbd5e1;border-radius:10rpx;padding:16rpx;width:auto;display:block}</style>
