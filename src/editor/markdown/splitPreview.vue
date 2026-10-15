<template>
  <div ref="previewContainerRef" class="split-preview-pane">
    <div
      ref="contentRef"
      class="split-preview-content markdown-body"
      role="region" aria-label="Markdown 只读预览" aria-readonly="true"
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
const emit = defineEmits<{ (e: 'scroll-line', line: number): void }>()

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
  if (props.tooLarge || previewText.value.length > 1024 * 1024) return '<p>文档较大，已暂停只读预览；源码仍可编辑。</p>'
  const tokens = md.parse(previewText.value || '', {})
  for (const token of tokens) if (token.map && token.nesting === 1 && token.level === 0) token.attrSet('data-source-line', String(token.map[0] + 1))
  return md.renderer.render(tokens, md.options, {})
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
  if (expectedTop !== null && Math.abs(element.scrollTop - expectedTop) <= 1) { expectedTop = null; return }
  expectedTop = null
  const items = anchors()
  const y = element.scrollTop
  let index = 0
  while (index + 1 < items.length && items[index + 1].top <= y) index++
  const start = items[index], end = items[index + 1]
  if (start) emit('scroll-line', end && end.top > start.top ? start.line + (end.line - start.line) * Math.max(0, (y - start.top) / (end.top - start.top)) : start.line)
}

let expectedTop: number | null = null
function anchors() {
  const element = contentRef.value
  if (!element) return []
  const top = element.getBoundingClientRect().top
  const items = Array.from(element.querySelectorAll<HTMLElement>('[data-source-line]')).map(node => ({ line: Number(node.dataset.sourceLine), top: node.getBoundingClientRect().top - top + element.scrollTop }))
  items.push({ line: previewText.value.split('\n').length + 1, top: element.scrollHeight })
  return items
}
function syncScroll(line: number) {
  const element = contentRef.value, items = anchors()
  if (!element || !items.length) return
  let index = 0
  while (index + 1 < items.length && items[index + 1].line <= line) index++
  const start = items[index], end = items[index + 1]
  const next = start.top + (end && end.line > start.line ? (end.top - start.top) * Math.max(0, (line - start.line) / (end.line - start.line)) : 0)
  if (Math.abs(element.scrollTop - next) > 1) { element.scrollTop = next; expectedTop = element.scrollTop }
}

defineExpose({ syncScroll })
</script>

<style scoped>
.split-preview-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width:0;
  background: var(--editor);
  border-left: 1px solid var(--line);
  overflow: hidden;
  height: 100%;
}


.split-preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 18px;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--editor-size);
  line-height: var(--editor-line);
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
@media(max-width:760px) { .split-preview-content { padding:12px 10px } }
</style>
