<template>
  <div class="toolrow">
    <div class="crumb">
      <template v-if="doc">
        <span v-if="isWorkspace">workspace</span>
        <span v-if="isWorkspace" class="sep">›</span>
        <span v-if="dirPath">{{ dirPath }}</span>
        <span v-if="dirPath" class="sep">/</span>
        <b>{{ doc.name }}</b>
      </template>
      <template v-else>
        <span class="no-file">未打开任何文件</span>
      </template>
    </div>

    <div v-if="doc" class="tools">
      <span class="langchip" title="示例语言；Phase 2 接入语言切换">
        {{ doc.language }}
      </span>

      <!-- 仅在 Markdown 文件展示视图切换模式，普通代码/文本严格隐藏 -->
      <div v-if="isMarkdown" class="mdswitch">
        <button
          :class="{ on: doc.mode === 'live' }"
          disabled title="即时排版将在 Phase 5 实现"
          @click="$emit('set-md-mode', 'live')"
        >
          即时排版
        </button>
        <button
          :class="{ on: doc.mode === 'source' }"
          disabled title="Markdown 视图将在 Phase 5 实现"
          @click="$emit('set-md-mode', 'source')"
        >
          源码
        </button>
        <button
          :class="{ on: doc.mode === 'split' }"
          disabled title="双栏预览将在 Phase 5 实现"
          @click="$emit('set-md-mode', 'split')"
        >
          双栏
        </button>
      </div>

      <button
        class="ib small"
        :class="{ on: wordWrap }"
        title="软换行"
        @click="$emit('toggle-wrap')"
      >
        <Icon name="wrap" size="small" />
      </button>

      <button
        class="ib small"
        :class="{ on: showOutline }"
        title="显示/隐藏大纲"
        @click="$emit('toggle-outline')"
      >
        <Icon name="outline" size="small" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../common/Icon.vue'
import type { EditorDocument, MarkdownMode } from '../../types'

const props = defineProps<{
  doc: EditorDocument | null
  isWorkspace: boolean
  wordWrap: boolean
  showOutline: boolean
}>()

defineEmits<{
  (e: 'set-md-mode', mode: MarkdownMode): void
  (e: 'toggle-wrap'): void
  (e: 'toggle-outline'): void
}>()

const isMarkdown = computed(() => {
  if (!props.doc) return false
  return /\.(md|markdown)$/i.test(props.doc.name)
})

const dirPath = computed(() => {
  if (!props.doc || !props.doc.path.includes('/')) return ''
  const parts = props.doc.path.split('/')
  parts.pop()
  return parts.join(' / ')
})
</script>

<style scoped>
.toolrow {
  height: 34px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11px;
  color: var(--muted);
  flex: none;
}

.crumb {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crumb b {
  color: var(--bright);
  font-weight: 600;
}

.crumb .sep {
  color: var(--line);
}

.no-file {
  font-style: italic;
  color: var(--muted);
}

.tools {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 800px) {
  .langchip { display: none; }
  .toolrow { padding: 0 6px; }
  .mdswitch button { padding: 2px 4px; }
}

.langchip {
  font-size: 10px;
  background: var(--soft);
  color: var(--sub);
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;
}

.mdswitch {
  display: flex;
  background: var(--soft);
  border-radius: 5px;
  padding: 1px;
}

.mdswitch button {
  padding: 2px 7px;
  font-size: 10px;
  border-radius: 4px;
  color: var(--muted);
}

.mdswitch button.on {
  background: var(--accentbg);
  color: var(--accent);
  font-weight: 600;
}

.ib.small {
  width: 26px;
  height: 26px;
}
</style>
