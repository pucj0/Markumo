<template>
  <Transition name="fade">
    <div v-if="visible" class="settingsoverlay" @click.self="close" @keydown.stop="handleKeydown">
      <div ref="dialogRef" class="settings" role="dialog" aria-modal="true" aria-label="首选项设置">
        <header class="settings-head">
          <div class="settings-title"><Icon name="gear" /><h2>设置</h2></div>
          <button class="icon-button" aria-label="关闭设置" title="关闭" @click="close"><Icon name="close" /></button>
        </header>
        <div class="settings-body">
          <nav class="settings-nav" aria-label="设置分类">
            <button v-for="section in sections" :key="section.id" :aria-label="section.title" :class="{ active: activeSection === section.id }" @click="goToSection(section.id)">
              <Icon :name="section.icon" size="small" /><span>{{ section.title }}</span>
            </button>
          </nav>
          <div ref="contentRef" class="settings-content">
            <section id="settings-appearance" class="settings-section">
              <h3>外观</h3>
              <div class="settingrow"><label for="settings-theme">颜色主题</label><select id="settings-theme" :value="theme" @change="$emit('update:theme', ($event.target as HTMLSelectElement).value as ThemePreference)"><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></div>
              <div class="settingrow"><label for="settings-font">编辑器字体</label><select id="settings-font" :value="fontFamily" @change="$emit('update:fontFamily', ($event.target as HTMLSelectElement).value as EditorSettings['fontFamily'])"><option value="system">系统等宽字体</option><option value="consolas">Consolas</option><option value="cascadia">Cascadia Code</option></select></div>
              <div class="settingrow"><label for="settings-size">编辑器字号</label><div class="number-control"><input id="settings-size" type="number" min="10" max="24" step="1" :value="fontDraft" :aria-invalid="!!fontError" @input="updateFont" @blur="finishFont" @keydown.enter.prevent="finishFont" /><span>px</span></div></div>
              <p v-if="fontError" class="field-error" role="alert">{{ fontError }}</p>
            </section>
            <section id="settings-editor" class="settings-section">
              <h3>编辑</h3>
              <div class="settingrow"><label for="settings-wrap">自动软换行</label><input id="settings-wrap" class="setting-switch" type="checkbox" :checked="wordWrap" @change="$emit('update:wordWrap', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-outline">显示文档大纲</label><input id="settings-outline" class="setting-switch" type="checkbox" :checked="showOutline" @change="$emit('update:showOutline', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-indent">缩进宽度</label><select id="settings-indent" :value="indentSize" @change="$emit('update:indentSize', Number(($event.target as HTMLSelectElement).value))"><option v-for="n in 8" :key="n" :value="n">{{ n }}</option></select></div>
              <div class="settingrow"><label for="settings-tabs">使用 Tab 缩进</label><input id="settings-tabs" class="setting-switch" type="checkbox" :checked="useTabs" @change="$emit('update:useTabs', ($event.target as HTMLInputElement).checked)" /></div>
            </section>
            <section id="settings-save" class="settings-section">
              <h3>保存</h3>
              <div class="settingrow"><label for="settings-autosave">自动保存</label><input id="settings-autosave" class="setting-switch" type="checkbox" :checked="autoSave" @change="$emit('update:autoSave', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-save-delay">自动保存延迟</label><select id="settings-save-delay" :disabled="!autoSave" :value="autoSaveDelay" @change="$emit('update:autoSaveDelay', Number(($event.target as HTMLSelectElement).value))"><option v-if="!delays.includes(autoSaveDelay)" :value="autoSaveDelay">{{ autoSaveDelay / 1000 }} 秒</option><option v-for="delay in delays" :key="delay" :value="delay">{{ delay / 1000 }} 秒</option></select></div>
            </section>
            <section id="settings-markdown" class="settings-section">
              <h3>Markdown</h3>
              <div class="settingrow"><label for="settings-md-mode">Markdown 默认模式</label><select id="settings-md-mode" :value="defaultMdMode" @change="$emit('update:defaultMdMode', ($event.target as HTMLSelectElement).value as MarkdownMode)"><option value="live">即时排版</option><option value="source">源码</option><option value="split">双栏</option></select></div>
              <ImageSettings :global-rules="imageRules" :document-rules="documentImageRules" :document-path="markdownPath" :document-name="markdownName" @global="emit('update:imageRules', $event)" @document="emit('update:documentImageRules', $event)" />
            </section>
            <section id="settings-shortcuts" class="settings-section">
              <details ref="shortcutsRef">
                <summary>快捷键配置</summary>
                <div v-for="(_, id) in shortcuts" :key="id" class="settingrow shortcut-row"><label :for="`shortcut-${id}`">{{ shortcutLabels[id] }}</label><input :id="`shortcut-${id}`" v-model="shortcutDraft[id]" :aria-label="`快捷键 ${shortcutLabels[id]}`" /></div>
                <p v-if="shortcutError" class="field-error" role="alert">{{ shortcutError }}</p>
                <button class="secondary-button" @click="applyShortcuts">应用快捷键</button>
              </details>
            </section>
          </div>
        </div>
        <footer class="settings-foot"><button class="close-btn" @click="close">完成</button></footer>
      </div>
    </div>
  </Transition>
