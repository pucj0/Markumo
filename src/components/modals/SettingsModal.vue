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
            <!-- 1. 外观 -->
            <section id="settings-appearance" class="settings-section">
              <h3>外观</h3>
              <div class="settingrow"><label for="settings-theme">颜色主题</label><select id="settings-theme" :value="theme" @change="$emit('update:theme', ($event.target as HTMLSelectElement).value as ThemePreference)"><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></div>
              <div class="settingrow"><label for="settings-ui-size">界面字号</label><div class="number-control"><input id="settings-ui-size" type="number" min="12" max="20" step="1" :value="uiFontDraft" :aria-invalid="!!uiFontError" aria-describedby="ui-font-hint" @input="updateUiFont" @blur="finishUiFont" @keydown.enter.prevent="finishUiFont" /><span>px</span><button class="reset-font" title="恢复默认界面字号 14px" aria-label="恢复默认界面字号" @click="emit('update:uiFontSize', 14)">恢复默认</button></div></div>
              <p v-if="uiFontError" class="field-error" role="alert">{{ uiFontError }}</p>
              <p id="ui-font-hint" class="setting-hint">仅调整界面文字；编辑器与 Markdown 正文字号分别设置。</p>
              <div class="settingrow"><label for="settings-font">编辑器字体</label><select id="settings-font" :value="fontFamily" @change="$emit('update:fontFamily', ($event.target as HTMLSelectElement).value as EditorSettings['fontFamily'])"><option value="system">系统等宽字体</option><option value="consolas">Consolas</option><option value="cascadia">Cascadia Code</option></select></div>
              <div class="settingrow"><label for="settings-size">编辑器字号</label><div class="number-control"><input id="settings-size" type="number" min="10" max="24" step="1" :value="fontDraft" :aria-invalid="!!fontError" @input="updateFont" @blur="finishFont" @keydown.enter.prevent="finishFont" /><span>px</span></div></div>
              <p v-if="fontError" class="field-error" role="alert">{{ fontError }}</p>
            </section>

            <!-- 2. 编辑 -->
            <section id="settings-editor" class="settings-section">
              <h3>编辑</h3>
              <div class="settingrow"><label for="settings-wrap">自动软换行</label><input id="settings-wrap" class="setting-switch" type="checkbox" :checked="wordWrap" @change="$emit('update:wordWrap', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-outline">显示文档大纲</label><input id="settings-outline" class="setting-switch" type="checkbox" :checked="showOutline" @change="$emit('update:showOutline', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-indent">缩进宽度</label><select id="settings-indent" :value="indentSize" @change="$emit('update:indentSize', Number(($event.target as HTMLSelectElement).value))"><option v-for="n in 8" :key="n" :value="n">{{ n }}</option></select></div>
              <div class="settingrow"><label for="settings-tabs">使用 Tab 缩进</label><input id="settings-tabs" class="setting-switch" type="checkbox" :checked="useTabs" @change="$emit('update:useTabs', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-tree-click">文件夹展开方式</label><select id="settings-tree-click" :value="treeClickMode || 'double'" @change="$emit('update:treeClickMode', ($event.target as HTMLSelectElement).value as ('double' | 'single'))"><option value="double">双击展开/收起（默认）</option><option value="single">单击展开/收起</option></select></div>
              <p class="setting-hint">文件始终单击预览，双击固定；修改文件后自动固定标签。</p>
            </section>

            <!-- 3. 保存 -->
            <section id="settings-save" class="settings-section">
              <h3>保存</h3>
              <div class="settingrow"><label for="settings-autosave">自动保存</label><input id="settings-autosave" class="setting-switch" type="checkbox" :checked="autoSave" @change="$emit('update:autoSave', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-save-delay">自动保存延迟</label><select id="settings-save-delay" :disabled="!autoSave" :value="autoSaveDelay" @change="$emit('update:autoSaveDelay', Number(($event.target as HTMLSelectElement).value))"><option v-if="!delays.includes(autoSaveDelay)" :value="autoSaveDelay">{{ autoSaveDelay / 1000 }} 秒</option><option v-for="delay in delays" :key="delay" :value="delay">{{ delay / 1000 }} 秒</option></select></div>
            </section>

            <!-- 4. Markdown -->
            <section id="settings-markdown" class="settings-section">
              <h3>Markdown</h3>
              <div class="settingrow"><label for="settings-md-width">正文宽度</label><input id="settings-md-width" type="number" min="480" max="1400" :value="markdownTypography?.width || 860" @change="updateMd('width', Number(($event.target as HTMLInputElement).value))" /></div>
              <div class="settingrow"><label for="settings-md-size">正文字号</label><input id="settings-md-size" type="number" min="12" max="28" :value="markdownTypography?.fontSize || 16" @change="updateMd('fontSize', Number(($event.target as HTMLInputElement).value))" /></div>
              <div class="settingrow"><label for="settings-md-height">正文行高</label><input id="settings-md-height" type="number" min="1.2" max="2.4" step="0.1" :value="markdownTypography?.lineHeight || 1.7" @change="updateMd('lineHeight', Number(($event.target as HTMLInputElement).value))" /></div>
              <div class="settingrow"><label for="settings-md-font">正文字体</label><select id="settings-md-font" :value="markdownTypography?.fontFamily || 'system'" @change="updateMd('fontFamily', ($event.target as HTMLSelectElement).value)"><option value="system">中英文系统字体</option><option value="serif">衬线字体</option><option value="mono">等宽字体</option></select></div>
              <div class="settingrow"><label for="settings-md-numbers">代码块行号</label><input id="settings-md-numbers" type="checkbox" :checked="markdownTypography?.codeLineNumbers ?? true" @change="updateMd('codeLineNumbers', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-md-wrap">代码块自动换行</label><input id="settings-md-wrap" type="checkbox" :checked="markdownTypography?.codeWrap ?? false" @change="updateMd('codeWrap', ($event.target as HTMLInputElement).checked)" /></div>
              <div class="settingrow"><label for="settings-md-mode">Markdown 默认模式</label><select id="settings-md-mode" :value="defaultMdMode" @change="$emit('update:defaultMdMode', ($event.target as HTMLSelectElement).value as MarkdownMode)"><option value="live">即时排版</option><option value="source">源码</option><option value="split">双栏</option></select></div>
              <ImageSettings :global-rules="imageRules" :document-rules="documentImageRules" :document-path="markdownPath" :document-name="markdownName" @global="emit('update:imageRules', $event)" @document="emit('update:documentImageRules', $event)" />
            </section>

            <!-- 5. 快捷键（全新独立完整配置体系） -->
            <section id="settings-shortcuts" class="settings-section shortcuts-management-section">
              <header class="shortcuts-toolbar">
                <div class="toolbar-field">
                  <label for="settings-keymap-preset">键位方案</label>
                  <select
                    id="settings-keymap-preset"
                    :value="keymapPreset || 'lightedit'"
                    class="preset-select"
                    @change="onPresetChange(($event.target as HTMLSelectElement).value as KeymapPresetId)"
                  >
                    <option v-for="preset in Object.values(keymapPresets)" :key="preset.id" :value="preset.id">
                      {{ preset.name }}
                    </option>
                  </select>
                </div>

                <div class="toolbar-search">
                  <input
                    v-model="searchQuery"
                    type="text"
                    placeholder="搜索快捷键或命令名称…"
                    class="shortcut-search-input"
                    aria-label="搜索快捷键"
                  />
                  <button v-if="searchQuery" class="clear-search-btn" title="清除搜索" @click="searchQuery = ''">✕</button>
                </div>

                <button type="button" class="reset-all-btn" title="重置为当前方案的默认快捷键" @click="resetAllToDefault">
                  恢复默认
                </button>
              </header>

              <!-- 按分类展示命令列表 -->
              <div class="shortcuts-groups">
                <div
                  v-for="cat in filteredCategories"
                  :key="cat"
                  class="shortcut-category-group"
                >
                  <h4 class="category-title">{{ categoryLabels[cat] }}</h4>
                  <div class="category-commands">
                    <div
                      v-for="cmd in getCategoryCommands(cat)"
                      :key="cmd.id"
                      class="shortcut-item-row"
                    >
                      <div class="cmd-info">
                        <span class="cmd-label">{{ cmd.label }}</span>
                        <span class="cmd-desc">{{ cmd.description }}</span>
                      </div>

                      <div class="cmd-recorder">
                        <ShortcutRecorder
                          :command-id="cmd.id"
                          :binding="localShortcuts[cmd.id]"
                          :default-binding="defaultBindings[cmd.id]"
                          :all-bindings="localShortcuts"
                          :aria-label="`快捷键 ${cmd.label}`"
                          @update:binding="onUpdateSingleBinding(cmd.id, $event)"
                          @reassign="onReassignBinding"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="filteredCategories.length === 0" class="empty-shortcuts">
                  无匹配的命令快捷键
                </div>
              </div>
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
import { nextTick, ref, computed, watch } from 'vue'
import Icon from '../common/Icon.vue'
import ImageSettings from './ImageSettings.vue'
import ShortcutRecorder from '../common/ShortcutRecorder.vue'
import type { ImageRules } from '../../editor/markdown/imageImport'
import type { EditorSettings } from '../../features/shell/editorSettings'
import type { ThemePreference, MarkdownMode } from '../../types'
import { defaultMarkdownTypography, type MarkdownTypography } from '../../editor/markdown/wysiwyg/contracts'
import {
  type KeymapPresetId,
  type CommandCategory,
  categoryLabels,
  allCommands,
  keymapPresets,
  getPresetBindings,
} from '../../features/shell/keybindings'

