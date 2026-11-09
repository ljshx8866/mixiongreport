<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import inputIcon from '../../../miniapp/src/static/module-icons/input.svg'
import reportIcon from '../../../miniapp/src/static/module-icons/report.svg'
import historyIcon from '../../../miniapp/src/static/module-icons/history.svg'
import reminderIcon from '../../../miniapp/src/static/module-icons/reminder.svg'
import peopleIcon from '../../../miniapp/src/static/module-icons/people.svg'
import myScheduleIcon from '../../../miniapp/src/static/module-icons/my-schedule.svg'
import myWorkIcon from '../../../miniapp/src/static/module-icons/my-work.svg'
import scheduleIcon from '../../../miniapp/src/static/module-icons/schedule.svg'
import timeIcon from '../../../miniapp/src/static/module-icons/time.svg'
import correctionIcon from '../../../miniapp/src/static/module-icons/correction.svg'
import transferIcon from '../../../miniapp/src/static/module-icons/transfer.svg'
import homeTabIcon from '../../../miniapp/src/static/tabbar/home.png'
import workbenchTabIcon from '../../../miniapp/src/static/tabbar/workbench.png'
import profileTabIcon from '../../../miniapp/src/static/tabbar/profile.png'

type Decoration = { homeTitle: string; homeSubtitle: string; defaultHomeModules: string[]; bannerUrl: string | null; hasBanner: boolean; updatedAt?: string }
const props = defineProps<{ apiBase: string; headers: () => Record<string, string> }>()
const businessModuleOptions = [
  { id: 'input', title: '每日填报', icon: inputIcon, tone: 'orange' },
  { id: 'report', title: '经营日报', icon: reportIcon, tone: 'blue' },
  { id: 'history', title: '历史日报', icon: historyIcon, tone: 'mint' },
  { id: 'reminders', title: '填报提醒', icon: reminderIcon, tone: 'purple' },
]
const hrModuleOptions = [
  { id: 'my-profile', title: '我的资料', icon: peopleIcon, tone: 'orange' },
  { id: 'my-schedule', title: '我的排班', icon: myScheduleIcon, tone: 'blue' },
  { id: 'my-work', title: '我的工时', icon: myWorkIcon, tone: 'mint' },
  { id: 'schedule', title: '门店排班', icon: scheduleIcon, tone: 'orange' },
  { id: 'hr-input', title: '门店填报', icon: inputIcon, tone: 'mint' },
  { id: 'time', title: '昨日工时', icon: timeIcon, tone: 'blue' },
  { id: 'correction', title: '工时更正', icon: correctionIcon, tone: 'purple' },
  { id: 'transfer', title: '员工转店', icon: transferIcon, tone: 'rose' },
  { id: 'onboarding', title: '员工入职', icon: peopleIcon, tone: 'mint' },
  { id: 'offboarding', title: '员工离职', icon: peopleIcon, tone: 'purple' },
]
const moduleOptions = [...businessModuleOptions, ...hrModuleOptions]
const config = ref<Decoration>({ homeTitle: '米熊 · 经营工作台', homeSubtitle: '常用功能一目了然', defaultHomeModules: ['input', 'report', 'history', 'reminders'], bannerUrl: null, hasBanner: false })
const previewUrl = ref('')
const busy = ref(false)
const message = ref('')
const previewDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
const previewModules = computed(() => moduleOptions.filter(item => config.value.defaultHomeModules.includes(item.id)))
const bannerSrc = computed(() => previewUrl.value || (config.value.bannerUrl ? `${props.apiBase}${config.value.bannerUrl}` : ''))

