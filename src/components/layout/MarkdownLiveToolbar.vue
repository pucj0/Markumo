<template>
  <div
    v-if="state"
    ref="root"
    class="md-live-toolbar"
    role="toolbar"
    aria-label="Markdown 格式工具栏"
    @keydown.esc="onEscape"
  >
    <select
      class="md-toolbar-heading"
      :value="state.heading"
      :disabled="formattingDisabled"
      aria-label="段落样式"
      title="段落样式"
      @change="changeHeading"
    >
      <option v-for="option in headingOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>

    <span class="md-toolbar-divider" aria-hidden="true"></span>

    <button
      v-for="item in textFormats"
      :key="item.format"
      type="button"
      class="md-toolbar-btn md-toolbar-text"
      :class="{ active: isActive(item.format) }"
      :disabled="formattingDisabled"
      :aria-label="item.label"
      :aria-pressed="isActive(item.format)"
      :title="tooltip(item.label, item.shortcut)"
      @mousedown.prevent
      @click="apply(item.format)"
    >{{ item.text }}</button>

    <button type="button" class="md-toolbar-btn md-toolbar-wide" :class="{ active: state.link }" :disabled="formattingDisabled" aria-label="插入链接" :aria-pressed="state.link" :title="tooltip('插入链接', 'Mod+K')" @mousedown.prevent @click="apply('link')">🔗</button>
    <button type="button" class="md-toolbar-btn md-toolbar-wide" :disabled="formattingDisabled" aria-label="插入图片" :title="tooltip('插入图片', 'Mod+Shift+I')" @mousedown.prevent @click="apply('image')">▧</button>

    <span class="md-toolbar-divider md-toolbar-wide" aria-hidden="true"></span>
    <button type="button" class="md-toolbar-btn md-toolbar-wide" :class="{ active: state.bullet }" :disabled="formattingDisabled" aria-label="无序列表" :aria-pressed="state.bullet" title="无序列表" @mousedown.prevent @click="apply('bullet')">•</button>
    <button type="button" class="md-toolbar-btn md-toolbar-wide" :class="{ active: state.ordered }" :disabled="formattingDisabled" aria-label="有序列表" :aria-pressed="state.ordered" title="有序列表" @mousedown.prevent @click="apply('ordered')">1.</button>
    <button type="button" class="md-toolbar-btn md-toolbar-wide" :class="{ active: state.task }" :disabled="formattingDisabled" aria-label="任务列表" :aria-pressed="state.task" title="任务列表" @mousedown.prevent @click="apply('task')">☑</button>
    <button type="button" class="md-toolbar-btn md-toolbar-wide" :class="{ active: state.quote }" :disabled="formattingDisabled" aria-label="引用" :aria-pressed="state.quote" title="引用" @mousedown.prevent @click="apply('quote')">❝</button>
    <button type="button" class="md-toolbar-btn md-toolbar-wide" :class="{ active: state.codeBlock }" :disabled="formattingDisabled" aria-label="代码块" :aria-pressed="state.codeBlock" :title="tooltip('代码块', 'Mod+Shift+K')" @mousedown.prevent @click="apply('code-block')">{ }</button>
    <button type="button" class="md-toolbar-btn md-toolbar-wide" :disabled="formattingDisabled" aria-label="表格" :title="tooltip('表格', 'Mod+T')" @mousedown.prevent @click="apply('table')">▦</button>
    <button type="button" class="md-toolbar-btn md-toolbar-wide" :disabled="formattingDisabled" aria-label="水平分隔线" title="水平分隔线" @mousedown.prevent @click="apply('rule')">―</button>

    <span class="md-toolbar-spacer" aria-hidden="true"></span>

    <button type="button" class="md-toolbar-btn" :disabled="historyDisabled || !state.canUndo" aria-label="撤销" :title="tooltip('撤销', 'Mod+Z')" @mousedown.prevent @click="history(false)">↶</button>
    <button type="button" class="md-toolbar-btn" :disabled="historyDisabled || !state.canRedo" aria-label="重做" :title="tooltip('重做', 'Mod+Shift+Z')" @mousedown.prevent @click="history(true)">↷</button>

    <div class="md-toolbar-more-wrap">
      <button
        ref="moreButton"
        type="button"
        class="md-toolbar-btn md-toolbar-more"
        aria-label="更多 Markdown 操作"
        aria-haspopup="menu"
        :aria-expanded="moreOpen"
        title="更多 Markdown 操作"
        @mousedown.prevent
        @click="toggleMore"
      >⋯</button>
      <div v-if="moreOpen" ref="moreMenu" class="md-live-more" role="menu" aria-label="更多 Markdown 操作">
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="more('footnote')">脚注</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="more('link-reference')">链接引用</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="more('math')">公式块</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="more('toc')">内容目录</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled || state.hasYaml" @mousedown.prevent @click="more('yaml')">YAML Front Matter</button>
        <div class="md-live-more-separator" role="separator"></div>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="moreFormat('link')">链接</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="moreFormat('image')">图片</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="moreFormat('table')">表格</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="moreFormat('code-block')">代码块</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="moreFormat('quote')">引用</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="moreFormat('bullet')">无序列表</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="moreFormat('ordered')">有序列表</button>
        <button type="button" role="menuitem" :disabled="formattingDisabled" @mousedown.prevent @click="moreFormat('task')">任务列表</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { MarkdownFormat } from '../../editor/markdown/formatCommands'
