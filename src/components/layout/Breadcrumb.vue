<template>
  <div class="toolrow">
    <div v-if="doc" class="tools">
      <span class="langchip" title="可在状态栏切换语言模式">
        {{ doc.language }}
      </span>

      <!-- 仅在 Markdown 文件展示视图切换模式，普通代码/文本严格隐藏 -->
      <div v-if="isMarkdown" class="mdswitch">
        <button
          :class="{ on: doc.mode === 'live' }"
          title="即时排版 (Live Preview)"
          @click="$emit('set-md-mode', 'live')"
        >
          即时排版
        </button>
        <button
          :class="{ on: doc.mode === 'source' }"
          title="源码编辑 (Source)"
          @click="$emit('set-md-mode', 'source')"
        >
          源码
        </button>
        <button
          :class="{ on: doc.mode === 'split' }"
          title="双栏预览 (Split)"
          @click="$emit('set-md-mode', 'split')"
        >
          双栏
        </button>
      </div>

      <button
        class="ib small"
        :class="{ on: isSplitPane }"
        :title="isSplitPane ? '关闭分栏' : '双 Pane 分栏编辑 (Split Pane)'"
        @click="$emit('toggle-split-pane')"
      >
        <Icon name="split" size="small" />
      </button>

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
  wordWrap: boolean
  showOutline: boolean
  isSplitPane?: boolean
}>()

defineEmits<{
  (e: 'set-md-mode', mode: MarkdownMode): void
  (e: 'toggle-wrap'): void
  (e: 'toggle-outline'): void
  (e: 'toggle-split-pane'): void
}>()

const isMarkdown = computed(() => {
  if (!props.doc) return false
  return /\.(md|markdown)$/i.test(props.doc.name)
})

</script>

<style scoped>
.toolrow {
  height: 34px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px;
  font-size: 11px;
  color: var(--muted);
  flex: none;
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