const props = defineProps<{
  markdownTypography?: MarkdownTypography
  theme: ThemePreference
  uiFontSize: number
  fontSize: number
  wordWrap: boolean
  showOutline: boolean
  defaultMdMode: MarkdownMode
  fontFamily: EditorSettings['fontFamily']
  indentSize: number
  useTabs: boolean
  shortcuts: EditorSettings['shortcuts']
  keymapPreset?: KeymapPresetId
  autoSave: boolean
  autoSaveDelay: number
  treeClickMode?: 'double' | 'single'
  imageRules: ImageRules
  documentImageRules: ImageRules | null
  markdownPath?: string
  markdownName?: string
}>()

const emit = defineEmits<{
  (e: 'update:markdownTypography', value: MarkdownTypography): void
  (e: 'update:theme', val: ThemePreference): void
  (e: 'update:uiFontSize', val: number): void
  (e: 'update:fontSize', val: number): void
  (e: 'update:wordWrap', val: boolean): void
  (e: 'update:showOutline', val: boolean): void
  (e: 'update:defaultMdMode', val: MarkdownMode): void
  (e: 'update:fontFamily', val: EditorSettings['fontFamily']): void
  (e: 'update:indentSize', val: number): void
  (e: 'update:useTabs', val: boolean): void
  (e: 'update:treeClickMode', val: 'double' | 'single'): void
  (e: 'update:keymapPreset', val: KeymapPresetId): void
  (e: 'update:shortcuts', val: Record<string, string>): void
  (e: 'update:autoSave', val: boolean): void
  (e: 'update:autoSaveDelay', val: number): void
  (e: 'update:imageRules', val: ImageRules): void
  (e: 'update:documentImageRules', val: ImageRules | null): void
}>()

