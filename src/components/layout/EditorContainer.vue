<template>
  <div class="editor-container">
    <div class="editor-main">
      <div v-if="doc" class="kernel-notice">
        <span class="badge">Phase 1 UI 骨架</span>
        <span>内存示例 · 只读 · 不读写磁盘。CodeMirror 6 编辑内核将在 Phase 2 接入。</span>
      </div>
      <div v-if="doc" class="code-viewport" :class="{ wrap: wordWrap }">
        <div class="linenums" aria-hidden="true" v-if="!wordWrap">
          <div
            v-for="n in lineCount"
            :key="n"
            class="linenum"
          >
            {{ n }}
          </div>
        </div>
        <div class="code-content">
          <pre class="code-pre"><code>{{ doc.content }}</code></pre>
        </div>
      </div>

      <div v-else class="empty-state">
        <div class="hero">Write anything.</div>
        <p class="sub-hero">文本 · 配置 · 代码 · Markdown</p>
        <p class="desc">轻量通用文本编辑器，适用于你的每种文本。</p>
        <div class="empty-actions">
          <button class="primary-btn" @click="$emit('new-doc')">新建文件</button>
          <button class="secondary-btn" @click="$emit('open-palette', 'file')">快速打开 (Ctrl+P)</button>
        </div>
      </div>
    </div>

    <!-- 右侧大纲容器（Phase 6 接入 Lezer 语法树） -->
    <aside v-if="showOutline && doc" class="outline-sidebar">
      <div class="outline-head">
        <span>OUTLINE</span>
        <button class="tinyclose" aria-label="关闭大纲" title="关闭大纲" @click="$emit('close-outline')">✕</button>
      </div>
      <div class="outline-body">
        <p class="outline-tip">文档大纲将在 Phase 6 随着语法分析引擎接入。</p>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EditorDocument } from '../../types'

const props = defineProps<{
  doc: EditorDocument | null
  wordWrap: boolean
  showOutline: boolean
}>()

defineEmits<{
  (e: 'new-doc'): void
  (e: 'open-palette', cat: 'action' | 'file' | 'all'): void
  (e: 'close-outline'): void
}>()

const lineCount = computed(() => {
  if (!props.doc) return 1
  return Math.max(1, props.doc.content.split('\n').length)
})
</script>

<style scoped>
.editor-container {
  min-height: 0;
  flex: 1;
  display: flex;
  background: var(--editor);
  overflow: hidden;
  position: relative;
}

.editor-main {
  min-width: 0;
  flex-direction: column;
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.code-viewport {
  min-height: 0;
  flex: 1;
  display: flex;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--editor-size);
  line-height: var(--editor-line);
}

.code-viewport.wrap .code-pre {
  white-space: pre-wrap;
  word-break: break-all;
}

.linenums {
  width: 52px;
  flex: none;
  background: var(--editor);
  color: var(--muted);
  text-align: right;
  padding: 12px 14px 12px 0;
  user-select: none;
  border-right: 1px solid rgba(255, 255, 255, 0.04);
}

.linenum {
  font-size: 11px;
  height: var(--editor-line);
  line-height: var(--editor-line);
}

.code-content {
  min-width: 0;
  flex: 1;
  padding: 12px 18px;
  overflow-x: auto;
}

.kernel-notice {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11px;
  color: var(--sub);
  margin: 12px 18px 0;
}

.kernel-notice .badge {
  background: var(--accentbg);
  color: var(--accent);
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
}

.code-pre {
  user-select: text;
  margin: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: var(--ink);
  white-space: pre;
}

@media (max-width: 1050px) {
  .outline-sidebar { display: none; }
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  text-align: center;
  padding: 24px;
}

.hero {
  font-size: 32px;
  font-weight: 700;
  color: var(--bright);
  letter-spacing: -1px;
  margin-bottom: 8px;
}

.sub-hero {
  font-size: 14px;
  color: var(--sub);
  margin: 0 0 6px;
}

.desc {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 24px;
}

.empty-actions {
  display: flex;
  gap: 12px;
}

.primary-btn {
  background: var(--accent);
  color: white;
  padding: 8px 18px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  transition: opacity 0.15s;
}

.primary-btn:hover {
  opacity: 0.9;
}

.secondary-btn {
  background: var(--soft);
  color: var(--bright);
  border: 1px solid var(--line);
  padding: 8px 18px;
  border-radius: 7px;
  font-size: 12px;
  transition: background 0.15s;
}

.secondary-btn:hover {
  background: var(--hover);
}

.outline-sidebar {
  width: 200px;
  flex: none;
  background: var(--sidebar);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
}

.outline-head {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--line);
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.8px;
}

.outline-body {
  padding: 12px;
  font-size: 11px;
  color: var(--muted);
}
</style>
