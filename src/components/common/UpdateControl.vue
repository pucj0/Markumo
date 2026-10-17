<template>
  <div ref="root" class="update-control" @mousedown.stop @dblclick.stop @keydown.esc.stop="open=false">
    <button class="ib" aria-label="检查更新" :title="state.version ? `发现新版本 ${state.version}` : '检查更新'" :aria-expanded="open" @click="toggle">
      <Icon name="download" /><span v-if="state.version" class="update-dot" />
    </button>
    <section v-if="open" class="update-panel" aria-label="应用更新" role="region">
      <strong>Markumo <span>{{ currentVersion }}</span></strong>
      <p aria-live="polite">{{ label }}</p>
      <progress v-if="state.phase==='downloading'" :value="state.total ? state.received : undefined" :max="state.total || 1" aria-label="更新下载进度" />
      <pre v-if="state.notes">{{ state.notes }}</pre>
      <p v-if="state.error" class="update-error" role="alert">{{ state.error }}</p>
      <div class="update-actions">
        <button @click="openRelease">GitHub 发布页</button>
        <button v-if="['available','downloaded','ready'].includes(state.phase)" class="primary" @click="install">{{ state.phase==='ready' ? '重启应用' : state.phase==='downloaded' ? '安装并重启' : '一键更新' }}</button>
        <button v-else :disabled="busy" class="primary" @click="updater.check()">{{ busy ? '请稍候…' : '检查更新' }}</button>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue'
import {invoke} from '@tauri-apps/api/core'
import {AppUpdater,openProjectPage,updateState} from '../../features/shell/AppUpdater'
import Icon from './Icon.vue'
const props=defineProps<{beforeInstall:()=>Promise<boolean>;enabled:boolean}>()
const emit=defineEmits<{(e:'installing',value:boolean):void}>()
const state=reactive(updateState()),open=ref(false),root=ref<HTMLElement>(),currentVersion=ref('')
const busy=computed(()=>['checking','downloading','installing'].includes(state.phase))
const label=computed(()=>({idle:'自动检测新版本',checking:'正在检查更新…',current:'当前已是最新版本',available:`发现新版本 ${state.version}`,downloading:`正在下载 ${state.total ? Math.min(100,Math.round(state.received/state.total*100))+'%' : (state.received/1048576).toFixed(1)+' MiB'}`,downloaded:'更新已下载，等待安装',installing:'正在安装并重启，请稍候…',ready:'更新已安装，请重启应用',error:'暂时无法检查更新'})[state.phase])
const updater=new AppUpdater(state,{
  check:async()=>{const {check}=await import('@tauri-apps/plugin-updater');return check({timeout:15000})},
  beforeInstall:async()=>!import.meta.env.DEV&&await props.beforeInstall(),
  relaunch:async()=>{const {relaunch}=await import('@tauri-apps/plugin-process');await relaunch()},
})
watch(()=>state.phase,phase=>emit('installing',phase==='installing'),{flush:'sync'})
async function toggle(){open.value=!open.value;if(open.value&&['idle','error'].includes(state.phase)&&props.enabled)await updater.check()}
async function install(){
  if(import.meta.env.DEV){state.error='开发模式不执行安装，请使用已安装的正式版。';return}
  await updater.install()
}
async function openRelease(){try{await openProjectPage(true,true)}catch(error){state.error=String(error)}}
function outside(event:PointerEvent){if(event.target instanceof Node&&!root.value?.contains(event.target))open.value=false}
let timer:ReturnType<typeof setTimeout>|undefined,interval:ReturnType<typeof setInterval>|undefined
let initialChecked=false
function scheduleInitialCheck(){
  if(import.meta.env.DEV||initialChecked||timer||!props.enabled)return
  timer=setTimeout(()=>{timer=undefined;if(props.enabled){initialChecked=true;void updater.check()}},10000)
}
watch(()=>props.enabled,()=>scheduleInitialCheck())
onMounted(()=>{
  void invoke<string>('get_app_version').then(value=>currentVersion.value=value).catch(()=>{})
  window.addEventListener('pointerdown',outside)
  if(!import.meta.env.DEV){scheduleInitialCheck();interval=setInterval(()=>{if(props.enabled)void updater.check()},4*60*60*1000)}
})
onBeforeUnmount(()=>{if(timer)clearTimeout(timer);if(interval)clearInterval(interval);window.removeEventListener('pointerdown',outside);updater.dispose()})
</script>
<style scoped>
.update-control{position:relative;display:flex}.ib{position:relative}.update-dot{position:absolute;right:3px;top:3px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.update-panel{position:absolute;right:0;top:calc(100% + 9px);z-index:1200;width:min(360px,calc(100vw - 30px));padding:16px;background:var(--bar);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);font-size:13px;color:var(--ink)}
strong{color:var(--bright)}strong span{font-weight:400;color:var(--muted);margin-left:8px}p{margin:10px 0;overflow-wrap:anywhere}pre{max-height:180px;overflow:auto;white-space:pre-wrap;font:inherit;color:var(--sub)}progress{width:100%;accent-color:var(--accent)}.update-error{color:var(--yellow)}
.update-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.update-actions button{padding:6px 10px;border:1px solid var(--line);border-radius:4px;background:var(--editor);font:inherit}.update-actions .primary{color:var(--accent);background:var(--accentbg)}button:disabled{opacity:.5}
</style>