import type { MarkdownToolbarCommand } from '../../editor/markdown/wysiwyg/contracts'
import { shortcutLabel } from '../../features/shell/editorSettings'

const props = defineProps<{ manager: DocumentManager; pane: string; revision: number }>()
const state = computed(() => { props.revision; return props.manager.markdownToolbarState(props.pane) })
const formattingDisabled = computed(() => !state.value || state.value.readOnly || state.value.composing || state.value.inCodeBlock)
const historyDisabled = computed(() => !state.value || state.value.readOnly || state.value.composing)
const moreOpen = ref(false)
const root = ref<HTMLElement | null>(null)
const moreButton = ref<HTMLButtonElement | null>(null)
const moreMenu = ref<HTMLElement | null>(null)

const headingOptions = [
  { value: 0, label: '正文' },
  { value: 1, label: 'H1' }, { value: 2, label: 'H2' }, { value: 3, label: 'H3' },
  { value: 4, label: 'H4' }, { value: 5, label: 'H5' }, { value: 6, label: 'H6' },
]
const textFormats = [
  { format: 'bold' as MarkdownFormat, text: 'B', label: '加粗', shortcut: 'Mod+B' },
  { format: 'italic' as MarkdownFormat, text: 'I', label: '斜体', shortcut: 'Mod+I' },
  { format: 'strike' as MarkdownFormat, text: 'S', label: '删除线', shortcut: 'Mod+Shift+X' },
  { format: 'inline-code' as MarkdownFormat, text: '</>', label: '行内代码', shortcut: 'Mod+`' },
]

function isActive(format: MarkdownFormat) {
  const current = state.value
  if (!current) return false
  return format === 'bold' ? current.bold
    : format === 'italic' ? current.italic
      : format === 'strike' ? current.strike
        : format === 'inline-code' ? current.inlineCode
          : format === 'link' ? current.link
            : format === 'quote' ? current.quote
              : format === 'bullet' ? current.bullet
                : format === 'ordered' ? current.ordered
                  : format === 'task' ? current.task
                    : format === 'code-block' ? current.codeBlock
                      : false
}

function tooltip(label: string, shortcut?: string) {
  return shortcut ? `${label} (${shortcutLabel(shortcut)})` : label
}

function focusEditor() {
  props.manager.focusPane(props.pane, true)
}

function apply(format: MarkdownFormat) {
  closeMore(false)
  if (formattingDisabled.value) return
  props.manager.formatMarkdown(format, props.pane)
  focusEditor()
}

