<template>
  <footer class="status">
    <div class="stat-group left">
      <span class="stat-item file-path" :title="readablePath(doc?.path || doc?.name || '未打开文件')" aria-label="当前文件路径">{{ displayFilePath(doc?.path || doc?.name || '未打开文件', root, multiRoot) }}</span>
      <span class="stat-item dirty-item" :class="{ dirty: isDirty }">
        {{ doc?.kind === 'javaClass' ? '只读查看' : isDirty ? '● 未保存修改' : doc?.fileToken ? '已保存' : doc ? '未保存' : '' }}
      </span>
      <span v-if="doc?.readOnly && doc.kind !== 'javaClass'" class="stat-item" title="原路径不可写，可另存为">不可写</span>
    </div>

    <div class="stat-group right">
      <template v-if="doc?.kind !== 'javaClass'">
        <span class="stat-item position">Ln {{ doc?.line || 1 }}, Col {{ doc?.column || 1 }}</span>
        <span class="stat-item optional">{{ useTabs ? 'Tabs' : 'Spaces' }}: {{ indentSize }}</span>
        <button
          class="stat-item encoding-btn"
          :class="{ clickable: !!doc }"
          :disabled="!doc"
          aria-label="选择编码操作"
          :title="encodingTitle"
          @click="openEncodingMenu($event)"
        >
          <span>{{ encodingDisplay }}</span>
          <span v-if="doc" class="encoding-arrow" aria-hidden="true">▾</span>
        </button>
        <span class="stat-item">{{ doc?.eol || 'LF' }}</span>
      </template>
      <span v-if="doc?.kind === 'javaClass'" class="stat-item">JVM ClassFile</span>
      <select v-else class="stat-item lang-item" aria-label="语言模式" :disabled="!doc || doc.encoding === 'Hex'" :value="doc?.language || 'Plain Text'"
        @change="$emit('set-language', ($event.target as HTMLSelectElement).value as LanguageName)">
        <option v-for="language in languageNames" :key="language" :value="language">{{ language }}</option>
      </select>
      <span v-if="doc?.languageStatus === 'loading'" class="optional">加载中…</span>
      <span class="stat-item">{{ doc?.kind === 'javaClass' ? `${doc.classInfo?.byteLength.toLocaleString()} 字节` : `${charCount} 字符` }}</span>
    </div>
    <ContextMenu ref="encodingMenuRef" />
  </footer>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { EditorDocument } from '../../types'
import { languageNames, type LanguageName } from '../../editor/languages'
import { readablePath, displayFilePath } from '../../features/shell/pathDisplay'
import ContextMenu from '../common/ContextMenu.vue'
import { CommandRegistry, menuCommand as cmd, separator, type MenuNode } from '../../features/shell/menuModel'
import type { Encoding, FileOpenEncoding } from '../../features/files/contracts'

const emit = defineEmits<{
  (e: 'set-language', language: LanguageName): void
  (e: 'reopen-encoding', encoding: FileOpenEncoding): void
  (e: 'convert-encoding', payload: { encoding: Encoding; bom: boolean }): void
  (e: 'save-as-encoding', encoding: Encoding): void
}>()

const props = defineProps<{
  doc: EditorDocument | null
  indentSize: number
  useTabs: boolean
  root?: { rootPath: string; name: string } | null
  multiRoot?: boolean
}>()

const encodingMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

const isDirty = computed(() => {
  return props.doc?.dirty ?? false
})

const charCount = computed(() => {
  return props.doc?.charCount.toLocaleString() || '0'
})

const encodingDisplay = computed(() => {
  if (!props.doc) return 'UTF-8'
  if (props.doc.encoding === 'Hex') return 'HEX 字节'
  return `${props.doc.encoding || 'UTF-8'}${props.doc.bom ? ' BOM' : ''}`
})

const encodingTitle = computed(() => {
  if (!props.doc) return '未打开文档'
  if (props.doc.encoding === 'Hex') return '当前为十六进制字节模式，点击选择编码重新打开'
  return `当前编码：${props.doc.encoding || 'UTF-8'}${props.doc.bom ? ' (BOM)' : ''}，点击更改`
})

