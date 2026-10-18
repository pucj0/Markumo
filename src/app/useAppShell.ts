import { applySyntaxStyle } from '../editor/core/syntaxTheme'
import { allCommands, commandDefinition, matchingCommand, keybindingContext, isManagedDefault, getPresetBindings } from '../features/shell/keybindings'
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
import { relativeMarkdownLink } from '../editor/markdown/links'
import { defaultMarkdownTypography, defaultMarkdownClipboard } from '../editor/markdown/wysiwyg/contracts'
import { FileController, fileError } from '../features/files/FileController'
import { openDroppedDirectories, type NativeDropInput } from '../features/files/nativeDrop'
import { sameFilePath } from '../features/files/pathKey'
import { isMedia } from '../features/files/media'
import { AutoSaveController } from '../features/files/AutoSaveController'
import { tauriFiles } from '../features/files/tauriFiles'
import type { Encoding, FileOpenEncoding, Preferences } from '../features/files/contracts'
import { WorkspaceController } from '../features/workspace/WorkspaceController'
import { tauriWorkspace } from '../features/workspace/tauriWorkspace'
import { currentSettingsVersion, currentShortcutVersion, defaultShortcuts, normalizeShortcut, eventShortcut, fontFamilies, loadEditorSettings, saveEditorSettings, validateShortcuts, relativeFilePath, type EditorSettings, type ShortcutAction } from '../features/shell/editorSettings'
import type { KeymapPresetId } from '../features/shell/keybindings'
import { readablePath } from '../features/shell/pathDisplay'
import { CommandRegistry, recentFileCommand, recentWorkspaceCommand } from '../features/shell/menuModel'
import { mainMenu } from '../features/shell/mainMenu'
import { shortcutLabel } from '../features/shell/editorSettings'
import { textClipboard } from '../features/shell/clipboard'
import { editorClipboard, inputClipboard, type ClipboardOperation } from '../editor/commands/clipboard'
import { EditorView } from '@codemirror/view'
import { WindowCloseGuard, type CloseSource } from '../features/shell/WindowCloseGuard'
import { initializeLaunch, sessionInput, SessionWriter, restoreEditorLayout } from '../features/shell/launchSession'
import { invoke } from '@tauri-apps/api/core'
import { defaultImageRules, imageRuleKey, ImageImporter, imageGateway, clipboardImages, isImageFile, type ImageRules, type ImageSource, type NativeImageInput } from '../editor/markdown/imageImport'
import { UpdateManager, updateState, openProjectPage } from '../features/shell/AppUpdater'
import { prepareInstallation } from '../features/shell/updater/prepareInstallation'
import type UpdateConfirm from '../components/modals/UpdateConfirm.vue'
import { ExportController, ImportController } from '../features/document-conversion'

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
  const uiFontSize = ref(14)
  const fontSize = ref(14), wordWrap = ref(false), showOutline = ref(false), defaultMdMode = ref<MarkdownMode>('live')
  const fontFamily = ref<EditorSettings['fontFamily']>('system'), indentSize = ref(4), useTabs = ref(false)
  const autoCheckUpdates = ref(true), autoDownloadUpdates = ref(false)
  const autoSave = ref(false), autoSaveDelay = ref(1500)
  const treeClickMode = ref<'double' | 'single'>('single')
  const autoFollowActiveFile = ref(false)
  const smartExpand = ref(true)
  const compactFolders = ref(false)
  const syntaxStyle = ref<EditorSettings['syntaxStyle']>('soft')
  const bracketMode = ref<EditorSettings['bracketMode']>('matching')
  const keymapPreset = ref<KeymapPresetId>('markumo')
  const caretAnimation = ref<EditorSettings['caretAnimation']>('smooth')
  const markdownTypography=ref(defaultMarkdownTypography())
  const outlineWidth=ref(240)
  const markdownClipboard=ref(defaultMarkdownClipboard())
  const imageRules = ref(defaultImageRules()), documentImageRules = ref<Record<string, ImageRules>>({})
  const shortcuts = ref<EditorSettings['shortcuts']>({ ...defaultShortcuts }), fileModes = ref<Record<string, MarkdownMode>>({})
  const customShortcuts = ref<ShortcutAction[]>([])
  let settingsReady = false, settingsTimer: ReturnType<typeof setTimeout> | undefined
  let settingsWrites: Promise<void> = Promise.resolve()
  let settingsError:unknown=null
  const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
  const settingsRef = ref<InstanceType<typeof SettingsModal> | null>(null)
  const updateConfirmRef=ref<InstanceType<typeof UpdateConfirm>|null>(null)
  const discardRef = ref<InstanceType<typeof DiscardDialog> | null>(null)
  const toastRef = ref<InstanceType<typeof Toast> | null>(null)
  const gotoLineRef = ref<{ open: () => void; close: () => void; visible: boolean } | null>(null)
  const manager = markRaw(new DocumentManager(demo ? sampleDocuments : []))
  const files = markRaw(new FileController(manager, tauriFiles, toast))
  const exportController = new ExportController(manager, msg => toast(msg))
  const importController = new ImportController(manager, msg => toast(msg))
  const workspace = reactive(new WorkspaceController(tauriWorkspace, manager, files, toast, false)) as WorkspaceController
  workspace.connect()
  const recentFiles = ref<Preferences['recent']>([])
  const fileBusy = ref(false)
  const updateInstalling=ref(false)
  const autoSaver = new AutoSaveController(manager, files, () => updateInstalling.value || fileBusy.value || !!discardRef.value?.visible || !!settingsRef.value?.visible || !!document.querySelector('.workspace-operation-dialog'))
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
  }
  const openedDocuments = computed(() => { revision.value; return manager.openedDocuments })
  const mainOpenedDocuments = computed(() => { revision.value; return manager.mainOpenedDocuments })
  const mainActiveId = computed(() => { revision.value; return manager.group.activeId })
  const activeDoc = computed(() => { revision.value; return manager.activeDocument })
  const activeDocId = computed(() => { revision.value; return manager.activeId })
  const currentDocumentImageRules = computed(() => activeDoc.value?.path ? documentImageRules.value[imageRuleKey(activeDoc.value.path)] || null : null)
  function updateDocumentImageRules(rules: ImageRules | null) {
    const doc = activeDoc.value
    if (!doc?.fileToken || !doc.mode) return
    const key = imageRuleKey(doc.path), next = { ...documentImageRules.value }
    if (rules) next[key] = rules; else delete next[key]
    documentImageRules.value = Object.fromEntries(Object.entries(next).slice(-100))
  }
  const imageImporter = new ImageImporter(manager,imageGateway,async id => {
    toast('请先保存 Markdown 文档，再导入图片。')
    return files.save(id)
  },id => { const path=manager.metadata(id)?.path; return path && documentImageRules.value[imageRuleKey(path)] || imageRules.value })
  async function importImages(id: string, sources: ImageSource[]) {
    if (!desktop || fileBusy.value || files.workspaceBusy || files.saving.size || manager.isComposing || discardRef.value?.visible || settingsRef.value?.visible) {
      await imageGateway.release(sources.filter((s):s is NativeImageInput=>'token' in s).map(s=>s.token)).catch(()=>{})
      toast('请先完成当前文件操作，再导入图片。'); return
    }
    fileBusy.value=true
    try { await imageImporter.insert(id,sources) }
    catch(error){toast(fileError(error))}
    finally { fileBusy.value=false; await refreshRecent();void drainPending() }
  }
  async function chooseImages() {
    const doc=manager.activeDocument
    if (!desktop || !doc?.mode || fileBusy.value || manager.isComposing) return
    // Pin before asynchronous dialogs so opening a preview tab cannot release this document.
    manager.pin(doc.id);fileBusy.value=true
    try {
      await imageImporter.insert(doc.id,()=>invoke<NativeImageInput[]>('choose_markdown_images'))
    }catch(error){toast(fileError(error))}
    finally{fileBusy.value=false;await refreshRecent();void drainPending()}
  }
  async function openRelativeLink(event:Event){
    const detail=(event as CustomEvent<{id:string;href:string}>).detail,doc=detail&&manager.metadata(detail.id)
    if(!desktop||!doc?.fileToken||fileBusy.value||manager.isComposing)return
    const target=relativeMarkdownLink(doc.path,detail.href)
    if(!target){toast('链接路径无效，未打开文件。');return}
    fileBusy.value=true
    try{
      const file=await tauriWorkspace.openWorkspaceFile(target.path)
      files.accept(file,false)
      const id=manager.openedDocuments.find(item=>sameFilePath(item.path,file.path))?.id
      if(id&&target.anchor){const source=manager.getText(id)||'',lines=source.split('\n');const line=lines.findIndex(text=>text.replace(/^#{1,6}\s+/,'').trim().toLowerCase().replace(/\s+/g,'-')===target.anchor);if(line>=0)manager.revealPosition(id,line+1,1)}
    }catch(error){toast(`无法打开相对链接：${fileError(error)}。请将目标加入授权工作区。`)}finally{fileBusy.value=false}
  }
  function imagePaste(event: ClipboardEvent) {
    const target=event.target instanceof Element ? event.target : null
    const view=target?.closest('.cm-editor') ? EditorView.findFromDOM(target.closest('.cm-editor')!) : null
    const doc=manager.activeDocument
    if (!doc?.mode || (!view&&!target?.closest('.md-prose')) || !desktop) return
    const images=Array.from(event.clipboardData?.files || []).filter(file=>file.type.startsWith('image/') || isImageFile(file.name))
    if (!images.length)return
    event.preventDefault();event.stopImmediatePropagation();void importImages(doc.id,images)
  }
  async function nativeFileDrop(payload: { inputs: NativeDropInput[]; x: number; y: number }) {
    const tokens = payload.inputs.map(input => input.token)
    try {
      let inputs = payload.inputs
      if (inputs.some(input => input.isDirectory)) {
        if (fileBusy.value || files.workspaceBusy || files.saving.size || manager.isComposing || discardRef.value?.visible || settingsRef.value?.visible) {
          toast('请完成当前操作后重新拖入文件夹。'); return
        }
        fileBusy.value = true
        try { inputs = await openDroppedDirectories(inputs, token => workspace.openDroppedWorkspace(token)) }
        finally { fileBusy.value = false }
      }
      if (!inputs.length) return
      const target=document.elementFromPoint(payload.x,payload.y), pane=target?.closest<HTMLElement>('[data-pane-id],.pane')
      const inEditor=!!target?.closest('.pane-body')
      if(pane)manager.focusPane((pane.dataset.paneId || [...pane.classList].find(name=>name.startsWith('pane-'))?.slice(5) || (pane.classList.contains('secondary-pane')?'secondary':'main')) as Parameters<DocumentManager['focusPane']>[0],false)
      const doc=manager.activeDocument, images=inputs.filter(file=>isImageFile(file.name))
      if (inEditor && doc?.mode && images.length) {
        // Mixed drops inside Markdown are imports; never open a bitmap as a Hex tab.
        const ignored=inputs.filter(file=>!isImageFile(file.name))
        await imageGateway.release(ignored.map(s=>s.token))
        if(ignored.length)toast('已忽略非图片文件；请拖到编辑区外打开。')
        const view=target?.closest('.cm-editor') ? EditorView.findFromDOM(target.closest('.cm-editor')!) : null
        const position=view?.posAtCoords({x:payload.x,y:payload.y})
        if(position!=null && !manager.isComposing)view?.dispatch({selection:{anchor:position}})
        await importImages(doc.id,images)
      }else{
        if(fileBusy.value||manager.isComposing||discardRef.value?.visible){toast('请完成当前操作后重新拖入文件。');return}
        fileBusy.value=true
        try{files.acceptBatch(await invoke('open_dropped_files',{tokens:inputs.map(s=>s.token)}))}
        finally{fileBusy.value=false;void refreshRecent()}
      }
    } finally { await imageGateway.release(tokens).catch(error => toast(fileError(error))) }
  }
  let pendingClose: { kind: 'document'; id: string; pane: string } | { kind: 'window' } | { kind: 'reopen'; id: string; encoding: FileOpenEncoding } | null = null
  let tabCloseQueue: { id: string; pane: string }[] = []
  let unlistenWindow: UnlistenFn | undefined
  let unlistenPending: UnlistenFn | undefined
  let unlistenActivate: UnlistenFn | undefined
  let unlistenDrop: UnlistenFn | undefined
  let layoutTimer: ReturnType<typeof setTimeout> | undefined
  let preferencesReady = false
  let pendingDrain = false
  let draining = false
  let alive = true
  const startupLoading=ref(desktop)
  let sessionWriter:SessionWriter|undefined
  let launchReady=false
  const updateStatus=reactive(updateState()),updatePanelOpen=ref(false)
  const updateManager=markRaw(new UpdateManager(updateStatus,{
    check:async()=>{if(!desktop)throw Error('应用更新需要 Tauri 桌面版');const {check}=await import('@tauri-apps/plugin-updater');return check({timeout:15000})},
    prepare:prepareUpdate,
    finishPreparation:()=>{updateInstalling.value=false},
    acquire:async()=>{if(import.meta.env.DEV)throw Error('开发模式不执行安装，请使用已安装的正式版。');await validateUpdateWindows();await invoke('begin_update_install')},
    release:()=>invoke('end_update_install'),
    markPending:async version=>{await invoke('mark_update_pending',{targetVersion:version});await invoke('ensure_update_window');if(manager.hasDirtyDocuments||manager.isComposing||fileBusy.value||files.workspaceBusy||files.saving.size)throw Error('编辑状态已变化，停止安装。')},
    clearPending:()=>invoke('clear_update_pending'),
    relaunch:async()=>{const {relaunch}=await import('@tauri-apps/plugin-process');await relaunch()},notify:toast,
  }))
  async function openUpdatePanel(){updatePanelOpen.value=true;if(['idle','error'].includes(updateStatus.phase))await updateManager.checkForUpdates()}
  async function openUpdateRelease(){try{await openProjectPage(desktop,true,updateStatus.version||updateStatus.confirmedVersion||undefined)}catch(error){updateStatus.error=`无法打开更新日志：${fileError(error)}`;toast(updateStatus.error)}}
  async function openUpdateLink(url:string){try{if(desktop)await invoke('open_external_link',{url});else window.open(url,'_blank','noopener,noreferrer')}catch(error){updateStatus.error=fileError(error)}}
  let reportTimer:ReturnType<typeof setTimeout>|undefined
  let lastWindowReport=''
  function reportUpdateWindow(){
    if(!desktop||!alive||reportTimer)return
    reportTimer=setTimeout(()=>{
      reportTimer=undefined
      const status={dirtyCount:manager.openedDocuments.filter(doc=>doc.dirty).length,busy:fileBusy.value||files.workspaceBusy||!!files.saving.size,composing:manager.isComposing,ready:launchReady}
      const signature=JSON.stringify(status)
      if(signature===lastWindowReport)return
      lastWindowReport=signature
      void invoke('report_update_window',{status}).catch(()=>{lastWindowReport=''})
    },150)
  }
  watch([revision,fileBusy,updateInstalling,startupLoading],reportUpdateWindow)
  watch([autoCheckUpdates,autoDownloadUpdates,startupLoading],()=>updateManager.configure({autoCheckUpdates:autoCheckUpdates.value,autoDownloadUpdates:autoDownloadUpdates.value},!startupLoading.value),{immediate:true})
  let closeSource: CloseSource = 'native'
  const windowClose = new WindowCloseGuard({
    status: () => ({ fileBusy: fileBusy.value || files.workspaceBusy || updateInstalling.value || !!updateConfirmRef.value?.visible, savingCount: files.saving.size,
      composing: manager.isComposing, dirtyCount: manager.openedDocuments.filter(doc => doc.dirty).length,
      documentCount: manager.openedDocuments.length, activePane: manager.activePane, hasActiveDocument: !!manager.activeId }),
    flush: async()=>{await flushSettings();scheduleSession();await sessionWriter?.flush()},
    confirmDirty: () => {
      if (pendingClose?.kind === 'window' && discardRef.value?.visible) return
      pendingClose = { kind: 'window' }
      paletteRef.value?.close(); settingsRef.value?.close()
      discardRef.value?.open('当前窗口中的文档')
    },
    destroy: async () => { if (alive) await (await import('@tauri-apps/api/window')).getCurrentWindow().destroy() },
    blocked: reason => toast(reason === 'composing' ? '请先完成当前输入法输入，再关闭窗口。' : '请等待当前文件操作完成后再关闭。'),
    failed: () => toast('关闭窗口失败，编辑内容仍保留在当前窗口。'),
    diagnose: data => console.info('[Markumo close]', data),
  })
  let wasNarrow = window.innerWidth < 900
  function adaptWindowWidth() {
    const narrow = window.innerWidth < 900
    if (narrow && !wasNarrow) sidebarVisible.value = false
    wasNarrow = narrow
  }

  function toast(message: string) { toastRef.value?.show(message) }
  async function refreshRecent() {
    if (!desktop || !alive || updateInstalling.value) return
    try { const prefs = await tauriFiles.preferences(); if (alive) recentFiles.value = prefs.recent }
    catch (error) { toast(fileError(error)) }
  }
  async function openFile(encoding?: FileOpenEncoding) {
    if (!desktop) { toast('浏览器仅支持内存编辑；请使用 Tauri 桌面版打开或保存磁盘文件。'); return }
    if (fileBusy.value || manager.isComposing) { composingHint(); return }
    fileBusy.value = true
    try { await files.open(encoding); await refreshRecent() } finally { fileBusy.value = false; void drainPending() }
  }
  async function openRecent(path: string) {
    if (fileBusy.value || manager.isComposing) { composingHint(); return }
    fileBusy.value = true
    try { await files.recent(path); await refreshRecent() } finally { fileBusy.value = false; void drainPending() }
  }
  async function runFileOperation(action:()=>Promise<unknown>){
    if(fileBusy.value||files.workspaceBusy||updateInstalling.value||manager.isComposing){toast('请先完成当前文件操作和输入。');return}
    fileBusy.value=true
    try{await action()}catch(error){toast(fileError(error))}finally{fileBusy.value=false;void drainPending()}
  }
  async function saveDoc(id: string, saveAs = false, encoding?: Encoding) {
    if (!desktop) { toast('浏览器仅支持内存编辑；请使用 Tauri 桌面版打开或保存磁盘文件。'); return false }
    if (fileBusy.value) return false
    fileBusy.value = true
    try { const saved = await files.save(id, saveAs, encoding); await refreshRecent(); return saved }
    finally { fileBusy.value = false; void drainPending() }
  }
  function saveActive(saveAs = false, encoding?: Encoding) { if (manager.activeId) return saveDoc(manager.activeId, saveAs, encoding); return Promise.resolve(false) }
  async function quitApp(source: CloseSource = 'command') {
    if (!desktop) return
    closeSource = source
    try { await (await import('@tauri-apps/api/window')).getCurrentWindow().close() }
    catch (error) { closeSource = 'native'; toast(`退出失败：${fileError(error)}`) }
  }
  async function validateUpdateWindows(){
        const other=await invoke<({dirtyCount:number;ready:boolean}|null)[]>('update_windows_status')
        if(other.length){const dirty=other.reduce((n,state)=>n+(state?.dirtyCount||0),0);throw Error('另有 '+other.length+' 个 Markumo 窗口'+(dirty?'，包含 '+dirty+' 个未保存文档':'')+(other.some(state=>!state?.ready)?'（部分窗口状态尚未就绪）':'')+'。请先在这些窗口保存修改并关闭窗口，再重试安装。')}
        await invoke('ensure_update_window')

  }
  async function prepareUpdate(){
    if(!desktop)return false
    if(!launchReady)throw Error('启动会话恢复尚未就绪，请重新启动后再安装更新。')
    return prepareInstallation({
      status:()=>({dirtyIds:manager.openedDocuments.filter(doc=>doc.dirty).map(doc=>doc.id),busy:startupLoading.value||fileBusy.value||files.workspaceBusy||!!files.saving.size||!!discardRef.value?.visible||!!document.querySelector('.workspace-operation-dialog'),composing:manager.isComposing}),
      validateWindows:validateUpdateWindows,
      confirmSave:async count=>{settingsRef.value?.close();paletteRef.value?.close();return await updateConfirmRef.value?.confirm(count)??false},
      save:id=>files.save(id),lock:value=>{updateInstalling.value=value},
      persist:async()=>{
        await flushSettings(true)
        const writer=sessionWriter||new SessionWriter(input=>invoke('persist_session',{input,forUpdate:true}),()=>{})
        try {
          writer.schedule(sessionInput(manager,workspace.roots,{mode:appMode.value,sidebarVisible:sidebarVisible.value,sidebarWidth:sidebarWidth.value}))
          await writer.flush(true)
        } finally { if(!sessionWriter)writer.dispose() }
      },
    })
  }
  async function reopenEncoding(encoding: FileOpenEncoding, force = false) {
    const doc = manager.activeDocument
    if (isMedia(doc)) return
    if (!doc?.fileToken) { toast('请先打开真实文件。'); return }
    if (doc.kind === 'javaClass' && encoding !== 'Hex') { toast('请使用“编辑文件字节”切回可编辑内容。'); return }
    if (fileBusy.value || manager.isComposing) { composingHint(); return }
    if (doc.dirty && !force) {
      pendingClose = { kind: 'reopen', id: doc.id, encoding }
      paletteRef.value?.close(); settingsRef.value?.close()
      discardRef.value?.open(doc.name)
      return
    }
    fileBusy.value = true
    try { await files.reopen(encoding, true) } finally { fileBusy.value = false; void drainPending() }
  }
  async function convertEncoding(payload: { encoding: Encoding; bom: boolean }) {
    const doc = manager.activeDocument
    if (!doc?.fileToken) { toast('内存草稿请直接另存为；已有磁盘文件方可转换编码。'); return }
    if (doc.kind === 'javaClass' || doc.encoding === 'Hex') { toast('二进制/字节模式不支持直接转换文本编码。'); return }
    if (fileBusy.value || manager.isComposing) { composingHint(); return }
    fileBusy.value = true
    try {
      const saved = await files.save(doc.id, false, payload.encoding, payload.bom)
      if (saved) {
        toast(`已将文件编码转换为 ${payload.encoding}${payload.bom ? ' (BOM)' : ''} 并保存`)
        await refreshRecent()
      }
    } finally {
      fileBusy.value = false
      void drainPending()
    }
  }
  function saveAsEncoding(encoding: Encoding) {
    const doc = manager.activeDocument
    if (!doc) return
    if (doc.kind === 'javaClass' || doc.encoding === 'Hex') { toast('二进制/字节模式不支持直接转换文本编码。'); return }
    void saveActive(true, encoding)
  }
  async function drainPending() {
    if (!desktop || !alive || updateInstalling.value) return
    pendingDrain = true
    if (!launchReady || draining || fileBusy.value || manager.isComposing || discardRef.value?.visible) return
    draining = true
    fileBusy.value = true
    try {
      while (pendingDrain && alive) {
        pendingDrain = false
        const batch = await tauriFiles.drainPending()
        files.acceptBatch(batch)
        // A file handed to us from the shell should end up focused and visible.
        if (batch.files.length && !manager.isComposing) manager.focusPane(manager.activePane)
      }
      await refreshRecent()
    } catch (error) { toast(fileError(error)) }
    finally { draining = false; fileBusy.value = false; advanceTabCloseQueue() }
  }
  // A file opened from the shell that this window already has: select the tab.
  // The document is never re-read, so unsaved edits cannot be replaced.
  async function activateExternal(paths: readonly string[]) {
    if (!desktop || !alive || !paths.length) return
    let activated = 0
    for (const pane of manager.layout.getAllLeafIds()) {
      for (const tab of manager.layout.getPane(pane)?.group.tabs || []) {
        const doc = manager.metadata(tab.documentId)
        if (!doc?.path || !paths.some(path => sameFilePath(path, doc.path))) continue
        if (manager.open(doc.id, false, pane)) activated++
      }
    }
    if (activated) { manager.focusPane(manager.activePane); return }
    // The document was closed in the meantime: fall back to opening it again.
    void drainPending()
  }
  function setMode(mode: AppMode) { appMode.value = mode; sidebarVisible.value = mode === 'workspace' }
  function toggleSidebar() { sidebarVisible.value = !sidebarVisible.value }
  function handleSelectPanel(panel: SidebarPanel) {
    if (sidebarPanel.value === panel && sidebarVisible.value) sidebarVisible.value = false
    else { sidebarPanel.value = panel; sidebarVisible.value = true }
  }
  function toggleTheme() { theme.value = theme.value === 'dark' ? 'light' : theme.value === 'light' ? 'system' : 'dark' }
  function toggleFocus() { focusMode.value = !focusMode.value; toast(focusMode.value ? '专注模式 · Esc 退出' : '已退出专注模式') }
  function openSettings(section?: string) {
    if (discardRef.value?.visible) return
    paletteRef.value?.close()
    if (section && settingsRef.value?.openSection) {
      void settingsRef.value.openSection(section)
    } else {
      settingsRef.value?.open()
    }
  }
  function openPalette(category: 'action' | 'file' | 'all' = 'all') { if (discardRef.value?.visible) return; settingsRef.value?.close(); paletteRef.value?.open(category) }
  function composingHint() { toast('请先完成当前输入法输入，再切换或关闭文档。') }
  function selectDocById(id: string) { if (!manager.select(id, 'main') && manager.isComposing) composingHint() }
  function handleSelectDoc(id: string, preview = true) { if (!manager.open(id, preview) && manager.isComposing) composingHint() }
  function pinDocById(id: string) { manager.pin(id) }
  function createNewDoc() { if (startupLoading.value) return; if (!manager.createUntitled()) composingHint() }
  function closeDocById(id: string, pane: string = manager.activePane, queued = false) {
    if (!queued) tabCloseQueue = []
    if (fileBusy.value) { toast('文件操作进行中，请稍后关闭。'); return }
    const result = files.close(id, false, pane)
    if (result === 'dirty') {
      pendingClose = { kind: 'document', id, pane }
      paletteRef.value?.close(); settingsRef.value?.close()
      discardRef.value?.open(manager.metadata(id)?.name || '文档')
    } else if (result === 'composing') { tabCloseQueue = []; composingHint() }
    else if (result === 'saving') tabCloseQueue = []
    return result === 'closed' || result === 'missing'
  }
  function advanceTabCloseQueue() {
    // Saving also drains pending desktop opens. Resume only after that IPC has
    // released fileBusy; do not consume a queued close while it is blocked.
    while (tabCloseQueue.length && !fileBusy.value && !pendingClose && !discardRef.value?.visible) {
      const next = tabCloseQueue.shift()!
      if (!closeDocById(next.id, next.pane, true)) break
    }
  }
  function closeOtherTabs(id: string, pane: string) {
    if (fileBusy.value || files.saving.size || manager.isComposing || discardRef.value?.visible) { toast('请等待当前文件操作完成。'); return }
    if (!manager.select(id, pane)) return
    const paneModel = manager.layout.getPane(pane)
    const docs = paneModel ? paneModel.group.tabs.map(t => manager.metadata(t.documentId)!).filter(Boolean) : []
    tabCloseQueue = docs.filter(doc => doc.id !== id).map(doc => ({ id: doc.id, pane })); advanceTabCloseQueue()
  }
  function cancelPendingClose(){pendingClose=null;tabCloseQueue=[]}
  async function discardPending() {
    if (fileBusy.value || files.saving.size || files.workspaceBusy || manager.isComposing) { composingHint(); return }
    const pending = pendingClose
    pendingClose = null
    if (pending?.kind === 'document') files.close(pending.id, true, pending.pane)
    else if (pending?.kind === 'reopen') {
      fileBusy.value = true
      try { await files.reopen(pending.encoding, true) } finally { fileBusy.value = false; void drainPending() }
    }
    else if (pending?.kind === 'window') {
      try {
        await flushSettings()
        await sessionWriter?.flush()
        if (fileBusy.value || files.saving.size || files.workspaceBusy || manager.isComposing) { pendingClose = pending; return }
        await (await import('@tauri-apps/api/window')).getCurrentWindow().destroy()
      }
      catch { toast('关闭窗口失败，编辑内容仍保留在当前窗口。') }
    }
    advanceTabCloseQueue()
    void drainPending()
  }
  async function savePending() {
    const pending = pendingClose
    if (!pending || fileBusy.value || manager.isComposing) return
    if (pending.kind === 'reopen') {
      const saved = await saveDoc(pending.id)
      if (saved) {
        discardRef.value?.close()
        pendingClose = null
        fileBusy.value = true
        try { await files.reopen(pending.encoding, true) } finally { fileBusy.value = false; void drainPending() }
      }
      return
    }
    const ids = pending.kind === 'document' ? [pending.id] : manager.openedDocuments.filter(doc => doc.dirty).map(doc => doc.id)
    for (const id of ids) if (!await saveDoc(id)) return
    if (pendingClose !== pending || manager.isComposing || (pending.kind === 'window' && manager.hasDirtyDocuments)) return
    discardRef.value?.close()
    if (pending.kind === 'document') { files.close(pending.id, false, pending.pane); pendingClose = null;advanceTabCloseQueue() }
    else await discardPending()
    void drainPending()
  }
  function setLanguage(language: LanguageName) { if (manager.activeId) void manager.setLanguage(manager.activeId, language) }
  function setMarkdownMode(mode: MarkdownMode) { if (manager.activeId && !manager.setMarkdownMode(manager.activeId, mode) && manager.isComposing) composingHint() }

  function openGotoLine() {
    if (isMedia(manager.activeDocument)) return
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
    } else {
      manager.splitEditor()
    }
  }

  async function copyFullPath() {
    if (activeDoc.value?.path) {
      try {
        await textClipboard.writeText(activeDoc.value.path)
      } catch {
        toast('复制失败')
      }
    }
  }

  async function copyRelativePath() {
    if (activeDoc.value?.path) {
      const p = relativeFilePath(activeDoc.value.path, workspace.rootPath)
      try {
        await textClipboard.writeText(p)
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

  async function revealInExplorerToken(token: string) {
    if (token && desktop) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('reveal_in_explorer', { token })
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
    if (hovered.closest('.media-viewer')) return
    if (!event.deltaY || manager.isComposing) return
    if (event.deltaY < 0) zoomIn(); else zoomOut()
  }

  const paletteActions = computed<PaletteAction[]>(() => {
    revision.value
    const actions: PaletteAction[] = [
      {id:'palette',title:'命令面板',detail:'',category:'action',action:()=>openPalette('action')},
      {id:'quick-open',title:'快速打开文件',detail:'',category:'action',action:()=>openPalette('file')},
      { id: 'new', title: '新建文本草稿', detail: 'Ctrl+N', category: 'action', action: createNewDoc },
      { id:'new-markdown',title:'新建 Markdown 文档',detail:'Markdown',category:'action',action:()=>{manager.createUntitled('md')} },
      { id:'close-current',title:'关闭文件',detail:'',category:'action',disabled:!activeDoc.value,action:()=>{if(manager.activeId)closeDocById(manager.activeId,manager.activePane)} },
      { id:'quit',title:'退出应用',detail:'',category:'action',disabled:!desktop,action:()=>{void quitApp()} },
      { id:'cut',title:'剪切',detail:shortcutLabel('Mod+X'),category:'action',disabled:!activeDoc.value || activeDoc.value.kind==='javaClass',action:()=>{void clipboardAction('cut')} },
      { id:'copy',title:'复制',detail:shortcutLabel('Mod+C'),category:'action',disabled:!activeDoc.value,action:()=>{void clipboardAction('copy')} },
      { id:'paste',title:'粘贴',detail:shortcutLabel('Mod+V'),category:'action',disabled:!activeDoc.value || activeDoc.value.kind==='javaClass',action:()=>{void clipboardAction('paste')} },
      { id:'select-all',title:'全选',detail:shortcutLabel('Mod+A'),category:'action',disabled:!activeDoc.value,action:()=>{void clipboardAction('select-all')} },
      { id:'outline',title:'显示文档大纲',detail:'',category:'action',disabled:!activeDoc.value,action:()=>{showOutline.value=!showOutline.value} },
      { id:'wrap',title:'自动换行',detail:'',category:'action',action:()=>{wordWrap.value=!wordWrap.value} },
      { id:'focus',title:'专注模式',detail:'',category:'action',action:toggleFocus },
      { id:'explorer',title:'资源管理器',detail:'',category:'action',action:()=>{focusMode.value=false;appMode.value='workspace';sidebarPanel.value='files';sidebarVisible.value=true} },
      ...(['live','source','split'] as const).map(mode=>({id:`md-${mode}`,title:{live:'Markdown 实时排版',source:'Markdown 源码编辑',split:'Markdown 双栏预览'}[mode],detail:'',category:'action' as const,disabled:!activeDoc.value?.mode || manager.isComposing,action:()=>setMarkdownMode(mode)})),
      ...markdownFormats.map(([id,title])=>({id:id==='bold'||id==='italic'?id:`format-${id}`,title,detail:'',category:'action' as const,disabled:activeDoc.value?.kind==='javaClass'||!activeDoc.value?.mode||manager.isComposing||(id==='image'&&(!desktop||fileBusy.value||!!activeDoc.value?.readOnly)),action:()=>{if(id==='image')void chooseImages();else manager.formatMarkdown(id)}})),
      { id: 'open', title: '打开文件', detail: desktop ? 'Ctrl+O' : '需要 Tauri 桌面版', category: 'file', disabled: !desktop || fileBusy.value, action: () => void openFile() },
      { id: 'save', title: '保存文件', detail: 'Ctrl+S', category: 'action', disabled: !desktop || fileBusy.value || activeDoc.value?.kind === 'javaClass', action: () => void saveActive() },
      { id: 'save-as', title: '另存为', detail: 'Ctrl+Shift+S', category: 'action', disabled: !desktop || fileBusy.value || activeDoc.value?.kind === 'javaClass', action: () => void saveActive(true) },
      { id: 'save-utf8', title: '另存为 UTF-8', detail: '转换编码，无 BOM', category: 'action', disabled: !desktop || fileBusy.value || activeDoc.value?.kind === 'javaClass' || activeDoc.value?.encoding === 'Hex', action: () => void saveActive(true, 'UTF-8') },
      { id: 'import-html', title: '导入 HTML…', detail: 'HTML 转 Markdown', category: 'action', action: () => void runFileOperation(() => importController.importDocument('html')) },
      { id: 'import-docx', title: '导入 Word (.docx)…', detail: 'Word 转 Markdown (Pandoc)', category: 'action', action: () => void runFileOperation(() => importController.importDocument('docx')) },
      { id: 'export-pdf', title: '导出 PDF…', detail: '导出为 PDF 文档', category: 'action', disabled: !exportController.canExportActive(), action: () => void runFileOperation(() => exportController.exportDocument('pdf')) },
      { id: 'export-html', title: '导出 HTML…', detail: '包含排版样式', category: 'action', disabled: !exportController.canExportActive(), action: () => void runFileOperation(() => exportController.exportDocument('html')) },
      { id: 'export-html-plain', title: '导出 HTML（无主题样式）…', detail: '语义化纯 HTML', category: 'action', disabled: !exportController.canExportActive(), action: () => void runFileOperation(() => exportController.exportDocument('html-plain')) },
      { id: 'export-docx', title: '导出 Word (.docx)…', detail: 'Markdown 转 Word (Pandoc)', category: 'action', disabled: !exportController.canExportActive(), action: () => void runFileOperation(() => exportController.exportDocument('docx')) },
      { id: 'export-png', title: '导出 PNG 长图…', detail: '整页高清长图', category: 'action', disabled: !exportController.canExportActive(), action: () => void runFileOperation(() => exportController.exportDocument('png')) },
      { id: 'export-repeat', title: '使用上一次设置导出', detail: '', category: 'action', disabled: !exportController.canExportActive(), action: () => void runFileOperation(() => exportController.exportRepeat()) },
      { id: 'export-settings', title: '导出设置…', detail: '首选项', category: 'action', action: () => openSettings('conversion') },
      { id: 'find', title: '查找当前文档', detail: 'Ctrl+F', category: 'action', action: () => manager.command('find') },
      { id: 'replace', title: '替换当前文档', detail: 'Ctrl+R', category: 'action', disabled: activeDoc.value?.kind === 'javaClass', action: () => manager.command('replace') },
      { id: 'find-next', title: '查找下一个', detail: 'F3', category: 'action', action: () => manager.command('find-next') },
      { id: 'find-previous', title: '查找上一个', detail: 'Shift+F3', category: 'action', action: () => manager.command('find-previous') },
      { id: 'switch-pane', title: '切换活动窗格', detail: 'Ctrl+Alt+Right', category: 'action', disabled: !manager.isSplit, action: () => manager.switchPane() },
      { id: 'uppercase', title: '选区转大写', detail: 'Ctrl+Alt+U', category: 'action', action: () => manager.transformSelection(true) },
      { id: 'lowercase', title: '选区转小写', detail: 'Ctrl+Alt+L', category: 'action', action: () => manager.transformSelection(false) },
      { id: 'goto-line', title: '转到指定行', detail: 'Ctrl+G', category: 'action', action: openGotoLine },
      { id: 'split-editor', title: '向右拆分分栏', detail: '', category: 'action', action: () => manager.splitPane('right') },
      { id: 'split-right', title: '向右拆分', detail: '', category: 'action', action: () => manager.splitPane('right') },
      { id: 'split-down', title: '向下拆分', detail: '', category: 'action', action: () => manager.splitPane('bottom') },
      { id: 'split-left', title: '向左拆分', detail: '', category: 'action', action: () => manager.splitPane('left') },
      { id: 'split-up', title: '向上拆分', detail: '', category: 'action', action: () => manager.splitPane('top') },
      { id: 'maximize-pane', title: '最大化当前编辑器', detail: '', category: 'action', action: () => manager.layout.maximizePane(manager.activePaneId) },
      { id: 'restore-pane', title: '恢复编辑器布局', detail: '', category: 'action', action: () => manager.layout.restoreMaximized() },
      { id: 'merge-panes', title: '合并所有分栏', detail: '', category: 'action', action: () => manager.mergeAllPanes() },
      { id: 'close-current-pane', title: '关闭当前分栏', detail: '', category: 'action', disabled: !manager.isSplit, action: () => manager.closePane(manager.activePaneId) },
      { id: 'delete-line', title: '删除当前行', detail: 'Ctrl+Shift+K', category: 'action', action: () => manager.command('delete-line') },
      { id: 'copy-line-down', title: '向下复制行', detail: 'Shift+Alt+Down', category: 'action', action: () => manager.command('copy-line-down') },
      { id: 'move-line-up', title: '向上移动行', detail: 'Alt+Up', category: 'action', action: () => manager.command('move-line-up') },
      { id: 'move-line-down', title: '向下移动行', detail: 'Alt+Down', category: 'action', action: () => manager.command('move-line-down') },
      { id: 'comment-line', title: '切换行注释', detail: 'Ctrl+/', category: 'action', action: () => manager.command('comment-line') },
      { id: 'fold-code', title: '折叠当前代码块', detail: 'Ctrl+Alt+[', category: 'action', action: () => manager.command('fold-code') },
      { id: 'unfold-code', title: '展开当前代码块', detail: 'Ctrl+Alt+]', category: 'action', action: () => manager.command('unfold-code') },
      { id: 'next-tab', title: '切换到下一标签', detail: 'Ctrl+Alt+Right', category: 'action', action: () => {
        const group = manager.paneGroup(manager.activePane)
        const tabs = group.tabs
        if (tabs.length > 1 && group.activeId) {
          const idx = tabs.findIndex(t => t.documentId === group.activeId)
          const next = tabs[(idx + 1) % tabs.length]
          if (next) manager.select(next.documentId, manager.activePane)
        }
      }},
      { id: 'previous-tab', title: '切换到上一标签', detail: 'Ctrl+Alt+Left', category: 'action', action: () => {
        const group = manager.paneGroup(manager.activePane)
        const tabs = group.tabs
        if (tabs.length > 1 && group.activeId) {
          const idx = tabs.findIndex(t => t.documentId === group.activeId)
          const prev = tabs[(idx - 1 + tabs.length) % tabs.length]
          if (prev) manager.select(prev.documentId, manager.activePane)
        }
      }},
      { id: 'toggle-outline', title: '显示/隐藏大纲', detail: '', category: 'action', action: () => { showOutline.value = !showOutline.value } },
      { id: 'toggle-focus', title: '切换专注模式', detail: 'F8', category: 'action', action: toggleFocus },
      { id: 'table', title: '插入表格', detail: 'Ctrl+T', category: 'action', action: () => manager.formatMarkdown('table') },
      { id: 'code-block', title: '插入代码块', detail: 'Ctrl+Shift+K', category: 'action', action: () => manager.formatMarkdown('code-block') },
      { id: 'quote', title: '插入引用块', detail: 'Ctrl+Shift+Q', category: 'action', action: () => manager.formatMarkdown('quote') },
      { id: 'link', title: '插入/编辑链接', detail: 'Ctrl+K', category: 'action', action: () => manager.formatMarkdown('link') },
      { id: 'image', title: '插入图片', detail: 'Ctrl+Shift+I', category: 'action', action: () => { if (fileBusy.value || activeDoc.value?.readOnly) return; if (desktop) void chooseImages(); else manager.formatMarkdown('image') } },
      { id: 'inline-code', title: '插入行内代码', detail: 'Ctrl+Shift+`', category: 'action', action: () => manager.formatMarkdown('inline-code') },
      { id: 'strike', title: '删除线', detail: 'Alt+Shift+5', category: 'action', action: () => manager.formatMarkdown('strike') },
      { id: 'heading-1', title: '一级标题 (H1)', detail: 'Ctrl+1', category: 'action', action: () => manager.formatMarkdown('heading-1') },
      { id: 'heading-2', title: '二级标题 (H2)', detail: 'Ctrl+2', category: 'action', action: () => manager.formatMarkdown('heading-2') },
      { id: 'heading-3', title: '三级标题 (H3)', detail: 'Ctrl+3', category: 'action', action: () => manager.formatMarkdown('heading-3') },
      { id: 'heading-4', title: '四级标题 (H4)', detail: 'Ctrl+4', category: 'action', action: () => manager.formatMarkdown('heading-4') },
      { id: 'heading-5', title: '五级标题 (H5)', detail: 'Ctrl+5', category: 'action', action: () => manager.formatMarkdown('heading-5') },
      { id: 'heading-6', title: '六级标题 (H6)', detail: 'Ctrl+6', category: 'action', action: () => manager.formatMarkdown('heading-6') },
      { id: 'heading-0', title: '普通段落', detail: 'Ctrl+0', category: 'action', action: () => manager.formatMarkdown('heading-0') },
      { id: 'md-mode-live', title: 'Markdown 实时排版', detail: 'Ctrl+Alt+1', category: 'action', action: () => setMarkdownMode('live') },
      { id: 'md-mode-source', title: 'Markdown 源码编辑', detail: 'Ctrl+Alt+2', category: 'action', action: () => setMarkdownMode('source') },
      { id: 'md-mode-split', title: 'Markdown 双栏预览', detail: 'Ctrl+Alt+3', category: 'action', action: () => setMarkdownMode('split') },
      { id: 'focus-left-pane', title: '聚焦左侧分栏', detail: '', category: 'action', action: () => manager.layout.focusDirection('left') },
      { id: 'focus-right-pane', title: '聚焦右侧分栏', detail: '', category: 'action', action: () => manager.layout.focusDirection('right') },
      { id: 'focus-up-pane', title: '聚焦上方分栏', detail: '', category: 'action', action: () => manager.layout.focusDirection('up') },
      { id: 'focus-down-pane', title: '聚焦下方分栏', detail: '', category: 'action', action: () => manager.layout.focusDirection('down') },
      { id: 'focus-next-pane', title: '切换到下一个分栏', detail: '', category: 'action', action: () => manager.layout.focusNextPane() },
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
    if (isMedia(activeDoc.value)) {
      const textCommands = new Set(['save','save-as','save-utf8','cut','paste','replace','undo','redo','uppercase','lowercase','goto-line','delete-line','copy-line-down','move-line-up','move-line-down','comment-line','fold-code','unfold-code'])
      for (const action of actions) if (textCommands.has(action.id)) action.disabled = true
    }
    for (const action of actions) {
      const definition = commandDefinition(action.id)
      if (definition) action.detail = shortcutLabel(shortcuts.value[definition.id])
    }
    return [...actions,
      { id:'open-file-bytes',title:'以字节方式打开文件',detail:'可编辑十六进制',category:'action' as const,disabled:!desktop||fileBusy.value,action:()=>void openFile('Hex') },
      { id:'edit-file-bytes',title:'编辑文件字节',detail:'可编辑十六进制',category:'action' as const,disabled:!desktop||!activeDoc.value?.fileToken||fileBusy.value||isMedia(activeDoc.value),action:()=>void reopenEncoding('Hex') },
      { id:'inspect-class',title:'查看 JVM ClassFile 结构',detail:'只读结构信息',category:'action' as const,disabled:!desktop||!activeDoc.value?.fileToken||activeDoc.value.encoding!=='Hex'||fileBusy.value,action:()=>void reopenEncoding('ClassInfo') },
      ...encodings.map(encoding => ({ id: `open-${encoding}`, title: `按 ${encoding} 编码打开文件`, detail: '原生文件选择', category: 'action' as const, disabled: !desktop || fileBusy.value, action: () => void openFile(encoding) })),
      ...encodings.map(encoding => ({ id: `reopen-${encoding}`, title: `用 ${encoding} 编码重新打开`, detail: '需要先保存修改', category: 'action' as const, disabled: !desktop || !activeDoc.value?.fileToken || fileBusy.value || isMedia(activeDoc.value), action: () => void reopenEncoding(encoding) })),
      ...workspace.recentWorkspaces.map(path => ({ id: recentWorkspaceCommand(path), title: `打开工作区：${path.split(/[\\/]/).pop()}`, detail: readablePath(path), category: 'action' as const, disabled: !desktop || fileBusy.value, action: () => void workspace.openWorkspacePath(path) })),
      ...(demo ? manager.catalog : manager.openedDocuments).map(doc => ({ id: `file-${doc.id}`, title: doc.name, fileName: doc.name, detail: doc.path || '未命名 · 内存草稿', category: 'file' as const, action: () => handleSelectDoc(doc.id) })),
      ...(paletteRef.value?.visible ? workspace.getAllKnownFiles() : []).map(file => ({
        id: `ws-${file.path}`,
        title: file.name,
        fileName: file.name,
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
      ...recentFiles.value.map(file => ({ id: recentFileCommand(file.path), title: `最近：${file.name}`, fileName: file.name, detail: readablePath(file.path), category: 'file' as const, disabled: !desktop || fileBusy.value, action: () => void openRecent(file.path) }))]
  })

  const commandRegistry = computed(() => {
    const actions = paletteActions.value
    const commands = actions.map(action => {
      const definition = commandDefinition(action.id)
      const clipboardKey = ({cut:'Mod+X',copy:'Mod+C',paste:'Mod+V','select-all':'Mod+A'} as Record<string,string>)[action.id]
      return {
        id:action.id,title:action.title,detail:action.detail,
        enabled:!action.disabled && (definition?.category !== 'markdown' || (!!activeDoc.value?.mode && !manager.isComposing)),
        shortcut:definition ? shortcuts.value[definition.id] : clipboardKey,
        run:action.action,
      }
    })
    for (const command of allCommands) {
      if (commands.some(item => item.id === command.id)) continue
      const entry = commands.find(item => item.id === command.executeId)
      if (entry) commands.push({...entry,id:command.id,shortcut:shortcuts.value[command.id]})
    }
    return new CommandRegistry(commands)
  })
  const menuGroups = computed(() => {revision.value;return mainMenu({sidebar:sidebarVisible.value,outline:showOutline.value,wrap:wordWrap.value,split:manager.isSplit,focus:focusMode.value,
    markdown:!!activeDoc.value?.mode,markdownMode:activeDoc.value?.mode,composing:manager.isComposing,recentFiles:recentFiles.value,recentWorkspaces:workspace.recentWorkspaces,
    canExport: exportController.canExportActive()})})
  function executeCommand(id:string) {
    if(startupLoading.value)return
    try {const result=commandRegistry.value.execute(id);if(result instanceof Promise)void result.catch(error=>toast(fileError(error)))}catch(error){toast(fileError(error))}
  }
  async function clipboardAction(operation:ClipboardOperation) {
    try {
      const element=document.activeElement
      if(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) await inputClipboard(element,operation,textClipboard)
      else if (manager.activeDocument?.kind === 'pdf') {
        if(operation==='copy') await textClipboard.writeText(window.getSelection()?.toString() || '')
        else if(operation==='select-all') { const host=document.querySelector(`[data-pane-id="${manager.activePane}"] .pdf-pages`); if(host){const range=document.createRange();range.selectNodeContents(host);window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range)} }
      }
      else {
        const editor=element instanceof HTMLElement ? element.closest<HTMLElement>('.cm-editor') : null
        const view=(editor && EditorView.findFromDOM(editor)) || manager.activeEditorView
        if(operation==='paste' && manager.activeDocument?.mode && desktop && view && !manager.activeLiveEditor) {
          if(fileBusy.value||manager.isComposing||files.workspaceBusy||files.saving.size)return
          const id=manager.activeId!;manager.pin(id);fileBusy.value=true
          const before=view.state
          let hasImages=false
          try { await imageImporter.insert(id,async()=>{const sources=await clipboardImages();hasImages=!!sources.length;return sources});if(hasImages)return }
          finally{fileBusy.value=false;void drainPending()}
          if(manager.activeId!==id||manager.activeEditorView!==view||view.state.doc!==before.doc||!view.state.selection.eq(before.selection))throw new Error('读取剪贴板期间文档或选区变化，已取消粘贴。')
        }
        if(manager.activeLiveEditor){
          const live = manager.activeLiveEditor, id = manager.activeId!, selection = live.selection
          if(operation==='paste'&&desktop){
            const sources=await clipboardImages()
            if(manager.activeLiveEditor!==live||manager.activeId!==id||live.selection.anchor!==selection.anchor||live.selection.head!==selection.head)throw new Error('读取剪贴板期间文档或选区变化，已取消粘贴。')
            if(sources.length){await importImages(id,sources);return}
          }
          await live.clipboard(operation)
        }else if(view) await editorClipboard(view,operation,textClipboard)
      }
    }catch(error){toast(fileError(error))}
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if(updateInstalling.value){event.preventDefault();event.stopPropagation();return}
    if (document.querySelector('.recording-box')) return
    if(startupLoading.value){if(event.ctrlKey||event.metaKey)event.preventDefault();return}
    const alreadyHandled = event.defaultPrevented
    // Never let the WebView reload, including dialogs and customized bindings.
    if (eventShortcut(event) === 'Mod+R') event.preventDefault()
    if (document.querySelector('.app-menu-popup') && document.activeElement?.closest('[data-menu-popup],.app-menu') && !(event.ctrlKey||event.metaKey||event.altKey)) return
    if (document.querySelector('.workspace-operation-dialog') || event.isComposing || alreadyHandled || manager.isComposing || paletteRef.value?.visible || settingsRef.value?.visible || discardRef.value?.visible || gotoLineRef.value?.visible) return
    const binding = eventShortcut(event)
    const context = keybindingContext(event.target,!!manager.activeDocument?.mode)
    if (context === 'dialog') return
    if ((context === 'input' || context === 'search') && ['Mod+Z','Mod+Y','Mod+Shift+Z','Mod+C','Mod+V','Mod+X','Mod+A'].includes(binding)) return
    if(desktop && binding==='Mod+V' && event.target instanceof Element && event.target.closest('.cm-content,.md-prose') && manager.activeDocument?.mode){event.preventDefault();event.stopPropagation();void clipboardAction('paste');return}
    const command = matchingCommand(binding,shortcuts.value,context)
    if (command) {
      // Resolve the focused pane before executing; nested CodeMirror commands
      // are routed by DocumentManager to that exact view.
      event.preventDefault(); event.stopPropagation()
      if(event.repeat && !command.repeatable)return
      const pane = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId : undefined
      if (pane) manager.focusPane(pane,false)
      executeCommand(command.id)
      return
    }
    if (isManagedDefault(binding,context,keymapPreset.value)) { event.preventDefault();event.stopPropagation();return }
    if (manager.activeLiveEditor?.shortcut(event)) return
    if (event.key === 'Escape' && focusMode.value && !document.querySelector('.cm-search, .cm-tooltip')) {event.preventDefault();toggleFocus()}
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (manager.hasDirtyDocuments || manager.isComposing || fileBusy.value || files.saving.size) { event.preventDefault(); event.returnValue = '' }
  }
  function scheduleSession() {
    if (!launchReady || !sessionWriter) return
    sessionWriter.schedule(sessionInput(manager,workspace.roots,{mode:appMode.value,sidebarVisible:sidebarVisible.value,sidebarWidth:sidebarWidth.value}))
  }
  watch([revision,appMode,sidebarVisible,sidebarWidth],scheduleSession)
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
  watch(syntaxStyle, value => applySyntaxStyle(value), { immediate: true, flush: 'sync' })
  watch(bracketMode, value => manager.setBracketMode(value), { immediate: true })
  watch(caretAnimation, value => manager.setCaretAnimation(value), { immediate: true })
  watch(markdownTypography,value=>manager.setMarkdownTypography(value),{immediate:true,deep:true})
  watch(markdownClipboard,value=>manager.setMarkdownClipboard(value),{immediate:true,deep:true})
  watch(uiFontSize, value => { document.documentElement.style.setProperty('--ui-font-size', `${value}px`) }, { immediate: true })
  watch(fontSize, value => { document.documentElement.style.setProperty('--editor-size', `${value}px`); manager.refreshTypography() }, { immediate: true })
  watch(fontFamily, value => { document.documentElement.style.setProperty('--font-mono', fontFamilies[value]); manager.refreshTypography() }, { immediate: true })
  watch([indentSize,useTabs], () => manager.setIndent(indentSize.value,useTabs.value), { immediate: true })
  function settingsSnapshot(): EditorSettings {
    return { autoCheckUpdates:autoCheckUpdates.value,autoDownloadUpdates:autoDownloadUpdates.value,caretAnimation:caretAnimation.value,outlineWidth:outlineWidth.value,markdownClipboard:{...markdownClipboard.value},markdownTypography:{...markdownTypography.value},theme: theme.value, uiFontSize: uiFontSize.value, fontSize: fontSize.value, fontFamily: fontFamily.value, wordWrap: wordWrap.value, showOutline: showOutline.value, autoSave: autoSave.value, autoSaveDelay: autoSaveDelay.value, treeClickMode: treeClickMode.value, autoFollowActiveFile: autoFollowActiveFile.value, smartExpand: smartExpand.value, compactFolders: compactFolders.value, syntaxStyle: syntaxStyle.value, bracketMode: bracketMode.value, keymapPreset: keymapPreset.value,
      defaultMdMode: defaultMdMode.value, indentSize: indentSize.value, useTabs: useTabs.value, imageRules:{...imageRules.value},documentImageRules:{...documentImageRules.value}, settingsVersion: currentSettingsVersion, legacyAutoSaveNotice: false, shortcutVersion: currentShortcutVersion, customShortcuts:[...customShortcuts.value], shortcuts: { ...shortcuts.value }, fileModes: { ...fileModes.value } }
  }
  function flushSettings(strict=false) {
    if (settingsTimer) clearTimeout(settingsTimer)
    settingsTimer = undefined
    if (!settingsReady) return settingsWrites
    const settings = settingsSnapshot()
    settingsWrites = settingsWrites.then(() => saveEditorSettings(settings)).then(()=>{settingsError=null}).catch(error => { settingsError=error;toast(`首选项保存失败：${fileError(error)}`) })
    return settingsWrites.then(()=>{if(strict&&settingsError)throw settingsError})
  }
  watch(shortcuts,value=>manager.setShortcutLabels(Object.fromEntries(Object.entries(value).map(([id,binding])=>[id,shortcutLabel(binding)]))),{immediate:true,deep:true})
  function updateShortcuts(value: EditorSettings['shortcuts']) {
    value=Object.fromEntries(allCommands.map(command=>[command.id,value[command.id]===''?'':normalizeShortcut(value[command.id]) || value[command.id]]))
    const error = validateShortcuts(value,shortcuts.value)
    if (error) { toast(error); return }
    customShortcuts.value=allCommands.filter(command=>value[command.id]!==getPresetBindings(keymapPreset.value)[command.id]).map(command=>command.id)
    shortcuts.value = value
  }
  function updateKeymap(value: {preset:KeymapPresetId; bindings:Record<string,string>}) {
    const error = validateShortcuts(value.bindings)
    if (error) {toast(error);return}
    keymapPreset.value = value.preset
    updateShortcuts(value.bindings)
  }
  watch([autoSave, autoSaveDelay], () => autoSaver.configure(desktop && settingsReady && autoSave.value, autoSaveDelay.value))
  watch(smartExpand, v => { workspace.smartExpand = v }, { immediate: true })
  watch(compactFolders, v => { workspace.compactFolders = v }, { immediate: true })
  watch([autoCheckUpdates,autoDownloadUpdates,caretAnimation,outlineWidth,markdownClipboard,markdownTypography,theme,uiFontSize,fontSize,fontFamily,wordWrap,showOutline,defaultMdMode,indentSize,useTabs,shortcuts,fileModes,autoSave,autoSaveDelay,treeClickMode,autoFollowActiveFile,smartExpand,compactFolders,syntaxStyle,bracketMode,keymapPreset,imageRules,documentImageRules], () => {
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
    if (desktop) fileBusy.value=true
    window.addEventListener('editor-notice', editorNotice)
    window.addEventListener('markdown-open-relative',openRelativeLink)
    window.addEventListener('paste',imagePaste,true)
    window.addEventListener('resize', adaptWindowWidth)
    window.addEventListener('keydown', handleGlobalKeydown, true)
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('compositionend', resumePending)
    window.addEventListener('compositioncancel', resumePending)
    window.addEventListener('wheel', handleEditorWheel, { passive: false, capture: true })
    try {
      const settings = await loadEditorSettings()
      if (!alive) return
      uiFontSize.value = settings.uiFontSize; theme.value = settings.theme; fontSize.value = settings.fontSize; fontFamily.value = settings.fontFamily; wordWrap.value = settings.wordWrap
      autoSave.value = settings.autoSave; autoSaveDelay.value = settings.autoSaveDelay
      autoCheckUpdates.value=settings.autoCheckUpdates;autoDownloadUpdates.value=settings.autoDownloadUpdates
      caretAnimation.value=settings.caretAnimation
      markdownTypography.value=settings.markdownTypography
      outlineWidth.value=settings.outlineWidth
      markdownClipboard.value=settings.markdownClipboard
      imageRules.value=settings.imageRules;documentImageRules.value=settings.documentImageRules
      showOutline.value = settings.showOutline; defaultMdMode.value = settings.defaultMdMode; indentSize.value = settings.indentSize; useTabs.value = settings.useTabs
      treeClickMode.value = settings.treeClickMode
      autoFollowActiveFile.value = settings.autoFollowActiveFile
      smartExpand.value = settings.smartExpand
      compactFolders.value = settings.compactFolders
      syntaxStyle.value = settings.syntaxStyle
      bracketMode.value = settings.bracketMode
      keymapPreset.value = settings.keymapPreset || 'markumo'
      shortcuts.value = settings.shortcuts; fileModes.value = settings.fileModes; manager.setFileModes(settings.fileModes)
      customShortcuts.value=settings.customShortcuts
      // An older version could not record who enabled automatic save. Preserve
      // that value and tell the user once instead of silently overwriting it.
      if (settings.legacyAutoSaveNotice) toast('自动保存此前已开启并已保留；如不需要可在“设置”中关闭。')
      await nextTick()
    } catch (error) { toast(`首选项读取失败，使用默认值：${fileError(error)}`) }
    settingsReady = true
    if (desktop) {
      try {
        const launch=await initializeLaunch()
        if (!alive) return
        workspace.restoreSession(launch.roots)
        files.acceptBatch(launch.files)
        const selected=manager.openedDocuments.find(doc=>doc.path===launch.activePath)||manager.openedDocuments[0]
        if(selected)manager.select(selected.id,'main')
        restoreEditorLayout(manager,launch.editorLayout)
        appMode.value=launch.kind==='file'?'single':launch.layout.mode
        sidebarWidth.value=launch.layout.sidebarWidth
        sidebarVisible.value=launch.kind==='app'&&!!workspace.rootPath&&launch.layout.sidebarVisible&&!wasNarrow
        if(launch.warnings.length)toast(launch.warnings.join('\n'))
        if(launch.ownsSession){
          sessionWriter=new SessionWriter(input=>invoke('persist_session',{input}),error=>toast(`会话记录失败：${fileError(error)}`))
          sessionWriter.prime(sessionInput(manager,workspace.roots,{mode:appMode.value,sidebarVisible:sidebarVisible.value,sidebarWidth:sidebarWidth.value}))
        }
        await nextTick()
        launchReady=true
        // Preserve an unreadable/partly restored session until a real user change.
      } catch(error){toast(`启动文件/会话恢复失败：${fileError(error)}`)}
      finally {fileBusy.value=false;startupLoading.value=false}
      try {
        const unlisten = await (await import('@tauri-apps/api/window')).getCurrentWindow().onCloseRequested(async event => {
          event.preventDefault()
          const source = closeSource
          closeSource = 'native'
          await windowClose.request(source)
        })
        if (alive) unlistenWindow = unlisten
        else unlisten()
      } catch { toast('窗口关闭保护注册失败；请勿关闭含未保存修改的窗口。') }
      try {
        const unlisten = await (await import('@tauri-apps/api/window')).getCurrentWindow().listen('files-pending', () => void drainPending())
        if (alive) unlistenPending = unlisten; else unlisten()
        // The router tells us when a double-clicked file is already open here:
        // select that tab instead of reading the file again or adding a tab.
        const stopActivate=await (await import('@tauri-apps/api/window')).getCurrentWindow().listen<string[]>('external-activate',event=>{void activateExternal(event.payload)})
        if(alive)unlistenActivate=stopActivate;else stopActivate()
        const stopDrop=await (await import('@tauri-apps/api/window')).getCurrentWindow().listen<{inputs:NativeDropInput[];x:number;y:number}>('native-file-drop',event=>{void nativeFileDrop(event.payload).catch(error=>toast(fileError(error)))})
        if(alive)unlistenDrop=stopDrop;else stopDrop()
        const prefs = await tauriFiles.preferences()
        if (alive) {
          recentFiles.value = prefs.recent
          if (prefs.warning) toast(prefs.warning)
          // Let layout watchers observe restored values before persisting changes.
          await nextTick(); preferencesReady = true
          await drainPending()
        }
      } catch (error) { toast(fileError(error)) }
    }
    autoSaver.configure(desktop && autoSave.value, autoSaveDelay.value)
    if(desktop&&alive){
      try{const runtime=await invoke<{version:string;platform:string;installSupported:boolean}>('update_runtime');if(!alive)return;Object.assign(updateStatus,{currentVersion:runtime.version,platform:runtime.platform,installSupported:runtime.installSupported});
        const confirmation=await invoke<{confirmed:boolean;targetVersion:string}|null>('confirm_update_startup');
        if(!alive)return;if(confirmation?.confirmed){updateStatus.confirmedVersion=runtime.version;toast('Markumo 已更新至 v'+runtime.version)}
        else if(confirmation){toast('上次更新尚未确认，当前运行版本为 v'+runtime.version+'，可重新检查更新。')}
      }catch(error){updateStatus.error=fileError(error)}
      updateManager.start(!import.meta.env.DEV);reportUpdateWindow()
    }
  })
  onUnmounted(() => {
    systemTheme.removeEventListener('change', updateSystemTheme)
    window.removeEventListener('editor-notice', editorNotice)
    window.removeEventListener('markdown-open-relative',openRelativeLink)
    window.removeEventListener('paste',imagePaste,true)
    window.removeEventListener('resize', adaptWindowWidth)
    alive = false
    updateManager.dispose();if(reportTimer)clearTimeout(reportTimer)
    unlistenWindow?.()
    unlistenPending?.()
    unlistenActivate?.()
    unlistenDrop?.()
    if (layoutTimer) clearTimeout(layoutTimer)
    void flushSettings()
    window.removeEventListener('keydown', handleGlobalKeydown, true)
    window.removeEventListener('beforeunload', beforeUnload)
    window.removeEventListener('compositionend', resumePending)
    window.removeEventListener('compositioncancel', resumePending)
    window.removeEventListener('wheel', handleEditorWheel, true)
    sessionWriter?.dispose()
    autoSaver.dispose(); files.dispose(); workspace.destroy(); unsubscribeWorkspace(); unsubscribe(); manager.dispose()
  })
  return { autoCheckUpdates,autoDownloadUpdates,updateStatus,updatePanelOpen,updateConfirmRef,updateManager,openUpdatePanel,openUpdateRelease,openUpdateLink,caretAnimation,outlineWidth,markdownClipboard,markdownTypography,appMode, sidebarVisible, sidebarWidth, sidebarPanel, focusMode, theme, uiFontSize, fontSize, fontFamily, indentSize, useTabs, shortcuts, updateShortcuts,updateKeymap, keymapPreset, wordWrap, showOutline, defaultMdMode, autoSave, autoSaveDelay, treeClickMode, autoFollowActiveFile, smartExpand, compactFolders, syntaxStyle, bracketMode, imageRules,currentDocumentImageRules,updateDocumentImageRules,
    paletteRef, settingsRef, discardRef, toastRef, manager, files, workspace, openedDocuments, mainOpenedDocuments, mainActiveId, activeDoc, activeDocId, paletteActions, menuGroups,commandRegistry,executeCommand,
    setMode, toggleSidebar, handleSelectPanel, toggleTheme, toggleFocus, openSettings, openPalette, selectDocById, handleSelectDoc,
    pinDocById, createNewDoc, closeDocById,closeOtherTabs,cancelPendingClose, discardPending, savePending, setLanguage, setMarkdownMode,
    reopenEncoding, convertEncoding, saveAsEncoding,
    gotoLineRef, openGotoLine, handleGotoLine, toggleSplitPane, copyFullPath, copyRelativePath, revealInExplorer, revealInExplorerToken, zoomIn, zoomOut, resetZoom,
    desktop, demo, fileBusy, recentFiles, openFile, openRecent, saveActive, quitApp, startupLoading,updateInstalling,prepareUpdate }
}