async function readConfig() {
  busy.value = true; message.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/miniapp/admin/decoration`, { headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '读取小程序装修配置失败')
    const defaultHomeModules = Array.isArray(data.defaultHomeModules)
      ? data.defaultHomeModules.filter((id: string) => moduleOptions.some(item => item.id === id))
      : []
    config.value = { ...config.value, ...data, defaultHomeModules: defaultHomeModules.length ? defaultHomeModules : ['input', 'report', 'history', 'reminders'] }
  } catch (error) { message.value = error instanceof Error ? error.message : '读取失败' }
  finally { busy.value = false }
}

function toggleModule(id: string) {
  const selected = config.value.defaultHomeModules
  if (selected.includes(id) && selected.length === 1) {
    message.value = '请至少保留一个默认入口'
    return
  }
  config.value.defaultHomeModules = selected.includes(id)
    ? selected.filter(item => item !== id)
    : selected.length < 5 ? [...selected, id] : selected
  if (!selected.includes(id) && config.value.defaultHomeModules.length === selected.length)
    message.value = '最多设置 5 个默认入口'
  else message.value = ''
}

async function save() {
  busy.value = true; message.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/miniapp/admin/decoration`, {
      method: 'PUT', headers: props.headers(),
      body: JSON.stringify({ homeTitle: config.value.homeTitle, homeSubtitle: config.value.homeSubtitle, defaultHomeModules: config.value.defaultHomeModules }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '保存失败')
    config.value = { ...config.value, ...data }
    message.value = '小程序装修设置已保存，新默认入口会应用于尚未自定义入口的用户。'
  } catch (error) { message.value = error instanceof Error ? error.message : '保存失败' }
  finally { busy.value = false }
}

async function uploadBanner(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    message.value = '请选择 PNG、JPG 或 WebP 图片，大小不超过 5 MB。'
    return
  }
  busy.value = true; message.value = ''
  try {
    const form = new FormData(); form.append('image', file)
    const authorization = props.headers().Authorization
    const response = await fetch(`${props.apiBase}/api/miniapp/admin/decoration/banner`, {
      method: 'POST', headers: authorization ? { Authorization: authorization } : {}, body: form,
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '图片上传失败')
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = URL.createObjectURL(file)
    config.value = { ...config.value, ...data }
    message.value = '首页图片已上传，保存文字与入口设置后即可在小程序展示。'
  } catch (error) { message.value = error instanceof Error ? error.message : '图片上传失败' }
  finally { busy.value = false }
}

async function removeBanner() {
  busy.value = true; message.value = ''
  try {
    const response = await fetch(`${props.apiBase}/api/miniapp/admin/decoration/banner`, { method: 'DELETE', headers: props.headers() })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? '移除图片失败')
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''; config.value = { ...config.value, ...data, bannerUrl: null }
    message.value = '已恢复默认渐变背景。'
  } catch (error) { message.value = error instanceof Error ? error.message : '移除图片失败' }
  finally { busy.value = false }
}

onMounted(readConfig)
</script>

