<template>
  <div class="app" :class="{ focus: focusMode }">
    <!-- 顶部标题栏 -->
    <TopBar
      v-if="!focusMode"
      :app-mode="appMode"
      :theme="theme"
      :focus-mode="focusMode"
      :active-file-name="activeDoc?.name"
      @set-mode="setMode"
      @toggle-theme="toggleTheme"
      @toggle-focus="toggleFocus"
      @open-settings="openSettings"
      @open-palette="openPalette"
    />

    <!-- 主工作区容器 -->
    <div class="workspace-layout">
      <!-- 活动栏 (单文件模式可自动折叠) -->
      <ActivityBar
        v-if="!focusMode && appMode === 'workspace'"
        :active-panel="sidebarPanel"
        :sidebar-visible="sidebarVisible"
        @select-panel="handleSelectPanel"
        @open-settings="openSettings"
      />

      <!-- 侧边栏 (Explorer / Search / Outline) -->
      <Sidebar
        v-if="!focusMode && sidebarVisible"
        v-model:width="sidebarWidth"
        :active-panel="sidebarPanel"
        :active-doc-id="activeDocId"
        :open-docs="openedDocuments"
        @toggle-side="toggleSidebar"
        @new-doc="createNewDoc"
        @select-doc="handleSelectDoc"
      />

      <!-- 编辑主体区 -->
      <section class="center-area">
        <!-- 标签栏 -->
        <TabBar
          :docs="openedDocuments"
          :active-id="activeDocId"
          @select-tab="selectDocById"
          @pin-tab="pinDocById"
          @close-tab="closeDocById"
          @new-doc="createNewDoc"
        />

        <!-- 面包屑与快捷动作条 -->
        <Breadcrumb
          :doc="activeDoc"
          :is-workspace="appMode === 'workspace'"
          :word-wrap="wordWrap"
          :show-outline="showOutline"
          @set-md-mode="setMdMode"
          @toggle-wrap="wordWrap = !wordWrap"
          @toggle-outline="showOutline = !showOutline"
        />

        <!-- 主编辑器容器 -->
        <EditorContainer
          :doc="activeDoc"
          :word-wrap="wordWrap"
          :show-outline="showOutline"
          @new-doc="createNewDoc"
          @open-palette="openPalette"
          @close-outline="showOutline = false"
        />
      </section>
    </div>

    <!-- 底部状态栏 -->
    <StatusBar
      v-if="!focusMode"
      :app-mode="appMode"
      :doc="activeDoc"
    />

    <!-- 命令面板模态框 -->
    <CommandPalette
      ref="paletteRef"
      :items="paletteActions"
    />

    <!-- 首选项模态框 -->
    <SettingsModal
      ref="settingsRef"
      v-model:theme="theme"
      v-model:font-size="fontSize"
      v-model:word-wrap="wordWrap"
      v-model:show-outline="showOutline"
      v-model:default-md-mode="defaultMdMode"
    />

    <!-- 操作提示 Toast -->
    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import TopBar from './components/layout/TopBar.vue'
import ActivityBar from './components/layout/ActivityBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import TabBar from './components/layout/TabBar.vue'
import Breadcrumb from './components/layout/Breadcrumb.vue'
import EditorContainer from './components/layout/EditorContainer.vue'
import StatusBar from './components/layout/StatusBar.vue'
import CommandPalette from './components/modals/CommandPalette.vue'
import SettingsModal from './components/modals/SettingsModal.vue'
import Toast from './components/common/Toast.vue'
import type { AppMode, SidebarPanel, Theme, MarkdownMode, EditorDocument, PaletteAction } from './types'

// 1. 响应式布局状态
const appMode = ref<AppMode>('workspace')
const sidebarVisible = ref(true)
const sidebarWidth = ref(254)
const sidebarPanel = ref<SidebarPanel>('files')
const focusMode = ref(false)
const theme = ref<Theme>('dark')
const fontSize = ref(13)
const wordWrap = ref(false)
const showOutline = ref(false)
const defaultMdMode = ref<MarkdownMode>('live')

// 2. 组件引用
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
const settingsRef = ref<InstanceType<typeof SettingsModal> | null>(null)
const toastRef = ref<InstanceType<typeof Toast> | null>(null)

function toast(msg: string) {
  toastRef.value?.show(msg)
}

