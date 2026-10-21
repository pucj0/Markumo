<template>
  <div class="split-preview-pane" :data-image-border="imageBorder !== false">
    <div
      ref="contentRef"
      class="split-preview-content markdown-body"
      role="region"
      aria-label="Markdown 只读预览"
      aria-readonly="true"
      v-html="renderedHtml"
      @click="onContentClick"
      @scroll="onScroll"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { openMarkdownLink } from './links'
import { createMarkdownRenderer, type PreviewEnvironment } from './rendering'
import { renderMath } from './wysiwyg/renderers'
import { createMarkdownResources, mountMarkdownImage, type MarkdownResources } from './images'
import { textClipboard } from '../../features/shell/clipboard'
import { htmlForPreview, mountHtmlImages, type MountedImageHandle } from './html/SafeHtmlRenderer'

const props = defineProps<{
  content: string
  tooLarge?: boolean
  resources?: MarkdownResources
  resourceKey?: string
  imageBorder?: boolean
}>()
const emit = defineEmits<{
  (e: 'scroll-line', line: number): void
  (e: 'edit-image', from: number, snapshot: string): void
}>()

const contentRef = ref<HTMLElement | null>(null)

const revision = ref(0)
let disposed = false
const md = createMarkdownRenderer(() => {
  if (!disposed) revision.value++
})
const previewText = ref(props.content)
let timer: ReturnType<typeof setTimeout> | undefined

watch(() => props.content, content => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { previewText.value = content }, 60)
})

let mountedImages: ReturnType<typeof mountMarkdownImage>[] = []
let mountedHtmlImages: MountedImageHandle | undefined
let hydrateGeneration = 0

onUnmounted(() => {
  disposed = true
  if (timer) clearTimeout(timer)
  for (const image of mountedImages) image.destroy()
  mountedImages = []
  mountedHtmlImages?.destroy()
  mountedHtmlImages = undefined
})

const rendered = computed(() => {
  revision.value
  if (props.tooLarge || previewText.value.length > 1024 * 1024) {
    return { html: '<p>文档较大，已暂停只读预览；源码仍可编辑。</p>', slots: [] }
  }
  const environment: PreviewEnvironment = { slots: [] }
  const tokens = md.parse(previewText.value || '', environment)
  for (const token of tokens) {
    if (token.map && token.nesting === 1 && token.level === 0) {
      token.attrSet('data-source-line', String(token.map[0] + 1))
    }
  }
  const rawRendered = md.renderer.render(tokens, md.options, environment)
  return { html: htmlForPreview(rawRendered), slots: environment.slots || [] }
})
const renderedHtml = computed(() => rendered.value.html)

const fallbackResources = createMarkdownResources(() => undefined)

watch([renderedHtml, () => props.resources, () => props.resourceKey], async () => {
  const generation = ++hydrateGeneration
  const snapshot = previewText.value
  for (const image of mountedImages) image.destroy()
  mountedImages = []

  await nextTick()
  if (disposed || generation !== hydrateGeneration) return

  const slots = new Map(rendered.value.slots.map(slot => [slot.id, slot]))
  for (const host of contentRef.value?.querySelectorAll<HTMLElement>('[data-md-render]') || []) {
    const slot = slots.get(host.dataset.mdRender || '')
    if (!slot) continue
    const current = () => !disposed && generation === hydrateGeneration && snapshot === props.content
    void renderMath(host, slot.source, slot.kind === 'math-block', current).catch(error => {
      if (host.isConnected && current()) { host.classList.add('md-render-error'); host.textContent = String(error instanceof Error ? error.message : error) }
    })
  }

  // 绑定代码块复制按钮
  for (const button of Array.from(contentRef.value?.querySelectorAll<HTMLButtonElement>('[data-md-copy]') || [])) {
    button.onmousedown = event => event.preventDefault()
    button.onclick = async () => {
      const fenceEl = button.closest('.md-preview-fence')
      const code = fenceEl?.querySelector('code')?.textContent || ''
      try {
        await textClipboard.writeText(code.replace(/\n$/, ''))
        const originalHtml = button.innerHTML
        const checkIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m5 12 4 4L19 6"/></svg>`
        button.innerHTML = checkIcon
        button.title = '已复制'
        setTimeout(() => {
          if (button.isConnected) {
            button.innerHTML = originalHtml
            button.title = '复制代码'
          }
        }, 1500)
      } catch {
        window.dispatchEvent(new CustomEvent('editor-notice', { detail: '复制失败，请选中后复制' }))
      }
    }
  }

  // 挂载图片
  for (const host of Array.from(contentRef.value?.querySelectorAll<HTMLElement>('.md-image-slot') || []).slice(0, 64)) {
    const source = host.dataset.mdSource || ''
    const from = Number(host.dataset.sourceFrom || 0)
    mountedImages.push(
      mountMarkdownImage(
        host,
        source,
        host.dataset.mdAlt || '',
        props.resources || fallbackResources,
        () => emit('edit-image', from, snapshot),
        () => {
          // 图片尺寸测量完毕后，重新校准滚动锚点
          if (!disposed && generation === hydrateGeneration) {
            // trigger potential scroll measurement
          }
        }
      )
    )
  }

  // 挂载 HTML 内嵌图片 (如 <img src="...">)
  mountedHtmlImages?.destroy()
  if (contentRef.value) {
    mountedHtmlImages = mountHtmlImages(contentRef.value, props.resources || fallbackResources)
  }
}, { immediate: true, flush: 'post' })

function onContentClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a')
  if (anchor) {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      void openMarkdownLink(anchor.getAttribute('href') || '')
    }
  }
}

let expectedTop: number | null = null
let isScrolling = false