<template>
  <div class="decoration-layout">
    <section class="editor-card">
      <div class="intro"><div><span class="eyebrow">MINI PROGRAM STUDIO</span><h2>首页预览与装修</h2><p>配置首页默认入口、标题与头图。用户个人设置过的常用入口会保留。</p></div><button class="secondary" :disabled="busy" @click="readConfig">刷新</button></div>
      <label class="field-label">首页标题<input v-model="config.homeTitle" maxlength="100" placeholder="米熊 · 经营工作台" /></label>
      <label class="field-label">首页说明<input v-model="config.homeSubtitle" maxlength="200" placeholder="常用功能一目了然" /></label>
      <div class="field-label">默认功能入口 <small>从小程序已有功能中选择 1 至 5 项；人事入口按账号权限显示</small></div>
      <div class="module-option-group">
        <div class="module-group-title">经营日报</div>
        <div class="module-options">
          <label v-for="item in businessModuleOptions" :key="item.id" class="module-option" :class="{ selected: config.defaultHomeModules.includes(item.id) }">
            <input type="checkbox" :checked="config.defaultHomeModules.includes(item.id)" :disabled="!config.defaultHomeModules.includes(item.id) && config.defaultHomeModules.length >= 5" @change="toggleModule(item.id)" />
            <span class="option-icon" :class="item.tone"><img :src="item.icon" /></span><span>{{ item.title }}</span>
          </label>
        </div>
      </div>
      <div class="module-option-group">
        <div class="module-group-title">人事与员工</div>
        <div class="module-options">
          <label v-for="item in hrModuleOptions" :key="item.id" class="module-option" :class="{ selected: config.defaultHomeModules.includes(item.id) }">
            <input type="checkbox" :checked="config.defaultHomeModules.includes(item.id)" :disabled="!config.defaultHomeModules.includes(item.id) && config.defaultHomeModules.length >= 5" @change="toggleModule(item.id)" />
            <span class="option-icon" :class="item.tone"><img :src="item.icon" /></span><span>{{ item.title }}</span>
          </label>
        </div>
      </div>
      <div class="field-label image-label">首页头图 <small>建议横版图片，上传 PNG、JPG 或 WebP，最大 5 MB</small></div>
      <div class="image-actions"><label class="upload-button">{{ config.hasBanner ? '更换图片' : '上传图片' }}<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="uploadBanner" /></label><button v-if="config.hasBanner" class="secondary" :disabled="busy" @click="removeBanner">恢复默认背景</button></div>
      <p v-if="message" class="message" :class="{ error: /失败|不得|最多|请选择/.test(message) }" v-popup-error="/失败|不得|最多|请选择/.test(message) ? message : ''">{{ message }}</p>
      <div class="save-row"><span>更改会同步到小程序的默认首页</span><button :disabled="busy" @click="save">{{ busy ? '处理中…' : '保存装修设置' }}</button></div>
    </section>
    <aside class="preview-panel">
      <div class="preview-heading"><div><b>实时预览</b><span>默认首页 · 示例数据</span></div><span class="preview-dot">●</span></div>
      <div class="phone">
        <div class="phone-status"><span>9:41</span><span>●●●　◉　▰</span></div>
        <div class="phone-titlebar">经营日报</div>
        <div class="phone-content">
          <div class="phone-hero" :class="{ 'has-image': bannerSrc }">
            <img v-if="bannerSrc" :src="bannerSrc" />
            <div class="hero-shade" />
            <div class="hero-copy">
              <div class="hero-heading"><div><span>{{ config.homeTitle || '米熊 · 经营工作台' }}</span><small>{{ config.homeSubtitle }}</small><b>山大店</b></div><i>{{ previewDate }}</i></div>
              <div class="hero-sales"><small>今日总销售</small><strong>¥5,644.74</strong></div>
              <div class="hero-metrics"><div><small>总入客</small><b>389</b></div><div><small>客单价</small><b>¥14.51</b></div></div>
            </div>
          </div>
          <div class="phone-quick">
            <div class="quick-heading"><div><small>QUICK ACCESS</small><b>常用功能</b></div><i>今日已填报</i></div>
            <div class="quick-grid">
              <div v-for="item in previewModules" :key="item.id" class="quick-item">
                <i :class="item.tone"><img :src="item.icon" /></i><span>{{ item.title }}</span>
              </div>
              <div v-if="!previewModules.length" class="quick-empty">请至少选择一个默认入口</div>
            </div>
            <div class="quick-edit"><div><b>自定义常用功能</b><small>设置首页常用入口</small></div><button>✎ 编辑常用功能</button></div>
          </div>
        </div>
        <div class="phone-bottom"><span class="active"><img :src="homeTabIcon" /><small>首页</small></span><span><img :src="workbenchTabIcon" /><small>工作台</small></span><span><img :src="profileTabIcon" /><small>我的</small></span></div>
      </div>
      <p class="preview-note">按常见手机屏幕比例预览（393 × 852）；经营数据为示例。</p>
    </aside>
  </div>
</template>