const { visible, dialogRef, open, close, handleKeydown } = useModal()

function updateMd(key: keyof MarkdownTypography, value: number | string | boolean) {
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (key === 'width' && (value < 480 || value > 1400)) ||
      (key === 'fontSize' && (value < 12 || value > 28)) ||
      (key === 'lineHeight' && (value < 1.2 || value > 2.4)))
  ) {
    return
  }
  emit('update:markdownTypography', {
    ...(props.markdownTypography || defaultMarkdownTypography()),
    [key]: value,
  })
}

const contentRef = ref<HTMLElement | null>(null)
const uiFontDraft = ref(String(props.uiFontSize)), uiFontError = ref('')
watch(() => props.uiFontSize, value => { uiFontDraft.value = String(value) })

function updateUiFont(event: Event) {
  uiFontDraft.value = (event.target as HTMLInputElement).value
  const value = Number(uiFontDraft.value)
  uiFontError.value = !uiFontDraft.value || !Number.isInteger(value) || value < 12 || value > 20 ? '请输入 12–20 的整数字号' : ''
  if (!uiFontError.value) emit('update:uiFontSize', value)
}
function finishUiFont() { uiFontDraft.value = String(props.uiFontSize); uiFontError.value = '' }

const activeSection = ref('appearance')
const fontDraft = ref(String(props.fontSize)), fontError = ref('')
const delays = [500, 1500, 3000, 5000]

