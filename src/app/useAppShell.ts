import { ref, computed, watch, onMounted, onUnmounted, markRaw, reactive, nextTick } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { DocumentManager } from '../editor/core/DocumentManager'
import { sampleDocuments } from '../features/tabs/sampleDocuments'
import type { LanguageName } from '../editor/languages'
import type { AppMode, SidebarPanel, Theme, ThemePreference, MarkdownMode, PaletteAction } from '../types'
import type CommandPalette from '../components/modals/CommandPalette.vue'
import type SettingsModal from '../components/modals/SettingsModal.vue'
import type DiscardDialog from '../components/modals/DiscardDialog.vue'
import type Toast from '../components/common/Toast.vue'
import { markdownFormats } from '../editor/markdown/formatCommands'
import { FileController, fileError } from '../features/files/FileController'
import { AutoSaveController } from '../features/files/AutoSaveController'
import { tauriFiles } from '../features/files/tauriFiles'
import type { Encoding, Preferences } from '../features/files/contracts'
import { WorkspaceController } from '../features/workspace/WorkspaceController'
import { tauriWorkspace } from '../features/workspace/tauriWorkspace'
import { defaultShortcuts, eventShortcut, fontFamilies, loadEditorSettings, saveEditorSettings, validateShortcuts, relativeFilePath, type EditorSettings, type ShortcutAction } from '../features/shell/editorSettings'