<style scoped>
.decoration-layout{display:grid;grid-template-columns:minmax(480px,1fr) 350px;gap:22px;align-items:start}
.editor-card,.preview-panel{border:1px solid #e9edf3;border-radius:18px;background:#fff;box-shadow:0 8px 28px rgba(32,46,71,.045)}.editor-card{padding:26px}
.intro{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px}.eyebrow{color:#dc6a32;font-size:11px;font-weight:800;letter-spacing:1.8px}.intro h2{margin:5px 0 0;color:#19283e;font-size:24px}.intro p{margin:7px 0 0;color:#8995a6;font-size:13px}
.field-label{display:block;margin:18px 0 8px;color:#34445b;font-size:13px;font-weight:700}.field-label small{display:block;margin-top:5px;color:#929eae;font-size:12px;font-weight:400}.field-label input:not([type=checkbox]){display:block;width:100%;height:42px;margin-top:8px;padding:0 12px;border:1px solid #dfe5ed;border-radius:9px;color:#223149;font:inherit;font-weight:400}
.module-option-group+.module-option-group{margin-top:16px}.module-group-title{margin:0 0 8px;color:#7b8798;font-size:12px;font-weight:700}.module-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.module-option{display:flex;align-items:center;gap:10px;min-height:48px;padding:8px 10px;border:1px solid #e7ebf0;border-radius:10px;color:#45556c;font-size:13px;cursor:pointer}.module-option.selected{border-color:#efb390;background:#fff7f2;color:#a74b1d}.module-option input{accent-color:#ef6426}.option-icon{display:grid;width:28px;height:28px;place-items:center;border-radius:8px;background:#fff0e7}.option-icon img{width:19px;height:19px}.option-icon.blue{background:#eaf1ff}.option-icon.mint{background:#e5f7f1}.option-icon.purple{background:#f0ecff}
.image-label{margin-top:22px}.image-actions{display:flex;gap:10px}.upload-button,.secondary,.save-row button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 15px;border:1px solid #e2e7ee;border-radius:9px;background:#fff;color:#40516a;font-size:13px;font-weight:600;cursor:pointer}.upload-button{border-color:#f1cab3;background:#fff8f3;color:#c65a27}.upload-button input{display:none}.message{margin:16px 0 0;color:#187b55;font-size:13px}.message.error{color:#c24537}.save-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:24px;padding-top:18px;border-top:1px solid #edf0f4;color:#8995a6;font-size:12px}.save-row button{border-color:#e75f22;background:#e75f22;color:#fff}.save-row button:disabled,.secondary:disabled,.upload-button:has(input:disabled){opacity:.6;cursor:wait}
.preview-panel{padding:18px}.preview-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.preview-heading b,.preview-heading span{display:block}.preview-heading b{color:#223149;font-size:15px}.preview-heading div span{margin-top:3px;color:#98a2b1;font-size:11px}.preview-dot{color:#20a46b;font-size:11px}
.phone{box-sizing:border-box;display:flex;width:min(100%,320px);aspect-ratio:393 / 852;flex-direction:column;overflow:hidden;margin:0 auto;border:7px solid #222b38;border-radius:38px;background:#f3f6fa;box-shadow:0 15px 35px rgba(23,35,53,.15)}.phone-status{display:flex;flex:none;justify-content:space-between;padding:9px 16px 4px;background:#f5f7fb;color:#26344a;font-size:10px;font-weight:700}.phone-titlebar{flex:none;padding:8px 0 10px;background:#f5f7fb;color:#1c2a40;text-align:center;font-size:13px;font-weight:700}
.phone-content{min-height:0;flex:1;overflow:auto;padding:12px 12px 6px;background:#eff3f8;scrollbar-width:none}.phone-content::-webkit-scrollbar{display:none}
.phone-hero{position:relative;overflow:hidden;padding:17px;border-radius:16px;background:linear-gradient(135deg,#1a2b45,#263d5f);color:#fff;box-shadow:0 10px 21px rgba(24,37,61,.16)}.phone-hero:before{position:absolute;right:-32px;top:-45px;width:125px;height:125px;border-radius:50%;background:rgba(248,132,71,.17);content:''}.phone-hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.hero-shade{position:absolute;inset:0;background:linear-gradient(100deg,rgba(15,27,44,.86),rgba(15,27,44,.3))}.hero-copy{position:relative;z-index:1}.hero-heading{display:flex;justify-content:space-between;gap:8px}.hero-heading>div{display:flex;min-width:0;flex-direction:column}.hero-heading span{color:#f7a779;font-size:10px;font-weight:700;letter-spacing:.3px}.hero-heading small{margin-top:2px;color:#d4deea;font-size:8px}.hero-heading b{margin-top:7px;color:#fff;font-size:18px}.hero-heading i{flex:none;align-self:flex-start;padding:4px 7px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.1);color:#e9eef5;font-size:8px;font-style:normal}.hero-sales{margin:20px 0 14px}.hero-sales small,.hero-metrics small{display:block;color:#bdc9da;font-size:9px}.hero-sales strong{display:block;margin-top:2px;color:#fff;font-size:29px;letter-spacing:-.5px}.hero-metrics{display:flex;padding-top:12px;border-top:1px solid rgba(255,255,255,.18)}.hero-metrics>div{width:50%}.hero-metrics>div+div{padding-left:18px;border-left:1px solid rgba(255,255,255,.18)}.hero-metrics b{display:block;margin-top:3px;color:#fff;font-size:15px}
.phone-quick{margin-top:16px}.quick-heading{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:9px}.quick-heading>div{display:flex;flex-direction:column}.quick-heading small{color:#d47543;font-size:7px;font-weight:700;letter-spacing:1px}.quick-heading b{margin-top:2px;color:#1a2b45;font-size:16px}.quick-heading>i{padding:4px 7px;border-radius:999px;background:#e5f6ee;color:#21845a;font-size:8px;font-style:normal;font-weight:700}.quick-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px 3px;padding:12px 8px;border:1px solid #edf0f5;border-radius:12px;background:#fff;box-shadow:0 5px 14px rgba(27,43,70,.04)}.quick-item{display:flex;min-width:0;align-items:center;flex-direction:column;gap:5px;color:#354258;font-size:8px;white-space:nowrap}.quick-item>i{display:grid;width:37px;height:37px;place-items:center;border-radius:11px;background:#fff0e7}.quick-item>i img{width:24px;height:24px}.quick-item>i.blue{background:#eaf1ff}.quick-item>i.mint{background:#e5f7f1}.quick-item>i.purple{background:#f0ecff}.quick-empty{grid-column:1/-1;padding:10px 0;color:#96a0af;text-align:center;font-size:10px}.quick-edit{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:9px;padding:9px 8px;border:1px solid #f0e4dc;border-radius:10px;background:#fff8f3}.quick-edit>div{display:flex;min-width:0;flex-direction:column;gap:3px}.quick-edit b{color:#26364c;font-size:9px}.quick-edit small{color:#778397;font-size:7px}.quick-edit button{flex:none;padding:6px 8px;border:0;border-radius:7px;background:#e96528;color:#fff;font-size:8px;font-weight:700}
.phone-bottom{display:flex;flex:none;justify-content:space-around;padding:7px 0 8px;border-top:1px solid #f0f1f4;background:#fff;color:#8490a5;text-align:center}.phone-bottom span{display:flex;width:33.33%;align-items:center;flex-direction:column;gap:2px}.phone-bottom img{width:19px;height:19px;opacity:.75}.phone-bottom small{font-size:8px}.phone-bottom .active small{color:#ed5a18}.phone-bottom .active img{opacity:1}
.preview-note{margin:12px 0 0;color:#9aa4b2;text-align:center;font-size:11px}@media(max-width:1000px){.decoration-layout{grid-template-columns:1fr}.preview-panel{order:-1}}
</style>