const sections = [
  { id: 'appearance', title: '外观', icon: 'sun' },
  { id: 'editor', title: '编辑', icon: 'font' },
  { id: 'save', title: '保存', icon: 'save' },
  { id: 'markdown', title: 'Markdown', icon: 'files' },
  { id: 'shortcuts', title: '快捷键', icon: 'keyboard' },
]

watch(() => props.fontSize, value => { fontDraft.value = String(value) })
watch(visible, value => {
  if (value) {
    finishUiFont()
    localShortcuts.value = { ...props.shortcuts }
    fontDraft.value = String(props.fontSize)
    fontError.value = ''
    activeSection.value = 'appearance'
  }
})

function goToSection(id: string) {
  activeSection.value = id
  contentRef.value?.querySelector(`#settings-${id}`)?.scrollIntoView({ block: 'start' })
}

function updateFont(event: Event) {
  fontDraft.value = (event.target as HTMLInputElement).value
  const value = Number(fontDraft.value)
  fontError.value = !fontDraft.value || !Number.isInteger(value) || value < 10 || value > 24 ? '请输入 10–24 的整数字号' : ''
  if (!fontError.value) emit('update:fontSize', value)
}
function finishFont() { fontDraft.value = String(props.fontSize); fontError.value = '' }

// --- 快捷键管理逻辑 ---
const localShortcuts = ref<Record<string, string>>({ ...props.shortcuts })
const searchQuery = ref('')

watch(() => props.shortcuts, next => {
  localShortcuts.value = { ...next }
}, { deep: true })

const currentPresetId = computed<KeymapPresetId>(() => props.keymapPreset || 'lightedit')
const defaultBindings = computed(() => getPresetBindings(currentPresetId.value))

function onPresetChange(newPreset: KeymapPresetId) {
  emit('update:keymapPreset', newPreset)
  const presetDefaults = getPresetBindings(newPreset)
  localShortcuts.value = { ...presetDefaults }
  emit('update:shortcuts', { ...presetDefaults })
}

function resetAllToDefault() {
  const presetDefaults = getPresetBindings(currentPresetId.value)
  localShortcuts.value = { ...presetDefaults }
  emit('update:shortcuts', { ...presetDefaults })
}

function onUpdateSingleBinding(cmdId: string, binding: string) {
  localShortcuts.value[cmdId] = binding
  emit('update:shortcuts', { ...localShortcuts.value })
}

function onReassignBinding(payload: { newBinding: string; takeFromCommandId: string }) {
  // 解绑原命令
  if (payload.takeFromCommandId) {
    localShortcuts.value[payload.takeFromCommandId] = ''
  }
  emit('update:shortcuts', { ...localShortcuts.value })
}

// 搜索与分类过滤
const filteredCommands = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return allCommands
  return allCommands.filter(cmd => {
    const labelMatch = cmd.label.toLowerCase().includes(q)
    const idMatch = cmd.id.toLowerCase().includes(q)
    const binding = localShortcuts.value[cmd.id] || ''
    const bindingMatch = binding.toLowerCase().includes(q)
    return labelMatch || idMatch || bindingMatch
  })
})

const filteredCategories = computed<CommandCategory[]>(() => {
  const categories: CommandCategory[] = [
    'file',
    'edit',
    'markdown',
    'search',
    'split',
    'navigation',
    'view',
    'general',
  ]
  return categories.filter(cat =>
    filteredCommands.value.some(cmd => cmd.category === cat)
  )
})

function getCategoryCommands(cat: CommandCategory) {
  return filteredCommands.value.filter(cmd => cmd.category === cat)
}

async function openSection(id: string) {
  open()
  await nextTick()
  goToSection(id)
}

defineExpose({ open, close, visible, openSection })
</script>