const TEXT_ENCODINGS: { label: string; id: Encoding }[] = [
  { label: 'UTF-8', id: 'UTF-8' },
  { label: 'GB18030 (兼容 GBK/GB2312)', id: 'GB18030' },
  { label: 'UTF-16LE', id: 'UTF-16LE' },
  { label: 'UTF-16BE', id: 'UTF-16BE' },
  { label: 'Windows-1252 (西欧)', id: 'windows-1252' },
]

function openEncodingMenu(event: MouseEvent | KeyboardEvent) {
  if (!props.doc) return
  const isHex = props.doc.encoding === 'Hex'
  const hasFile = !!props.doc.fileToken

  const commands = [
    // 1. 以指定编码重新打开
    ...TEXT_ENCODINGS.map(enc => ({
      id: `reopen-${enc.id}`,
      title: enc.label,
      enabled: hasFile,
      run: () => emit('reopen-encoding', enc.id),
    })),
    {
      id: 'reopen-Hex',
      title: '以字节方式打开 (HEX)',
      enabled: hasFile && !isHex,
      run: () => emit('reopen-encoding', 'Hex'),
    },

    // 2. 转换为指定编码并保存
    ...TEXT_ENCODINGS.map(enc => ({
      id: `convert-${enc.id}`,
      title: enc.label,
      enabled: hasFile && !isHex,
      run: () => emit('convert-encoding', { encoding: enc.id, bom: false }),
    })),
    {
      id: 'convert-UTF-8-BOM',
      title: 'UTF-8 带 BOM',
      enabled: hasFile && !isHex,
      run: () => emit('convert-encoding', { encoding: 'UTF-8', bom: true }),
    },

    // 3. 另存为指定编码…
    ...TEXT_ENCODINGS.map(enc => ({
      id: `saveas-${enc.id}`,
      title: enc.label,
      enabled: !isHex,
      run: () => emit('save-as-encoding', enc.id),
    })),
  ]

  const registry = new CommandRegistry(commands)

  const reopenChildren: MenuNode[] = [
    ...TEXT_ENCODINGS.map(enc => cmd(`reopen-${enc.id}`)),
    cmd('reopen-Hex'),
  ]

  const convertChildren: MenuNode[] = [
    ...TEXT_ENCODINGS.map(enc => cmd(`convert-${enc.id}`)),
    cmd('convert-UTF-8-BOM'),
  ]

  const saveAsChildren: MenuNode[] = [
    ...TEXT_ENCODINGS.map(enc => cmd(`saveas-${enc.id}`)),
  ]

  const menuNodes: MenuNode[] = [
    { type: 'submenu', id: 'reopen-submenu', label: '以指定编码重新打开', children: reopenChildren, enabled: hasFile },
    separator('sep-1'),
    { type: 'submenu', id: 'convert-submenu', label: '转换为指定编码并保存', children: convertChildren, enabled: hasFile && !isHex },
    separator('sep-2'),
    { type: 'submenu', id: 'saveas-submenu', label: '另存为指定编码…', children: saveAsChildren, enabled: !isHex },
  ]

  encodingMenuRef.value?.open(event, menuNodes, registry, '编码操作', true)
}
</script>

<style scoped>
.status {
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  height: 24px;
  background: var(--bar);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 11px;
  color: var(--muted);
  flex: none;
}

@media (max-width: 950px) {
  .optional { display: none; }
  .stat-group { gap: 6px; }
}

.stat-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.stat-group.left { min-width: 0; flex: 1; }
.stat-group.right { flex: none; }
.file-path { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dirty-item { flex: none; }

.dirty-item.dirty {
  color: var(--yellow);
}

.encoding-btn {
  background: transparent;
  border: none;
  font-size: inherit;
  color: var(--muted);
  cursor: default;
  padding: 1px 4px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.encoding-btn.clickable {
  cursor: pointer;
}

.encoding-btn.clickable:hover {
  background: var(--hover);
  color: var(--bright);
}

.encoding-arrow {
  font-size: 8px;
  opacity: 0.7;
}

.lang-item {
  background: var(--bar);
  border: 0;
  max-width: 120px;
  font-size: inherit;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
}
@media (max-width: 720px) { .dirty-item, .position { display: none; } .stat-group { gap: 6px; } }

.lang-item:hover {
  background: var(--hover);
  color: var(--bright);
}
</style>
