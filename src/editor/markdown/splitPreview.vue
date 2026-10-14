<template>
  <div ref="previewContainerRef" class="split-preview-pane">
    <div class="split-preview-header">
      <span class="preview-badge">只读 HTML 预览</span>
      <span class="preview-note">Ctrl+点击打开网页链接</span>
    </div>
    <div
      ref="contentRef"
      class="split-preview-content markdown-body"
      v-html="renderedHtml"
      @click="onLinkClick"
      @scroll="onScroll"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import MarkdownIt from 'markdown-it'
import { openMarkdownLink } from './links'

const props = defineProps<{
  content: string
  tooLarge?: boolean
}>()
const emit = defineEmits<{ (e: 'scroll-ratio', ratio: number): void }>()

const previewContainerRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)

// 实例化安全 markdown-it（禁用原始 html 执行）
const md = new MarkdownIt({
  html: false,
  xhtmlOut: false,
  breaks: true,
  langPrefix: 'language-',
  linkify: true,
  typographer: true,
})
// Images degrade to text. Rendering must not fetch remote resources implicitly.
md.renderer.rules.image = (tokens, index) => `<span class="md-image-source">${md.utils.escapeHtml(`![${tokens[index].content}](${tokens[index].attrGet('src') || ''})`)}</span>`
const previewText = ref(props.content)
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => props.content, content => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { previewText.value = content }, 80)
})
onUnmounted(() => { if (timer) clearTimeout(timer) })

const renderedHtml = computed(() => {
  return !props.tooLarge && previewText.value.length <= 1024 * 1024 ? md.render(previewText.value || '') : '<p>文档较大，已暂停只读 HTML 预览；源码仍可编辑。</p>'
})
function onLinkClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a')
  if (!anchor) return
  event.preventDefault()
  if (event.ctrlKey || event.metaKey) void openMarkdownLink(anchor.getAttribute('href') || '')
}
function onScroll() {
  const element = contentRef.value
  if (!element) return
  const max = element.scrollHeight - element.clientHeight
  if (max > 0) emit('scroll-ratio', element.scrollTop / max)
}

// 提供给外部调用的滚动同步方法（按百分比同步）
function syncScroll(ratio: number) {
  if (contentRef.value) {
    const maxScroll = contentRef.value.scrollHeight - contentRef.value.clientHeight
    if (maxScroll > 0) {
      const next = maxScroll * ratio
      if (Math.abs(contentRef.value.scrollTop - next) > 1) contentRef.value.scrollTop = next
    }
  }
}

defineExpose({ syncScroll })
</script>

<style scoped>
.split-preview-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--paper);
  border-left: 1px solid var(--line);
  overflow: hidden;
  height: 100%;
}

.split-preview-header {
  height: 28px;
  background: var(--bar);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 10px;
  color: var(--muted);
  flex: none;
}

.preview-badge {
  background: var(--accentbg);
  color: var(--accent);
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}

.split-preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
}

/* 预览样式 */
:deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
  color: var(--bright);
  font-weight: 700;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

:deep(h1) {
  font-size: 1.8em;
  border-bottom: 1px solid var(--line);
  padding-bottom: 4px;
}

:deep(h2) {
  font-size: 1.4em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding-bottom: 3px;
}

:deep(code) {
  font-family: var(--font-mono);
  background: var(--soft);
  color: var(--pink);
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 0.9em;
}

:deep(pre) {
  background: var(--editor);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}

:deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}

:deep(blockquote) {
  border-left: 3px solid var(--accent);
  background: rgba(156, 147, 244, 0.04);
  padding: 4px 12px;
  margin: 12px 0;
  color: var(--sub);
  font-style: italic;
}

:deep(a) {
  color: var(--blue);
  text-decoration: underline;
}

:deep(hr) {
  border: none;
  height: 1px;
  background: var(--line);
  margin: 16px 0;
}

:deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

:deep(th), :deep(td) {
  border: 1px solid var(--line);
  padding: 6px 10px;
  text-align: left;
}

:deep(th) {
  background: var(--soft);
  font-weight: 600;
}
</style>