function onScroll() {
  if (isScrolling) return
  const element = contentRef.value
  if (!element) return
  if (expectedTop !== null && Math.abs(element.scrollTop - expectedTop) <= 2) {
    expectedTop = null
    return
  }
  expectedTop = null

  const items = anchors()
  const y = element.scrollTop
  let index = 0
  while (index + 1 < items.length && items[index + 1].top <= y) index++
  const start = items[index]
  const end = items[index + 1]
  if (start) {
    const line = end && end.top > start.top
      ? start.line + (end.line - start.line) * Math.max(0, (y - start.top) / (end.top - start.top))
      : start.line
    emit('scroll-line', line)
  }
}

function anchors() {
  const element = contentRef.value
  if (!element) return []
  const top = element.getBoundingClientRect().top
  const items = Array.from(element.querySelectorAll<HTMLElement>('[data-source-line]')).map(node => ({
    line: Number(node.dataset.sourceLine),
    top: node.getBoundingClientRect().top - top + element.scrollTop,
  }))
  items.push({ line: previewText.value.split('\n').length + 1, top: element.scrollHeight })
  return items
}

function syncScroll(line: number) {
  const element = contentRef.value
  const items = anchors()
  if (!element || !items.length) return
  let index = 0
  while (index + 1 < items.length && items[index + 1].line <= line) index++
  const start = items[index]
  const end = items[index + 1]
  const next = start.top + (end && end.line > start.line ? (end.top - start.top) * Math.max(0, (line - start.line) / (end.line - start.line)) : 0)
  if (Math.abs(element.scrollTop - next) > 2) {
    isScrolling = true
    element.scrollTop = next
    expectedTop = next
    setTimeout(() => { isScrolling = false }, 50)
  }
}

defineExpose({ syncScroll })
</script>

<style scoped>
.split-preview-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--paper);
  overflow: hidden;
  height: 100%;
  position: relative;
}

.split-preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--ui-font-size, 14px);
  line-height: 1.65;
  box-sizing: border-box;
}
:deep(.md-math-output) { margin: 1em 0; max-width: 100%; overflow-x: auto; text-align: center; }
:deep(.md-math-output .katex-display) { margin: 0; }
:deep(.md-math-output .katex-display > .katex) { white-space: nowrap; }
:deep(.md-inline-math) { display: inline; }
:deep(.md-render-error) { color: var(--pink); white-space: pre-wrap; overflow-wrap: anywhere; }

/* 标题样式：对齐 Markdown Live / Typora */
:deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
  color: var(--bright);
  font-weight: 600;
  margin-top: 1.2em;
  margin-bottom: 0.6em;
  line-height: 1.35;
}

:deep(h1) {
  font-size: 1.85em;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.3em;
}

:deep(h2) {
  font-size: 1.45em;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.25em;
}

:deep(h3) { font-size: 1.25em; }
:deep(h4) { font-size: 1.1em; }
:deep(h5), :deep(h6) { font-size: 1em; }

:deep(p) {
  margin: 0.8em 0;
}

:deep(ul), :deep(ol) {
  padding-left: 24px;
  margin: 0.8em 0;
}

:deep(li) {
  margin: 0.25em 0;
}

/* 行内代码 */
:deep(:not(pre) > code) {
  font-family: var(--font-mono);
  background: var(--soft);
  color: var(--pink, #d99bbe);
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 0.88em;
}

/* 代码块：无两层边框，无大语言条，单层细边框与淡灰底色 */
:deep(.md-preview-fence) {
  position: relative;
  width: 100%;
  box-sizing: border-box;
  background: var(--md-code-bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  margin: 1em 0;
}

:deep(.md-preview-fence pre) {
  margin: 0;
  padding: 10px 14px;
  background: transparent;
  border: none;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.65;
  color: var(--text);
}

:deep(.md-preview-fence pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
}

/* 复制按钮：右上角 14px 图标，hover 时显现 */
:deep(.md-preview-fence .md-code-copy) {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease, background 0.15s ease;
  background: var(--bar);
  border: 1px solid var(--line);
  color: var(--muted);
  width: 24px;
  height: 24px;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
}

:deep(.md-preview-fence:hover .md-code-copy) {
  opacity: 0.95;
  pointer-events: auto;
}

:deep(.md-preview-fence .md-code-copy:hover) {
  opacity: 1;
  color: var(--bright);
  background: var(--hover);
}

/* 引用块 */
:deep(blockquote) {
  border-left: 3px solid var(--accent);
  background: rgba(156, 147, 244, 0.05);
  padding: 6px 14px;
  margin: 1em 0;
  color: var(--sub);
  border-radius: 0 4px 4px 0;
}

:deep(blockquote p) {
  margin: 0.4em 0;
}

/* 链接 */
:deep(a) {
  color: var(--blue);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 分隔线 */
:deep(hr) {
  border: none;
  height: 1px;
  background: var(--line);
  margin: 1.5em 0;
}

/* 表格：单层边框，自然排版 */
:deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  border: 1px solid var(--line);
}

:deep(th), :deep(td) {
  border: 1px solid var(--line);
  padding: 7px 12px;
  text-align: left;
}

:deep(th) {
  background: var(--soft);
  color: var(--bright);
  font-weight: 600;
}

/* 任务列表复选框 */
:deep(.md-preview-task) {
  margin-right: 6px;
  vertical-align: middle;
}

/* 图片样式：自适应、无厚重灰框 */
:deep(.md-image-slot) {
  display: inline-block;
  max-width: 100%;
}

:deep(.md-image-preview) {
  display: inline-block;
  max-width: 100%;
  background: transparent;
  border: none;
  padding: 0;
}

:deep(.md-image-preview img) {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  object-fit: contain;
  cursor: pointer;
}

@media(max-width: 760px) {
  .split-preview-content {
    padding: 12px 14px;
  }
}
</style>