// 3. Phase 1 示例文档库（默认打开普通代码文件 main.rs，非 Markdown，遵守 Phase 1 验收）
const documents = ref<EditorDocument[]>([
  {
    id: 'rust-doc',
    name: 'main.rs',
    path: 'src/main.rs',
    language: 'Rust',
    content: `use std::path::PathBuf;\nuse tauri::Manager;\n\nmod commands;\nmod workspace;\n\nfn main() {\n    tauri::Builder::default()\n        .setup(|app| {\n            let window = app.get_webview_window("main").unwrap();\n            println!("LightEdit is ready: {:?}", window.label());\n            Ok(())\n        })\n        .invoke_handler(tauri::generate_handler![\n            commands::open_file,\n            commands::save_file,\n        ])\n        .run(tauri::generate_context!())\n        .expect("error while running LightEdit");\n}\n`,
    original: '',
    dirty: false,
    pinned: true,
    encoding: 'UTF-8',
    eol: 'LF'
  },
  {
    id: 'ts-doc',
    name: 'EditorView.ts',
    path: 'src/editor/EditorView.ts',
    language: 'TypeScript',
    content: `import { EditorState, Compartment } from '@codemirror/state'\nimport { EditorView } from '@codemirror/view'\nimport { basicSetup } from 'codemirror'\n\nexport function createEditor(container: HTMLElement, source: string) {\n  const language = new Compartment()\n  const state = EditorState.create({\n    doc: source,\n    extensions: [\n      basicSetup,\n      language.of([]),\n      EditorView.lineWrapping,\n    ],\n  })\n\n  return new EditorView({ state, parent: container })\n}\n`,
    original: '',
    dirty: false,
    pinned: true,
    encoding: 'UTF-8',
    eol: 'LF'
  },
  {
    id: 'json-doc',
    name: 'settings.json',
    path: 'config/settings.json',
    language: 'JSON',
    content: `{\n  "editor": {\n    "fontSize": 13,\n    "tabSize": 2,\n    "lineNumbers": true,\n    "wordWrap": false\n  },\n  "markdown": {\n    "defaultMode": "live",\n    "showSourceOnCursor": true\n  }\n}\n`,
    original: '',
    dirty: false,
    pinned: true,
    encoding: 'UTF-8',
    eol: 'LF'
  },
  {
    id: 'txt-doc',
    name: 'today.txt',
    path: 'notes/today.txt',
    language: 'Plain Text',
    content: `工作笔记 · 2026-10-13\n\n1. 设计轻量文本编辑器：单文件与工作区并重。\n2. 全部文件统一由 CodeMirror 6 编辑。\n3. Markdown 默认即时排版，其他文件不显示 Markdown 工具栏。\n4. 后端使用 Rust + Tauri 2 管理本地文件。\n\n任何文本，打开就能写。\n`,
    original: '',
    dirty: false,
    pinned: true,
    encoding: 'UTF-8',
    eol: 'LF'
  },
  {
    id: 'readme-doc',
    name: 'README.md',
    path: 'README.md',
    language: 'Markdown',
    content: `# LightEdit\n\n轻量、顺手、面向**所有文本**的桌面编辑器。\n兼顾 Fleet 的工作区体验和 Typora 的 Markdown 即时排版。\n\n## 核心特性\n\n- **纯文本**：打开 \`.txt\`、日志、CSV 和无扩展名文件。\n- **代码编辑**：TypeScript、Rust、Go、Python、JSON 等高亮与折叠。\n- **Markdown 即时排版**：同一编辑器里展示排版，光标进入即编辑。\n`,
    original: '',
    dirty: false,
    pinned: false,
    mode: 'live',
    encoding: 'UTF-8',
    eol: 'LF'
  }
])

const openTabIds = ref<string[]>(['rust-doc', 'ts-doc', 'json-doc', 'readme-doc'])
const activeDocId = ref<string | null>('rust-doc')

const openedDocuments = computed(() => {
  return openTabIds.value
    .map(id => documents.value.find(d => d.id === id))
    .filter((d): d is EditorDocument => !!d)
})

const activeDoc = computed(() => {
  return documents.value.find(d => d.id === activeDocId.value) || null
})

// 4. 操作与布局方法
function setMode(mode: AppMode) {
  appMode.value = mode
  if (mode === 'single') {
    sidebarVisible.value = false
    toast('已切换至单文件模式：侧边栏默认隐藏，快速聚焦正文')
  } else {
    sidebarVisible.value = true
    toast('已切换至工作区模式')
  }
}

function toggleSidebar() {
  sidebarVisible.value = !sidebarVisible.value
}

