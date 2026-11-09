<script setup lang="ts">
const appReady = true
</script>

<style>
page{min-height:100%;background:#eff3f8;color:#172033;font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;font-size:28rpx;line-height:1.5}
view,button,input,textarea{text-size-adjust:100%;box-sizing:border-box}
.page{padding:24rpx 24rpx 48rpx}.card{margin:0 0 20rpx;padding:28rpx;background:#fff;border:1rpx solid #edf0f5;border-radius:24rpx;box-shadow:0 10rpx 30rpx rgba(33,48,76,.055)}
.store-context-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12rpx}.store-context-title{flex:1;min-width:0}
.label{display:block;color:#8490a5;font-size:24rpx;line-height:1.55}.value{display:block;color:#172033;font-size:42rpx;font-weight:700;line-height:1.25}.eyebrow{display:block;color:#f06a24;font-size:23rpx;font-weight:700;letter-spacing:1rpx}.section-title{display:block;color:#172033;font-size:30rpx;font-weight:700}.section-subtitle{display:block;margin-top:4rpx;color:#98a2b3;font-size:23rpx}
.button{display:flex;align-items:center;justify-content:center;min-height:88rpx;padding:0 28rpx;border:0;border-radius:16rpx;background:#f15b16;color:#fff;font-size:28rpx;font-weight:600;box-shadow:0 8rpx 18rpx rgba(241,91,22,.2)}.button::after{border:0}.button.secondary{background:#fff4ed;color:#e75311;box-shadow:none}.button.dark{background:#172033;box-shadow:none}
.field{margin-top:24rpx}.field text{display:block;margin-bottom:10rpx;color:#536076;font-size:25rpx;font-weight:600}.field input,.field textarea{width:100%;border:1rpx solid #e4e9f1;border-radius:14rpx;background:#fafbfd;color:#172033;font-size:29rpx;padding:20rpx 22rpx}.field input{height:88rpx}.field textarea{min-height:160rpx}.field input:focus,.field textarea:focus{border-color:#f15b16;background:#fff}
.status-pill{display:inline-flex;align-items:center;padding:7rpx 14rpx;border-radius:999rpx;background:#fff1e9;color:#e75311;font-size:22rpx;font-weight:600}.status-pill.ok{background:#eaf8f1;color:#168152}.error-text{display:block;margin-top:16rpx;color:#dc3b3b;font-size:25rpx}.muted{color:#8490a5}.divider{height:1rpx;margin:22rpx 0;background:#eef1f5}
.detail-page .heading{position:relative;margin:4rpx 0 0;padding:12rpx 4rpx 0 20rpx;color:#1a2a43;font-size:40rpx;font-weight:750;line-height:1.3}
.detail-page .heading::before{position:absolute;left:2rpx;top:24rpx;width:6rpx;height:32rpx;border-radius:999rpx;background:#ed6524;content:""}
.detail-page .subheading,.detail-page .description{display:block;margin:8rpx 4rpx 22rpx;color:#8390a4;font-size:23rpx;line-height:1.55}
.detail-page .card{margin-bottom:18rpx;padding:24rpx;border:1rpx solid #edf0f5;border-radius:22rpx;background:#fff;box-shadow:0 8rpx 24rpx rgba(33,48,76,.045)}
.detail-page .field{border-color:#e4e9f1;border-radius:14rpx;background:#fafbfd;color:#46556b}
.detail-page .actions{gap:14rpx;margin-top:14rpx}
.detail-page .actions button{min-height:72rpx;border:0;border-radius:14rpx;background:#fff1e9;color:#d9571d;font-size:24rpx;font-weight:600}
.detail-page .actions button:last-child{background:#f2f5f9;color:#536177}
.detail-page .list-title{display:block;margin:30rpx 4rpx 14rpx;color:#1a2a43;font-size:30rpx;font-weight:700}
.detail-page .notice{padding:16rpx 20rpx;border:1rpx solid #f5dfd1;border-radius:16rpx;background:#fff7f1;color:#98562f;line-height:1.55}
</style>