</template>
<script setup lang="ts">
import { useModal } from '../../features/shell/useModal'
import { nextTick, ref, watch } from 'vue'
import Icon from '../common/Icon.vue'
import ImageSettings from './ImageSettings.vue'
import type { ImageRules } from '../../editor/markdown/imageImport'
import { normalizeShortcut, validateShortcuts, shortcutLabels, type EditorSettings } from '../../features/shell/editorSettings'
import type { ThemePreference, MarkdownMode } from '../../types'
const props = defineProps<{
  theme: ThemePreference; fontSize: number; wordWrap: boolean; showOutline: boolean; defaultMdMode: MarkdownMode
  fontFamily: EditorSettings['fontFamily']; indentSize: number; useTabs: boolean; shortcuts: EditorSettings['shortcuts']
  autoSave: boolean; autoSaveDelay: number
  imageRules: ImageRules; documentImageRules: ImageRules | null; markdownPath?: string; markdownName?: string
}>()
const emit = defineEmits<{
  (e: 'update:theme', val: ThemePreference): void
  (e: 'update:fontSize', val: number): void
  (e: 'update:wordWrap', val: boolean): void
  (e: 'update:showOutline', val: boolean): void
  (e: 'update:defaultMdMode', val: MarkdownMode): void
  (e: 'update:fontFamily', val: EditorSettings['fontFamily']): void
  (e: 'update:indentSize', val: number): void
  (e: 'update:useTabs', val: boolean): void
  (e: 'update:shortcuts', val: EditorSettings['shortcuts']): void
  (e: 'update:autoSave', val: boolean): void
  (e: 'update:autoSaveDelay', val: number): void
  (e: 'update:imageRules', val: ImageRules): void
  (e: 'update:documentImageRules', val: ImageRules | null): void
}>()
const { visible, dialogRef, open, close, handleKeydown } = useModal()
const contentRef = ref<HTMLElement | null>(null), shortcutsRef = ref<HTMLDetailsElement | null>(null)
const activeSection = ref('appearance'), fontDraft = ref(String(props.fontSize)), fontError = ref('')
const shortcutDraft = ref({ ...props.shortcuts }), shortcutError = ref('')
const delays = [500, 1500, 3000, 5000]
const sections = [{id:'appearance',title:'外观',icon:'sun'}, {id:'editor',title:'编辑',icon:'font'}, {id:'save',title:'保存',icon:'save'}, {id:'markdown',title:'Markdown',icon:'files'}, {id:'shortcuts',title:'快捷键',icon:'keyboard'}]
watch(() => props.fontSize, value => { fontDraft.value = String(value) })
watch(visible, value => { if (value) { shortcutDraft.value = { ...props.shortcuts }; shortcutError.value = ''; fontDraft.value = String(props.fontSize); fontError.value = ''; activeSection.value = 'appearance' } })
function goToSection(id: string) {
  activeSection.value = id
  if (id === 'shortcuts' && shortcutsRef.value) shortcutsRef.value.open = true
  contentRef.value?.querySelector(`#settings-${id}`)?.scrollIntoView({block:'start'})
}
function updateFont(event: Event) {
  fontDraft.value = (event.target as HTMLInputElement).value
  const value = Number(fontDraft.value)
  fontError.value = !fontDraft.value || !Number.isInteger(value) || value < 10 || value > 24 ? '请输入 10–24 的整数字号' : ''
  if (!fontError.value) emit('update:fontSize', value)
}
function finishFont() { fontDraft.value = String(props.fontSize); fontError.value = '' }
function applyShortcuts() {
  const error = validateShortcuts(shortcutDraft.value)
  shortcutError.value = error || ''
  if (!error) emit('update:shortcuts', Object.fromEntries(Object.entries(shortcutDraft.value).map(([id,key]) => [id,normalizeShortcut(key)!])) as EditorSettings['shortcuts'])
}
async function openSection(id: string) { open(); await nextTick(); goToSection(id) }
defineExpose({ open, close, visible, openSection })
</script>
<style scoped>
.settingsoverlay { position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(3px);display:flex;justify-content:center;align-items:center;z-index:999;padding:16px }
.settings { width:720px;max-width:100%;height:620px;max-height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow) }
.settings-head { display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line);flex:none }
.settings-title { display:flex;align-items:center;gap:10px;color:var(--bright) }
h2 { margin:0;font-size:16px;font-weight:600 }
.icon-button { display:grid;place-items:center;width:28px;height:28px;border-radius:6px;color:var(--muted) }
.icon-button:hover { background:var(--hover);color:var(--bright) }
.settings-body { display:flex;flex:1;min-height:0 }
.settings-nav { flex:none;width:140px;padding:16px 10px;background:var(--sidebar);border-right:1px solid var(--line) }
.settings-nav button { width:100%;display:flex;align-items:center;gap:9px;padding:9px 12px;margin-bottom:4px;border-radius:7px;color:var(--sub);font-size:12px;text-align:left }
.settings-nav button:hover { background:var(--hover) }
.settings-nav button.active { background:var(--accentbg);color:var(--accent);font-weight:600 }
.settings-content { flex:1;min-width:0;overflow-y:auto;overscroll-behavior:contain;padding:20px 26px }
.settings-section { scroll-margin-top:20px;padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--line) }
.settings-section:last-child { border-bottom:0;margin-bottom:0 }
h3,summary { margin:0 0 12px;font-size:12px;font-weight:600;color:var(--bright) }
summary { cursor:pointer;padding:3px 0 }
.settingrow { display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:42px;font-size:12px;color:var(--ink) }
.settingrow label { flex:1;min-width:0 }
select,.shortcut-row input { width:176px;max-width:55%;height:30px;background:var(--editor);border:1px solid var(--line);color:var(--ink);padding:4px 8px;border-radius:6px;font:inherit }
.number-control { display:flex;align-items:center;gap:8px;color:var(--muted) }
.number-control input { width:76px;height:30px;border:1px solid var(--line);border-radius:6px;background:var(--editor);color:var(--ink);padding:4px 8px;font:inherit }
input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible { outline:2px solid var(--accent);outline-offset:2px }
select:disabled { opacity:.45 }
.setting-switch { appearance:none;width:32px;height:18px;border:1px solid var(--line);border-radius:12px;background:var(--soft);position:relative;cursor:pointer;flex:none;transition:background .15s }
.setting-switch::before { content:'';position:absolute;left:3px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--muted);transition:transform .15s }
.setting-switch:checked { background:var(--accent);border-color:var(--accent) }
.setting-switch:checked::before { transform:translateX(14px);background:#fff }
.field-error { color:var(--yellow);font-size:11px;margin:5px 0 }
.settings-foot { display:flex;justify-content:flex-end;padding:12px 22px;border-top:1px solid var(--line);flex:none }
.close-btn { background:var(--accent);color:#fff;padding:7px 24px;border-radius:7px;font-size:12px;font-weight:600 }
.close-btn:hover { opacity:.9 }
.secondary-button { margin-top:12px;padding:6px 12px;border:1px solid var(--line);border-radius:6px;color:var(--bright);font-size:12px }
.secondary-button:hover { background:var(--hover) }
@media(max-width:560px) { .settings-nav { width:44px;padding:12px 4px }.settings-nav button { padding:10px;justify-content:center }.settings-nav span { display:none }.settings-content { padding:16px }.settings-head { padding:14px 16px } }
.fade-enter-active,.fade-leave-active { transition:opacity .15s }.fade-enter-from,.fade-leave-to { opacity:0 }
</style>