function handleSelectPanel(panel: SidebarPanel) {
  if (sidebarPanel.value === panel && sidebarVisible.value) {
    sidebarVisible.value = false
  } else {
    sidebarPanel.value = panel
    sidebarVisible.value = true
  }
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

function toggleFocus() {
  focusMode.value = !focusMode.value
  toast(focusMode.value ? '已进入专注模式 · 按 Esc 退出' : '已退出专注模式')
}

function openSettings() {
  paletteRef.value?.close()
  settingsRef.value?.open()
}

function openPalette(category: 'action' | 'file' | 'all' = 'all') {
  settingsRef.value?.close()
  paletteRef.value?.open(category)
}

function selectDocById(id: string) {
  if (openTabIds.value.includes(id)) activeDocId.value = id
}

function pinDocById(id: string) {
  const doc = documents.value.find(d => d.id === id)
  if (doc) doc.pinned = true
}

function closeDocById(id: string) {
  const index = openTabIds.value.indexOf(id)
  if (index === -1) return
  const doc = documents.value.find(d => d.id === id)
  if (doc?.dirty && !window.confirm(`关闭 ${doc.name} 并放弃未保存修改？`)) return
  openTabIds.value.splice(index, 1)
  // Only the fixed demo library is retained for reopening; discard closed empty drafts.
  if (id.startsWith('new-')) documents.value = documents.value.filter(d => d.id !== id)
  if (activeDocId.value === id) {
    activeDocId.value = openTabIds.value[Math.max(0, index - 1)] || null
  }
}

function handleSelectDoc(id: string, preview = true) {
  const doc = documents.value.find(d => d.id === id)
  if (!doc) return
  if (!openTabIds.value.includes(id)) {
    openTabIds.value.push(id)
  }
  activeDocId.value = id
  if (doc && !preview) {
    doc.pinned = true
  }
}

function createNewDoc() {
  let counter = 1
  while (documents.value.some(d => d.name === `Untitled-${counter}.txt`)) {
    counter++
  }
  const id = `new-${Date.now()}-${counter}`
  const newDocument: EditorDocument = {
    id,
    name: `Untitled-${counter}.txt`,
    path: `Untitled-${counter}.txt`,
    language: 'Plain Text',
    content: '',
    original: '',
    dirty: false,
    pinned: true,
    encoding: 'UTF-8',
    eol: 'LF'
  }
  documents.value.push(newDocument)
  openTabIds.value.push(id)
  activeDocId.value = id
  toast('已新建纯文本草稿 (Phase 1 演示)')
}

function setMdMode(mode: MarkdownMode) {
  if (activeDoc.value) {
    activeDoc.value.mode = mode
    toast(`Markdown 视图将在 Phase 5 接入；当前为只读示例: ${mode}`)
  }
}

// 5. 命令面板动作注册
const paletteActions = computed<PaletteAction[]>(() => {
  const actions: PaletteAction[] = [
    {
      id: 'cmd-new',
      title: '新建示例标签（只读）',
      detail: 'Ctrl+N',
      category: 'action',
      action: createNewDoc
    },
    {
      id: 'cmd-mode-single',
      title: '切换到单文件模式',
      detail: '布局',
      category: 'action',
      action: () => setMode('single')
    },
    {
      id: 'cmd-mode-workspace',
      title: '切换到工作区模式',
      detail: '布局',
      category: 'action',
      action: () => setMode('workspace')
    },
    {
      id: 'cmd-toggle-sidebar',
      title: '显示/隐藏侧边栏',
      detail: 'Ctrl+B',
      category: 'action',
      action: toggleSidebar
    },
    {
      id: 'cmd-toggle-theme',
      title: '切换深色/浅色主题',
      detail: '外观',
      category: 'action',
      action: toggleTheme
    },
    {
      id: 'cmd-open-settings',
      title: '打开首选项',
      detail: '设置',
      category: 'action',
      action: openSettings
    }
  ]

  // 文件项
  const fileActions: PaletteAction[] = documents.value.map(d => ({
    id: `file-${d.id}`,
    title: d.name,
    detail: d.path,
    category: 'file',
    action: () => handleSelectDoc(d.id, true)
  }))

  return [...actions, ...fileActions]
})

// 6. 全局键盘快捷键
function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.defaultPrevented || paletteRef.value?.visible || settingsRef.value?.visible) return
  const isCtrlOrCmd = e.ctrlKey || e.metaKey

  if (e.key === 'Escape') {
    if (focusMode.value) {
      focusMode.value = false
      toast('已退出专注模式')
    }
    return
  }

  if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    openPalette('action')
  } else if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    openPalette('file')
  } else if (isCtrlOrCmd && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    toggleSidebar()
  } else if (isCtrlOrCmd && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    createNewDoc()
  }
}

// 7. 响应主题与字体变化
watch(theme, (newTheme) => {
  document.body.classList.toggle('light', newTheme === 'light')
  document.documentElement.style.colorScheme = newTheme
}, { immediate: true })

watch(fontSize, (newSize) => {
  document.documentElement.style.setProperty('--editor-size', `${newSize}px`)
}, { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--app);
  color: var(--ink);
  position: relative;
  overflow: hidden;
}

.workspace-layout {
  min-height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

@media (max-width: 900px) {
  .workspace-layout > .sidebar-wrapper { display: none; }
}

.center-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--editor);
}
</style>