function changeHeading(event: Event) {
  closeMore(false)
  if (formattingDisabled.value) return
  const level = Number((event.target as HTMLSelectElement).value)
  props.manager.formatMarkdown(`heading-${level}` as MarkdownFormat, props.pane)
  focusEditor()
}

function history(forward: boolean) {
  closeMore(false)
  if (historyDisabled.value) return
  props.manager.markdownHistory(forward, props.pane)
}

function more(command: MarkdownToolbarCommand) {
  closeMore(false)
  if (formattingDisabled.value) return
  props.manager.insertMarkdown(command, props.pane)
  focusEditor()
}

function moreFormat(format: MarkdownFormat) {
  closeMore(false)
  apply(format)
}

function toggleMore() {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) void nextTick(() => moreMenu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
}

function closeMore(focusButton = true) {
  if (!moreOpen.value) return
  moreOpen.value = false
  if (focusButton) void nextTick(() => moreButton.value?.focus())
}

function onEscape(event: KeyboardEvent) {
  if (!moreOpen.value) return
  event.preventDefault()
  closeMore()
}

function outside(event: PointerEvent) {
  if (moreOpen.value && root.value && !root.value.contains(event.target as Node)) closeMore(false)
}

onMounted(() => document.addEventListener('pointerdown', outside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
</script>

<style scoped>
.md-live-toolbar {
  position: relative;
  flex: none;
  min-width: 0;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 10px;
  box-sizing: border-box;
  background: var(--bar);
  border-bottom: 1px solid var(--line);
  color: var(--text);
  font: var(--ui-small-font-size)/1 var(--font-sans);
  overflow: visible;
  container-type: inline-size;
}
.md-toolbar-heading {
  height: 28px;
  max-width: 76px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: var(--ui-small-font-size)/1 var(--font-sans);
  outline: none;
  cursor: pointer;
}
.md-toolbar-heading:hover:not(:disabled), .md-toolbar-heading:focus-visible { background: var(--hover); border-color: var(--line); }
.md-toolbar-heading:disabled { opacity: .45; cursor: default; }
.md-toolbar-divider { width: 1px; height: 16px; flex: none; margin: 0 3px; background: var(--line); }
.md-toolbar-btn {
  flex: none;
  width: 30px;
  height: 28px;
  min-width: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font: 600 var(--ui-small-font-size)/1 var(--font-sans);
  cursor: pointer;
  white-space: nowrap;
}
.md-toolbar-btn:hover:not(:disabled), .md-toolbar-btn:focus-visible { background: var(--hover); color: var(--ink); outline: none; border-color: var(--line); }
.md-toolbar-btn.active { color: var(--accent); background: var(--accentbg); }
.md-toolbar-btn:disabled { opacity: .38; cursor: default; }
.md-toolbar-text { font-family: var(--font-sans); }
.md-toolbar-spacer { flex: 1 1 auto; min-width: 2px; }
.md-toolbar-more-wrap { position: relative; flex: none; }
.md-live-more {
  position: absolute;
  right: 0;
  top: calc(100% + 3px);
  z-index: 40;
  min-width: 190px;
  max-height: min(360px, 55vh);
  overflow-y: auto;
  padding: 4px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0,0,0,.18);
}
.md-live-more button {
  display: block;
  width: 100%;
  min-height: 26px;
  padding: 3px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: var(--ui-small-font-size)/var(--ui-line-height) var(--font-sans);
  cursor: pointer;
}
.md-live-more button:hover:not(:disabled), .md-live-more button:focus-visible { background: var(--hover); color: var(--bright); outline: none; }
.md-live-more button:disabled { opacity: .42; cursor: default; }
.md-live-more-separator { height: 1px; margin: 4px 6px; background: var(--line); }
@container (max-width: 650px) {
  .md-toolbar-wide { display: none; }
  .md-toolbar-heading { max-width: 68px; }
}
@container (max-width: 380px) {
  .md-toolbar-heading { max-width: 58px; }
  .md-toolbar-btn { width: 24px; min-width: 24px; }
}
</style>
