<template>
  <section class="update-panel" role="dialog" aria-label="应用更新" @keydown.esc.stop="$emit('close')">
    <header><strong>Markumo</strong><button aria-label="关闭更新面板" @click="$emit('close')">×</button></header>
    <p class="versions">当前版本 {{ state.currentVersion || '读取中…' }}<span v-if="state.version"> · 最新版本 {{ state.version }}</span></p>
    <h2 aria-live="polite">{{ updateLabel(state) }}</h2>
    <template v-if="state.phase==='downloading'">
      <progress :value="state.total ? state.received : undefined" :max="state.total || 1" aria-label="更新下载进度" />
      <p>{{ bytes(state.received) }}<template v-if="state.total"> / {{ bytes(state.total) }} · {{ Math.min(100,Math.floor(state.received/state.total*100)) }}%</template></p>
      <p class="hint">下载期间可以继续正常使用 Markumo。</p>
    </template>
    <p v-if="state.phase==='downloaded'" class="hint">新版本已下载完成，由你决定何时安装和重启。</p>
    <p v-if="!state.installSupported" class="hint">当前安装方式请在发布页下载新版 deb 并手动安装。</p>
    <div v-if="state.notes" class="release-notes" @click="openNote" v-html="safeReleaseNotes(state.notes)" />
    <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
    <p v-if="state.confirmedVersion" class="hint">已验证当前运行版本 v{{ state.confirmedVersion }}。</p>
    <footer>
      <a :href="releasePageUrl(state.version||state.confirmedVersion||undefined)" @click.prevent="$emit('release')">查看完整更新日志</a>
      <button @click="$emit('close')">{{ state.phase==='downloaded' ? '稍后安装' : '稍后' }}</button>
      <button v-if="state.phase==='available'&&state.installSupported" class="primary" @click="$emit('download')">{{ state.error ? '重试下载' : '下载更新' }}</button>
      <button v-else-if="['downloaded','awaiting-restart'].includes(state.phase)" class="primary" @click="$emit('install')">{{ state.phase==='awaiting-restart' ? '保存并重启' : '安装并重启' }}</button>
      <button v-else-if="!['downloading','preparing','installing'].includes(state.phase)" :disabled="state.phase==='checking'" class="primary" @click="$emit('check')">{{ state.phase==='checking' ? '检查中…' : '检查更新' }}</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import {safeReleaseNotes} from '../../features/shell/updater/releaseNotes'
import {releasePageUrl} from '../../features/shell/AppUpdater'
import {updateLabel,type UpdateState} from '../../features/shell/updater/UpdateState'
defineProps<{state:UpdateState}>()
const emit=defineEmits<{(e:'close'|'check'|'download'|'install'|'release'):void;(e:'link',url:string):void}>()
function bytes(value:number){return value<1024?`${value} B`:value<1048576?`${(value/1024).toFixed(1)} KiB`:`${(value/1048576).toFixed(1)} MiB`}
function openNote(event:MouseEvent){const link=(event.target as Element).closest('a');if(link){event.preventDefault();const href=link.getAttribute('href');if(href&&/^https?:\/\//i.test(href))emit('link',href)}}
</script>
<style scoped>
.update-panel{position:fixed;right:18px;top:58px;z-index:1200;width:min(430px,calc(100vw - 32px));max-height:calc(100vh - 80px);overflow:auto;padding:18px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);box-shadow:var(--shadow);font-size:var(--ui-font-size);overflow-wrap:anywhere}
header{display:flex;align-items:center;justify-content:space-between;color:var(--bright)}h2{font-size:calc(var(--ui-font-size) + 2px);margin:14px 0}p{margin:10px 0}.versions,.hint{color:var(--muted);font-size:var(--ui-small-font-size)}progress{width:100%;accent-color:var(--accent)}.release-notes{max-height:260px;overflow:auto;padding:8px 0;border-top:1px solid var(--line);line-height:1.6}.release-notes :deep(pre){white-space:pre-wrap}.release-notes :deep(a){color:var(--accent)}.release-notes :deep(h1),.release-notes :deep(h2){font-size:1.1em}.error{color:var(--yellow)}footer a{align-self:center;color:var(--accent);text-decoration:underline;font-size:var(--ui-small-font-size)}footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:14px}button{padding:6px 9px;border:1px solid var(--line);border-radius:5px;background:var(--editor);font:inherit}.primary{background:var(--accentbg);color:var(--accent)}button:disabled{opacity:.5}
</style>