export function useAppShell() {
  const desktop = isTauri()
  const demo = !desktop && new URLSearchParams(location.search).get('demo') === '1'
  const appMode = ref<AppMode>(demo ? 'workspace' : 'single'), sidebarVisible = ref(demo), sidebarWidth = ref(254)
  const sidebarPanel = ref<SidebarPanel>('files'), focusMode = ref(false), theme = ref<ThemePreference>('system')
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(systemTheme.matches)
  const resolvedTheme = computed<Theme>(() => theme.value === 'system' ? (systemDark.value ? 'dark' : 'light') : theme.value)
  function updateSystemTheme(event: MediaQueryListEvent) { systemDark.value = event.matches }
  systemTheme.addEventListener('change', updateSystemTheme)
  const fontSize = ref(14), wordWrap = ref(false), showOutline = ref(false), defaultMdMode = ref<MarkdownMode>('live')
  const fontFamily = ref<EditorSettings['fontFamily']>('system'), indentSize = ref(2), useTabs = ref(false)
  const autoSave = ref(true), autoSaveDelay = ref(1500)
  const shortcuts = ref<EditorSettings['shortcuts']>({ ...defaultShortcuts }), fileModes = ref<Record<string, MarkdownMode>>({})
  let settingsReady = false, settingsTimer: ReturnType<typeof setTimeout> | undefined
  let settingsWrites: Promise<void> = Promise.resolve()
  const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
  const settingsRef = ref<InstanceType<typeof SettingsModal> | null>(null)
  const discardRef = ref<InstanceType<typeof DiscardDialog> | null>(null)
  const toastRef = ref<InstanceType<typeof Toast> | null>(null)
  const gotoLineRef = ref<{ open: () => void; close: () => void; visible: boolean } | null>(null)
  const manager = markRaw(new DocumentManager(demo ? sampleDocuments : []))
  const files = markRaw(new FileController(manager, tauriFiles, toast))
  const workspace = reactive(new WorkspaceController(tauriWorkspace, manager, files, toast, false)) as WorkspaceController
  workspace.connect()
  const recentFiles = ref<Preferences['recent']>([])
  const fileBusy = ref(false)
  const autoSaver = new AutoSaveController(manager, files, () => fileBusy.value || !!discardRef.value?.visible || !!settingsRef.value?.visible || !!document.querySelector('.workspace-operation-dialog'))
  const revision = ref(0)
  const unsubscribe = manager.subscribe(() => revision.value++)
  let lastWorkspaceRevision = 0
  const unsubscribeWorkspace = workspace.subscribe(() => {
    revision.value++
    if (workspace.rootPath && workspace.openRevision !== lastWorkspaceRevision) {
      appMode.value = 'workspace'; sidebarVisible.value = true; sidebarPanel.value = 'files'
    }
    lastWorkspaceRevision = workspace.openRevision
  })
  if (demo) {
    for (const id of ['rust-doc', 'ts-doc', 'json-doc', 'readme-doc']) {
      manager.open(id, sampleDocuments.find(doc => doc.id === id)?.pinned === false)
    }
    manager.select('rust-doc')
  } else {
    manager.createUntitled()
  }
  const openedDocuments = computed(() => { revision.value; return manager.openedDocuments })
  const mainOpenedDocuments = computed(() => { revision.value; return manager.mainOpenedDocuments })
  const mainActiveId = computed(() => { revision.value; return manager.group.activeId })
  const activeDoc = computed(() => { revision.value; return manager.activeDocument })
  const activeDocId = computed(() => { revision.value; return manager.activeId })
  let pendingClose: { kind: 'document'; id: string; pane: 'main' | 'secondary' } | { kind: 'window' } | null = null
  let unlistenWindow: UnlistenFn | undefined
  let unlistenPending: UnlistenFn | undefined
  let layoutTimer: ReturnType<typeof setTimeout> | undefined
  let preferencesReady = false
  let pendingDrain = false
  let draining = false
  let alive = true
  let wasNarrow = window.innerWidth < 900
  function adaptWindowWidth() {
    const narrow = window.innerWidth < 900
    if (narrow && !wasNarrow) sidebarVisible.value = false
    wasNarrow = narrow
  }

  function toast(message: string) { toastRef.value?.show(message) }
  async function refreshRecent() {
    if (!desktop || !alive) return
    try { const prefs = await tauriFiles.preferences(); if (alive) recentFiles.value = prefs.recent }
    catch (error) { toast(fileError(error)) }
  }
  async function openFile(encoding?: Encoding) {
    if (!desktop) { toast('浏览器仅支持内存编辑；请使用 Tauri 桌面版打开或保存磁盘文件。'); return }
    if (fileBusy.value || manager.isComposing) { composingHint(); return }
    fileBusy.value = true
    try { await files.open(encoding); if (!workspace.rootPath) setMode('single'); await refreshRecent() } finally { fileBusy.value = false; void drainPending() }
  }
  async function openRecent(path: string) {
    if (fileBusy.value || manager.isComposing) { composingHint(); return }
    fileBusy.value = true
    try { await files.recent(path); if (!workspace.rootPath) setMode('single'); await refreshRecent() } finally { fileBusy.value = false; void drainPending() }
  }
  async function saveDoc(id: string, saveAs = false, encoding?: Encoding) {
    if (!desktop) { toast('浏览器仅支持内存编辑；请使用 Tauri 桌面版打开或保存磁盘文件。'); return false }
    if (fileBusy.value) return false
    fileBusy.value = true
    try { const saved = await files.save(id, saveAs, encoding); await refreshRecent(); return saved }
    finally { fileBusy.value = false; void drainPending() }
  }
  function saveActive(saveAs = false, encoding?: Encoding) { if (manager.activeId) return saveDoc(manager.activeId, saveAs, encoding); return Promise.resolve(false) }
  async function quitApp() {
    if (!desktop) return
    try { await (await import('@tauri-apps/api/window')).getCurrentWindow().close() }
    catch (error) { toast(`退出失败：${fileError(error)}`) }
  }
  async function reopenEncoding(encoding: Encoding) {
    if (fileBusy.value) return
    fileBusy.value = true
    try { await files.reopen(encoding) } finally { fileBusy.value = false; void drainPending() }
  }
  async function drainPending() {
    if (!desktop || !alive) return
    pendingDrain = true
    if (draining || fileBusy.value || manager.isComposing || discardRef.value?.visible) return
    draining = true
    fileBusy.value = true
    try {
      while (pendingDrain && alive) { pendingDrain = false; files.acceptBatch(await tauriFiles.drainPending()) }
      await refreshRecent()
    } catch (error) { toast(fileError(error)) }
    finally { draining = false; fileBusy.value = false }
  }
  function setMode(mode: AppMode) { appMode.value = mode; sidebarVisible.value = mode === 'workspace' }
  function toggleSidebar() { sidebarVisible.value = !sidebarVisible.value }
  function handleSelectPanel(panel: SidebarPanel) {
    if (sidebarPanel.value === panel && sidebarVisible.value) sidebarVisible.value = false
    else { sidebarPanel.value = panel; sidebarVisible.value = true }
  }
  function toggleTheme() { theme.value = theme.value === 'dark' ? 'light' : theme.value === 'light' ? 'system' : 'dark' }
  function toggleFocus() { focusMode.value = !focusMode.value; toast(focusMode.value ? '专注模式 · Esc 退出' : '已退出专注模式') }
  function openSettings() { if (discardRef.value?.visible) return; paletteRef.value?.close(); settingsRef.value?.open() }
  function openPalette(category: 'action' | 'file' | 'all' = 'all') { if (discardRef.value?.visible) return; settingsRef.value?.close(); paletteRef.value?.open(category) }
  function composingHint() { toast('请先完成当前输入法输入，再切换或关闭文档。') }
  function selectDocById(id: string) { if (!manager.select(id, 'main') && manager.isComposing) composingHint() }
  function handleSelectDoc(id: string, preview = true) { if (!manager.open(id, preview) && manager.isComposing) composingHint() }
  function pinDocById(id: string) { manager.pin(id) }
  function createNewDoc() { if (!manager.createUntitled()) composingHint() }
  function closeDocById(id: string, pane: 'main' | 'secondary' = 'main') {
    if (fileBusy.value) { toast('文件操作进行中，请稍后关闭。'); return }
    const result = files.close(id, false, pane)
    if (result === 'dirty') {
      pendingClose = { kind: 'document', id, pane }
      paletteRef.value?.close(); settingsRef.value?.close()
      discardRef.value?.open(manager.metadata(id)?.name || '文档')
    } else if (result === 'composing') composingHint()
  }
  async function discardPending() {
    if (fileBusy.value || manager.isComposing) { composingHint(); return }
    const pending = pendingClose
    pendingClose = null
    if (pending?.kind === 'document') files.close(pending.id, true, pending.pane)
    else if (pending?.kind === 'window') {
      try { await flushSettings(); await (await import('@tauri-apps/api/window')).getCurrentWindow().destroy() }
      catch { toast('关闭窗口失败，编辑内容仍保留在当前窗口。') }
    }
    void drainPending()
  }
  async function savePending() {
    const pending = pendingClose
    if (!pending || fileBusy.value || manager.isComposing) return
    const ids = pending.kind === 'document' ? [pending.id] : manager.openedDocuments.filter(doc => doc.dirty).map(doc => doc.id)
    for (const id of ids) if (!await saveDoc(id)) return
    if (pendingClose !== pending || manager.isComposing || (pending.kind === 'window' && manager.hasDirtyDocuments)) return
    discardRef.value?.close()
    if (pending.kind === 'document') { files.close(pending.id, false, pending.pane); pendingClose = null }
    else await discardPending()
    void drainPending()
  }
  function setLanguage(language: LanguageName) { if (manager.activeId) void manager.setLanguage(manager.activeId, language) }
  function setMarkdownMode(mode: MarkdownMode) { if (manager.activeId && !manager.setMarkdownMode(manager.activeId, mode) && manager.isComposing) composingHint() }

  function openGotoLine() {
    gotoLineRef.value?.open()
  }

  function handleGotoLine(payload: { line: number; column: number }) {
    if (manager.activeId) {
      manager.gotoLine(manager.activeId, payload.line, payload.column)
    }
  }

  function toggleSplitPane() {
    if (manager.isComposing) { composingHint(); return }
    if (manager.isSplit) {
      manager.closeSplit()
      toast('已关闭分栏视图')
    } else {
      manager.splitEditor()
      toast('已开启双 Pane 分栏视图')
    }
  }

  async function copyFullPath() {
    if (activeDoc.value?.path) {
      try {
        await navigator.clipboard.writeText(activeDoc.value.path)
        toast('已复制文件完整路径')
      } catch {
        toast('复制失败')
      }
    }
  }

  async function copyRelativePath() {
    if (activeDoc.value?.path) {
      const p = relativeFilePath(activeDoc.value.path, workspace.rootPath)
      try {
        await navigator.clipboard.writeText(p)
        toast('已复制文件相对路径')
      } catch {
        toast('复制失败')
      }
    }
  }

  async function revealInExplorer() {
    if (activeDoc.value?.fileToken && desktop) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('reveal_in_explorer', { token: activeDoc.value.fileToken })
      } catch (e) {
        toast(`在文件管理器显示失败: ${e}`)
      }
    }
  }

  function zoomIn() {
    fontSize.value = Math.min(24, fontSize.value + 1)
  }

  function zoomOut() {
    fontSize.value = Math.max(10, fontSize.value - 1)
  }

  function resetZoom() {
    fontSize.value = 14
  }

  function handleEditorWheel(event: WheelEvent) {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    // Chromium may keep delivering a wheel sequence to its original scroll target.
    const hovered = document.elementFromPoint(event.clientX, event.clientY) || event.target
    if (!(hovered instanceof Element) || !hovered.closest('.pane-body')) return
    if (!event.deltaY || manager.isComposing) return
    if (event.deltaY < 0) zoomIn(); else zoomOut()
  }

  const paletteActions = computed<PaletteAction[]>(() => {
    revision.value
    const actions: PaletteAction[] = [
      { id: 'new', title: '新建文本草稿', detail: 'Ctrl+N', category: 'action', action: createNewDoc },
      { id: 'open', title: '打开文件', detail: desktop ? 'Ctrl+O' : '需要 Tauri 桌面版', category: 'file', disabled: !desktop || fileBusy.value, action: () => void openFile() },
      { id: 'save', title: '保存文件', detail: 'Ctrl+S', category: 'action', disabled: !desktop || fileBusy.value, action: () => void saveActive() },
      { id: 'save-as', title: '另存为', detail: 'Ctrl+Shift+S', category: 'action', disabled: !desktop || fileBusy.value, action: () => void saveActive(true) },
      { id: 'save-utf8', title: '另存为 UTF-8', detail: '转换编码，无 BOM', category: 'action', disabled: !desktop || fileBusy.value, action: () => void saveActive(true, 'UTF-8') },
      { id: 'find', title: '查找当前文档', detail: 'Ctrl+F', category: 'action', action: () => manager.command('find') },
      { id: 'replace', title: '替换当前文档', detail: 'Ctrl+H', category: 'action', action: () => manager.command('replace') },
      { id: 'find-next', title: '查找下一个', detail: 'F3', category: 'action', action: () => manager.command('find-next') },
      { id: 'find-previous', title: '查找上一个', detail: 'Shift+F3', category: 'action', action: () => manager.command('find-previous') },
      { id: 'switch-pane', title: '切换活动窗格', detail: 'Ctrl+Alt+Right', category: 'action', disabled: !manager.isSplit, action: () => manager.switchPane() },
      { id: 'uppercase', title: '选区转大写', detail: 'Ctrl+Alt+U', category: 'action', action: () => manager.transformSelection(true) },
      { id: 'lowercase', title: '选区转小写', detail: 'Ctrl+Alt+L', category: 'action', action: () => manager.transformSelection(false) },
      { id: 'goto-line', title: '转到指定行', detail: 'Ctrl+G', category: 'action', action: openGotoLine },
      { id: 'split-editor', title: manager.isSplit ? '关闭分栏' : '双 Pane 分栏编辑', detail: 'Ctrl+\\', category: 'action', action: toggleSplitPane },
      { id: 'copy-path', title: '复制文件完整路径', detail: '剪贴板', category: 'action', disabled: !activeDoc.value?.path, action: () => void copyFullPath() },
      { id: 'copy-relative-path', title: '复制文件相对路径', detail: '剪贴板', category: 'action', disabled: !activeDoc.value?.path, action: () => void copyRelativePath() },
      { id: 'reveal-explorer', title: '在文件管理器中显示', detail: desktop ? '系统资源管理器' : '需要 Tauri 桌面版', category: 'action', disabled: !desktop || !activeDoc.value?.fileToken, action: () => void revealInExplorer() },
      { id: 'zoom-in', title: '放大字体', detail: 'Ctrl+=', category: 'action', action: zoomIn },
      { id: 'zoom-out', title: '缩小字体', detail: 'Ctrl+-', category: 'action', action: zoomOut },
      { id: 'zoom-reset', title: '恢复默认字体大小', detail: 'Ctrl+0', category: 'action', action: resetZoom },
      { id: 'undo', title: '撤销', detail: 'Ctrl+Z', category: 'action', action: () => manager.command('undo') },
      { id: 'redo', title: '重做', detail: 'Ctrl+Y', category: 'action', action: () => manager.command('redo') },
      { id: 'open-workspace', title: '打开工作区文件夹', detail: desktop ? '选择目录' : '需要 Tauri 桌面版', category: 'action', disabled: !desktop || fileBusy.value, action: () => void workspace.openWorkspaceDialog() },
      { id: 'add-workspace', title: '添加文件夹到工作区…', detail: desktop ? '选择目录 · 保留现有文件夹' : '需要 Tauri 桌面版', category: 'action', disabled: !desktop || fileBusy.value, action: () => void workspace.openWorkspaceDialog(true) },
      { id: 'workspace-search', title: '工作区全文搜索', detail: 'Ctrl+Shift+F', category: 'action', action: () => { sidebarPanel.value = 'search'; sidebarVisible.value = true } },
      { id: 'refresh-workspace', title: '刷新工作区目录树', detail: '工作区', category: 'action', disabled: !workspace.rootPath, action: () => void workspace.refreshDirectory() },
      { id: 'single', title: '切换到单文件模式', detail: '布局', category: 'action', action: () => setMode('single') },
      { id: 'workspace', title: '切换到工作区模式', detail: '布局', category: 'action', action: () => setMode('workspace') },
      { id: 'sidebar', title: '显示/隐藏侧边栏', detail: 'Ctrl+B', category: 'action', action: toggleSidebar },
      { id: 'theme', title: '切换主题：深色 / 浅色 / 跟随系统', detail: '外观', category: 'action', action: toggleTheme },
      { id: 'settings', title: '打开首选项', detail: '设置', category: 'action', action: openSettings },
    ]
    const encodings: Encoding[] = ['UTF-8', 'UTF-16LE', 'UTF-16BE', 'GB18030', 'windows-1252']
    for (const action of actions) if (action.id in shortcuts.value) action.detail = shortcuts.value[action.id as ShortcutAction].replace('Mod', 'Ctrl')
    return [...actions,
      ...encodings.map(encoding => ({ id: `open-${encoding}`, title: `按 ${encoding} 编码打开文件`, detail: '原生文件选择', category: 'action' as const, disabled: !desktop || fileBusy.value, action: () => void openFile(encoding) })),
      ...encodings.map(encoding => ({ id: `reopen-${encoding}`, title: `用 ${encoding} 编码重新打开`, detail: '需要先保存修改', category: 'action' as const, disabled: !desktop || !activeDoc.value?.fileToken || fileBusy.value, action: () => void reopenEncoding(encoding) })),
      ...workspace.recentWorkspaces.map((path, index) => ({ id: `recent-workspace-${index}`, title: `打开工作区：${path.split(/[\\/]/).pop()}`, detail: path, category: 'action' as const, disabled: !desktop || fileBusy.value, action: () => void workspace.openWorkspacePath(path) })),
      ...(demo ? manager.catalog : manager.openedDocuments).map(doc => ({ id: `file-${doc.id}`, title: doc.name, detail: doc.path || '未命名 · 内存草稿', category: 'file' as const, action: () => handleSelectDoc(doc.id) })),
      ...(paletteRef.value?.visible ? workspace.getAllKnownFiles() : []).map(file => ({
        id: `ws-${file.path}`,
        title: file.name,
        detail: file.relativePath,
        category: 'file' as const,
        action: () => void workspace.openFile({
          id: file.relativePath,
          name: file.name,
          path: file.path,
          relativePath: file.relativePath,
          isDirectory: false,
          isSymlink: false,
          isReadOnly: false,
          size: 0,
          mtime: null,
          hasChildren: false,
        })
      })),
      ...recentFiles.value.map((file, index) => ({ id: `recent-${index}`, title: `最近：${file.name}`, detail: file.path, category: 'file' as const, disabled: fileBusy.value, action: () => void openRecent(file.path) }))]
  })

  const menuGroups = computed(() => {
    revision.value
    const actions = paletteActions.value
    const items = (...ids: string[]) => ids.map(id => actions.find(action => action.id === id)).filter((item): item is PaletteAction => !!item)
    const action = (id: string, title: string, run: () => void, disabled = false): PaletteAction => ({ id, title, detail: '', category: 'action', action: run, disabled })
    return [
      { title: '文件', items: [ ...items('new'), action('new-markdown', '新建 Markdown 文档', () => { manager.createUntitled('md') }), ...items('open','save','save-as'),
        action('close-current', '关闭当前文档', () => { if (manager.activeId) closeDocById(manager.activeId, manager.activePane) }, !activeDoc.value),
        ...openedDocuments.value.map(doc => action(`opened-${doc.id}`, `已打开：${doc.name}`, () => handleSelectDoc(doc.id, false))),
        ...actions.filter(item => /^recent-\d+$/.test(item.id)), action('quit','退出应用', () => { void quitApp() }, !desktop) ] },
      { title: '编辑', items: items('undo','redo','find','replace','find-next','find-previous','goto-line','uppercase','lowercase') },
      { title: '格式', items: markdownFormats.map(([id, title]) => action(`format-${id}`, title, () => { manager.formatMarkdown(id) }, !/\.(md|markdown)$/i.test(activeDoc.value?.name || '') || manager.isComposing)) },
      { title: '视图', items: [ ...items('single','workspace','split-editor','sidebar','zoom-in','zoom-out','zoom-reset'),
        action('md-live','Markdown 即时排版', () => setMarkdownMode('live'), !activeDoc.value?.mode), action('md-source','Markdown 源码', () => setMarkdownMode('source'), !activeDoc.value?.mode), action('md-split','Markdown 双栏预览', () => setMarkdownMode('split'), !activeDoc.value?.mode),
        ...items('theme','settings') ] },
      { title: '工作区', items: [ ...items('open-workspace','add-workspace','workspace-search','refresh-workspace'), ...actions.filter(item => item.id.startsWith('recent-workspace-')),
        ...workspace.recentWorkspaces.filter(path => !workspace.roots.some(root => root.rootPath === path)).map(path => action(`add-recent-${path}`, `添加最近文件夹：${path.split(/[\\/]/).pop()}`, () => { void workspace.openWorkspacePath(path, true) }, !desktop || fileBusy.value)),
        ...workspace.roots.map(root => action(`remove-${root.rootPath}`, `移除：${root.name}`, () => { void workspace.removeFolder(root.rootPath) })) ] },
      { title: '帮助', items: [action('help-shortcuts', '快捷键设置', () => { void settingsRef.value?.openSection('shortcuts') })] },
    ]
  })

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (document.querySelector('.app-menu-popup') && document.activeElement?.closest('.app-menu')) return
    if (document.querySelector('.workspace-operation-dialog') || event.isComposing || event.defaultPrevented || manager.isComposing || paletteRef.value?.visible || settingsRef.value?.visible || discardRef.value?.visible || gotoLineRef.value?.visible) return
    const binding = event.key === '+' && shortcuts.value['zoom-in'] === 'Mod+=' && (event.ctrlKey || event.metaKey) && !event.altKey ? 'Mod+=' : eventShortcut(event)
    const id = (Object.keys(shortcuts.value) as ShortcutAction[]).find(key => shortcuts.value[key] === binding)
    if (!id && Object.values(defaultShortcuts).includes(binding as typeof defaultShortcuts[ShortcutAction])) {
      event.preventDefault(); event.stopPropagation(); return
    }
    const control = event.target instanceof Element ? event.target.closest('input,textarea,select,[contenteditable=true]') : null
    // Ordinary inputs (including search fields) keep native editing shortcuts.
    if (control && !control.closest('.cm-content') && id && ['undo','redo','find','replace','uppercase','lowercase'].includes(id)) return
    let action: (() => void) | undefined
    if (id === 'save') action = () => void saveActive()
    else if (id === 'save-as') action = () => void saveActive(true)
    else if (id === 'open') action = () => void openFile()
    else if (id === 'palette') action = () => openPalette('action')
    else if (id === 'quick-open') action = () => openPalette('file')
    else if (id) {
      const command = paletteActions.value.find(item => item.id === id && !item.disabled)
      action = command?.action
    } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z' && control?.closest('.cm-content')) action = () => manager.command('redo')
    else if (event.key === 'Escape' && focusMode.value && !document.querySelector('.cm-search, .cm-tooltip')) action = toggleFocus
    if (action || id) { event.preventDefault(); event.stopPropagation(); action?.() }
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (manager.hasDirtyDocuments || manager.isComposing || fileBusy.value || files.saving.size) { event.preventDefault(); event.returnValue = '' }
  }
  function editorNotice(event: Event) { toast((event as CustomEvent<string>).detail) }
  watch(resolvedTheme, value => {
    document.body.classList.toggle('light', value === 'light')
    document.documentElement.style.colorScheme = value
    manager.setTheme(value)
  }, { immediate: true })
  // Serialize native updates so rapid choices cannot leave the title bar on an older theme.
  let nativeThemeWrites: Promise<void> = Promise.resolve()
  watch(theme, value => {
    if (!desktop) return
    nativeThemeWrites = nativeThemeWrites.then(async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      if (alive) await getCurrentWindow().setTheme(value === 'system' ? null : value)
    }).catch(error => { if (alive) toast(`窗口主题切换失败：${fileError(error)}`) })
  }, { immediate: true })
  watch(wordWrap, value => manager.setWrap(value), { immediate: true })
  watch(defaultMdMode, value => manager.setDefaultMarkdownMode(value), { immediate: true })
  watch(fontSize, value => { document.documentElement.style.setProperty('--editor-size', `${value}px`); manager.refreshTypography() }, { immediate: true })
  watch(fontFamily, value => { document.documentElement.style.setProperty('--font-mono', fontFamilies[value]); manager.refreshTypography() }, { immediate: true })
  watch([indentSize,useTabs], () => manager.setIndent(indentSize.value,useTabs.value), { immediate: true })
  function settingsSnapshot(): EditorSettings {
    return { theme: theme.value, fontSize: fontSize.value, fontFamily: fontFamily.value, wordWrap: wordWrap.value, showOutline: showOutline.value, autoSave: autoSave.value, autoSaveDelay: autoSaveDelay.value,
      defaultMdMode: defaultMdMode.value, indentSize: indentSize.value, useTabs: useTabs.value, shortcuts: { ...shortcuts.value }, fileModes: { ...fileModes.value } }
  }
  function flushSettings() {
    if (settingsTimer) clearTimeout(settingsTimer)
    settingsTimer = undefined
    if (!settingsReady) return settingsWrites
    const settings = settingsSnapshot()
    settingsWrites = settingsWrites.then(() => saveEditorSettings(settings)).catch(error => { toast(`首选项保存失败：${fileError(error)}`) })
    return settingsWrites
  }
  function updateShortcuts(value: EditorSettings['shortcuts']) {
    const error = validateShortcuts(value)
    if (error) { toast(error); return }
    shortcuts.value = value
  }
  watch([autoSave, autoSaveDelay], () => autoSaver.configure(desktop && settingsReady && autoSave.value, autoSaveDelay.value))
  watch([theme,fontSize,fontFamily,wordWrap,showOutline,defaultMdMode,indentSize,useTabs,shortcuts,fileModes,autoSave,autoSaveDelay], () => {
    if (!settingsReady) return
    if (settingsTimer) clearTimeout(settingsTimer)
    settingsTimer = setTimeout(() => void flushSettings(),250)
  }, { deep: true })
  watch(revision, () => {
    if (!settingsReady) return
    for (const doc of manager.openedDocuments) if (doc.fileToken && doc.mode && fileModes.value[doc.path] !== doc.mode) {
      fileModes.value = Object.fromEntries([...Object.entries(fileModes.value).filter(([path]) => path !== doc.path), [doc.path,doc.mode]].slice(-100))
      manager.setFileModes(fileModes.value)
    }
  })
  watch([appMode, sidebarVisible, sidebarWidth], () => {
    if (!desktop || !preferencesReady) return
    if (layoutTimer) clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => { void tauriFiles.persistLayout({ mode: appMode.value, sidebarVisible: sidebarVisible.value, sidebarWidth: sidebarWidth.value }).catch(error => toast(fileError(error))) }, 250)
  })
  function resumePending() { setTimeout(() => { if (pendingDrain) void drainPending() }, 0) }
  watch(() => discardRef.value?.visible, value => { if (!value) resumePending() })
  onMounted(async () => {
    window.addEventListener('editor-notice', editorNotice)
    window.addEventListener('resize', adaptWindowWidth)
    window.addEventListener('keydown', handleGlobalKeydown, true)
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('compositionend', resumePending)
    window.addEventListener('wheel', handleEditorWheel, { passive: false, capture: true })
    try {
      const settings = await loadEditorSettings()
      if (!alive) return
      theme.value = settings.theme; fontSize.value = settings.fontSize; fontFamily.value = settings.fontFamily; wordWrap.value = settings.wordWrap
      autoSave.value = settings.autoSave; autoSaveDelay.value = settings.autoSaveDelay
      showOutline.value = settings.showOutline; defaultMdMode.value = settings.defaultMdMode; indentSize.value = settings.indentSize; useTabs.value = settings.useTabs
      shortcuts.value = settings.shortcuts; fileModes.value = settings.fileModes; manager.setFileModes(settings.fileModes)
      await nextTick()
    } catch (error) { toast(`首选项读取失败，使用默认值：${fileError(error)}`) }
    settingsReady = true
    autoSaver.configure(desktop && autoSave.value, autoSaveDelay.value)
    if (desktop) {
      try { await workspace.restoreCurrent() } catch (error) { toast(`工作区恢复失败：${fileError(error)}`) }
      try {
        const unlisten = await (await import('@tauri-apps/api/window')).getCurrentWindow().onCloseRequested(async event => {
          if (fileBusy.value || files.saving.size || manager.isComposing) { event.preventDefault(); toast('请等待文件操作和输入完成后再关闭。'); return }
          await flushSettings()
          if (fileBusy.value || files.saving.size || manager.isComposing) { event.preventDefault(); return }
          if (manager.hasDirtyDocuments) {
            event.preventDefault()
            pendingClose = { kind: 'window' }
            paletteRef.value?.close(); settingsRef.value?.close()
            discardRef.value?.open('当前窗口中的文档')
          }
        })
        if (alive) unlistenWindow = unlisten
        else unlisten()
      } catch { toast('窗口关闭保护注册失败；请勿关闭含未保存修改的窗口。') }
      try {
        const unlisten = await (await import('@tauri-apps/api/event')).listen('files-pending', () => void drainPending())
        if (alive) unlistenPending = unlisten; else unlisten()
        const prefs = await tauriFiles.preferences()
        if (alive) {
          recentFiles.value = prefs.recent
          appMode.value = workspace.rootPath ? prefs.layout.mode : 'single'; sidebarWidth.value = prefs.layout.sidebarWidth; sidebarVisible.value = !!workspace.rootPath && prefs.layout.sidebarVisible && !wasNarrow
          if (prefs.warning) toast(prefs.warning)
          // Let layout watchers observe restored values before persisting changes.
          await nextTick(); preferencesReady = true
          await drainPending()
        }
      } catch (error) { toast(fileError(error)) }
    }
  })
  onUnmounted(() => {
    systemTheme.removeEventListener('change', updateSystemTheme)
    window.removeEventListener('editor-notice', editorNotice)
    window.removeEventListener('resize', adaptWindowWidth)
    alive = false
    unlistenWindow?.()
    unlistenPending?.()
    if (layoutTimer) clearTimeout(layoutTimer)
    void flushSettings()
    window.removeEventListener('keydown', handleGlobalKeydown, true)
    window.removeEventListener('beforeunload', beforeUnload)
    window.removeEventListener('compositionend', resumePending)
    window.removeEventListener('wheel', handleEditorWheel, true)
    autoSaver.dispose(); files.dispose(); workspace.destroy(); unsubscribeWorkspace(); unsubscribe(); manager.dispose()
  })
  return { appMode, sidebarVisible, sidebarWidth, sidebarPanel, focusMode, theme, fontSize, fontFamily, indentSize, useTabs, shortcuts, updateShortcuts, wordWrap, showOutline, defaultMdMode, autoSave, autoSaveDelay,
    paletteRef, settingsRef, discardRef, toastRef, manager, files, workspace, openedDocuments, mainOpenedDocuments, mainActiveId, activeDoc, activeDocId, paletteActions, menuGroups,
    setMode, toggleSidebar, handleSelectPanel, toggleTheme, toggleFocus, openSettings, openPalette, selectDocById, handleSelectDoc,
    pinDocById, createNewDoc, closeDocById, discardPending, savePending, setLanguage, setMarkdownMode,
    gotoLineRef, openGotoLine, handleGotoLine, toggleSplitPane, copyFullPath, copyRelativePath, revealInExplorer, zoomIn, zoomOut, resetZoom,
    desktop, demo, fileBusy, recentFiles, openFile, openRecent, saveActive }
}