<style scoped>
.settingsoverlay { position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(3px);display:flex;justify-content:center;align-items:center;z-index:999;padding:16px }
.settings { width:760px;max-width:100%;height:640px;max-height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow) }
.settings-head { display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line);flex:none }
.settings-title { display:flex;align-items:center;gap:10px;color:var(--bright) }
h2 { margin:0;font-size: calc(var(--ui-font-size) + 2px);font-weight:600 }
.icon-button { display:grid;place-items:center;width:var(--ui-control-height);height:var(--ui-control-height);border-radius:6px;color:var(--muted) }
.icon-button:hover { background:var(--hover);color:var(--bright) }
.settings-body { display:flex;flex:1;min-height:0 }
.settings-nav { flex:none;width:calc(140px + (var(--ui-font-size) - 14px) * 5);padding:16px 10px;background:var(--sidebar);border-right:1px solid var(--line) }
.settings-nav button { width:100%;display:flex;align-items:center;gap:9px;padding:9px 12px;margin-bottom:4px;border-radius:7px;color:var(--sub);font-size: var(--ui-font-size);text-align:left }
.settings-nav button:hover { background:var(--hover) }
.settings-nav button.active { background:var(--accentbg);color:var(--accent);font-weight:600 }
.settings-content { flex:1;min-width:0;overflow-y:auto;overscroll-behavior:contain;padding:20px 26px }
.settings-section { scroll-margin-top:20px;padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--line) }
.settings-section:last-child { border-bottom:0;margin-bottom:0 }
h3 { margin:0 0 12px;font-size: var(--ui-font-size);font-weight:600;color:var(--bright) }
.settingrow { display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:calc(var(--ui-control-height) + 10px);font-size: var(--ui-font-size);color:var(--ink) }
.settingrow label { flex:1;min-width:0 }
select { width:176px;max-width:55%;height:var(--ui-control-height);background:var(--editor);border:1px solid var(--line);color:var(--ink);padding:4px 8px;border-radius:6px;font:inherit }
.number-control { display:flex;align-items:center;gap:8px;color:var(--muted) }
.number-control input { width:76px;height:var(--ui-control-height);border:1px solid var(--line);border-radius:6px;background:var(--editor);color:var(--ink);padding:4px 8px;font:inherit }
input:focus-visible,select:focus-visible,button:focus-visible { outline:2px solid var(--accent);outline-offset:2px }
select:disabled { opacity:.45 }
.reset-font { padding:4px 8px;border:1px solid var(--line);border-radius:5px;color:var(--sub);font-size:var(--ui-small-font-size);min-height:var(--ui-control-height) }
.setting-hint { font-size:var(--ui-small-font-size);color:var(--muted);margin:4px 0 12px }
.setting-switch { appearance:none;width:32px;height:18px;border:1px solid var(--line);border-radius:12px;background:var(--soft);position:relative;cursor:pointer;flex:none;transition:background .15s }
.setting-switch::before { content:'';position:absolute;left:3px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--muted);transition:transform .15s }
.setting-switch:checked { background:var(--accent);border-color:var(--accent) }
.setting-switch:checked::before { transform:translateX(14px);background:#fff }
.field-error { color:var(--yellow);font-size: var(--ui-small-font-size);margin:5px 0 }
.settings-foot { display:flex;justify-content:flex-end;padding:12px 22px;border-top:1px solid var(--line);flex:none }
.close-btn { background:var(--accent);color:#fff;padding:7px 24px;border-radius:7px;font-size: var(--ui-font-size);font-weight:600;cursor:pointer }
.close-btn:hover { opacity:.9 }

/* 快捷键重构样式 */
.shortcuts-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 16px;
}

.toolbar-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-field label {
  font-size: 13px;
  color: var(--sub);
  white-space: nowrap;
}

.preset-select {
  width: 170px;
  height: 28px;
  font-size: 12px;
}

.toolbar-search {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.shortcut-search-input {
  width: 100%;
  height: 28px;
  background: var(--editor);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--ink);
  font-size: 12px;
  padding: 0 24px 0 8px;
}

.clear-search-btn {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
}

.reset-all-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line);
  background: var(--bar);
  color: var(--sub);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.reset-all-btn:hover {
  background: var(--hover);
  color: var(--bright);
}

.shortcuts-groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.category-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  padding-bottom: 4px;
  border-bottom: 1px dashed var(--line);
}

.category-commands {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.shortcut-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-radius: 6px;
  transition: background 0.12s;
}

.shortcut-item-row:hover {
  background: var(--soft);
}

.cmd-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.cmd-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--bright);
}

.cmd-desc {
  font-size: 11px;
  color: var(--muted);
}

.empty-shortcuts {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

@media(max-width:560px) {
  .settings-nav { width:44px;padding:12px 4px }.settings-nav button { padding:10px;justify-content:center }.settings-nav span { display:none }.settings-content { padding:16px }.settings-head { padding:14px 16px }
}
.fade-enter-active,.fade-leave-active { transition:opacity .15s }.fade-enter-from,.fade-leave-to { opacity:0 }
</style>
