<template>
  <div v-if="open" class="history-dialog-backdrop" @click="close" @keydown.esc="close">
    <div class="history-dialog" role="dialog" aria-label="文档历史版本" @click.stop>
      <div class="history-header">
        <div class="history-title-group">
          <span class="history-title">历史版本快照</span>
          <span class="history-subtitle">{{ currentPath }}</span>
        </div>
        <button class="history-close-btn" title="关闭 (Esc)" @click="close">✕</button>
      </div>

      <div class="history-body">
        <!-- Left: Versions List (metadata only) -->
        <div class="history-sidebar">
          <div class="history-sidebar-header">
            <span>保存记录 ({{ versions.length }})</span>
            <button v-if="versions.length" class="history-clean-btn" :disabled="restoring" title="清理该文件的所有历史版本" @click="clearAll">全部清理</button>
          </div>
          <div v-if="!versions.length" class="history-empty">
            <p>暂无历史保存版本</p>
          </div>
          <div v-else class="history-list">
            <button
              v-for="s in versions"
              :key="s.id"
              class="history-item"
              :class="{ active: s.id === selectedId }"
              @click="selectSnapshot(s)"
            >
              <div class="history-item-top">
                <span class="history-item-time">{{ formatTime(s.createdAt) }}</span>
                <span class="history-item-label">{{ s.label || originLabel(s.origin) }}</span>
              </div>
              <div class="history-item-bottom">
                <span>{{ (s.bytes / 1024).toFixed(1) }} KB</span>
                <span class="history-item-hash">{{ s.hash.slice(0, 10) }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Right: Preview & Diff -->
        <div class="history-content">
          <div class="history-view-tabs">
            <button class="history-tab" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">版本预览</button>
            <button class="history-tab" :class="{ active: viewMode === 'diff' }" @click="viewMode = 'diff'">与当前版本对比</button>
            <div class="history-tab-spacer"></div>
            <button v-if="selectedSnapshot && selectedBody !== null" class="history-action-btn restore" :disabled="restoring || loadingBody" @click="restoreSelected">恢复为此版本</button>
            <button v-if="selectedSnapshot && selectedBody !== null" class="history-action-btn" @click="copySelected">复制内容</button>
            <button v-if="selectedSnapshot" class="history-action-btn delete" @click="deleteSelected">删除快照</button>
          </div>

          <div v-if="bodyError" class="history-content-empty" role="alert">
            <p>{{ bodyError }}</p>
          </div>

          <div v-else-if="!selectedSnapshot" class="history-content-empty">
            <p>请选择一个历史版本进行查看</p>
          </div>

          <div v-else-if="loadingBody" class="history-content-empty">
            <p>正在加载版本内容…</p>
          </div>

          <div v-else-if="viewMode === 'preview'" class="history-preview-box">
            <pre class="history-preview-pre"><code>{{ selectedBody }}</code></pre>
          </div>

          <div v-else-if="viewMode === 'diff'" class="history-diff-box">
            <div v-for="(line, idx) in diffLines" :key="idx" class="diff-line" :class="line.type">
              <span class="diff-marker">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>
              <span class="diff-text">{{ line.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-if="confirmationVisible" class="history-confirm-overlay" @click="answerConfirmation(false)" @keydown.stop="confirmationKeydown">
    <section ref="confirmationRef" class="history-confirm" role="dialog" aria-modal="true" aria-label="历史版本操作确认" @click.stop>
      <p>{{ confirmationMessage }}</p>
      <div class="history-confirm-actions"><button @click="answerConfirmation(false)">取消</button><button @click="answerConfirmation(true)">{{ confirmationAction }}</button></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import {
  clearVersions,
  deleteVersion,
  diffLines as computeDiffLines,
  listVersions,
  readVersion,
  recordVersion,
  type DiffLine,
  type HistoryEntry,
} from '../../features/history/historyService'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import { sameFilePath } from '../../features/files/pathKey'
import { useModal } from '../../features/shell/useModal'

const props = defineProps<{
  open: boolean
  filePath: string
  currentContent: string
  documentId?: string | null
  manager?: DocumentManager
}>()

const emit = defineEmits<{(e: 'close'): void; (e: 'restored'): void}>()

const versions = ref<HistoryEntry[]>([])
/** Bodies are fetched only for the version the user is looking at. */
const loaded = ref<{path:string;documentId:string|null|undefined;id:string;hash:string;body:string}|null>(null)
const loadingBody = ref(false)
const bodyError = ref('')
const selectedId = ref<string | null>(null)
const restoring = ref(false)
let listRequest = 0, bodyRequest = 0, restoreRequest = 0
const {visible:confirmationVisible,dialogRef:confirmationRef,open:openConfirmation,close:closeConfirmation,handleKeydown:modalKeydown}=useModal()
void confirmationRef
const confirmationMessage=ref(''),confirmationAction=ref('')
let resolveConfirmation:((answer:boolean)=>void)|null=null
function answerConfirmation(answer:boolean){const pending=resolveConfirmation;resolveConfirmation=null;closeConfirmation();pending?.(answer)}
function askConfirmation(message:string,action:string):Promise<boolean>{answerConfirmation(false);confirmationMessage.value=message;confirmationAction.value=action;openConfirmation();return new Promise(resolve=>resolveConfirmation=resolve)}
function confirmationKeydown(event:KeyboardEvent){if(event.isComposing)return;if(event.key==='Escape'){event.preventDefault();answerConfirmation(false)}else modalKeydown(event)}
const viewMode = ref<'preview' | 'diff'>('preview')
const diffLines = ref<DiffLine[]>([])

const currentPath = computed(() => props.filePath || '未命名文档')

const selectedSnapshot = computed(() => {
  const entry = versions.value.find(item => item.id === selectedId.value) || null
  return entry
})
const selectedBody = computed(() => {
  const body=loaded.value, entry=selectedSnapshot.value
  return props.open && body && entry && body.path===props.filePath && body.documentId===props.documentId && body.id===entry.id && body.hash===entry.hash ? body.body : null
})
const hashBody = async (body:string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
function invalidateBody() { bodyRequest++;restoreRequest++;answerConfirmation(false);loaded.value=null;loadingBody.value=false;restoring.value=false;diffLines.value=[] }
function matches(path:string,id:typeof props.documentId) {return props.open && props.filePath===path && props.documentId===id}

async function loadVersions() {
  const request=++listRequest,path=props.filePath,documentId=props.documentId
  invalidateBody();selectedId.value=null;versions.value=[]
  if (!props.open || !props.filePath) {
    versions.value = []
    selectedId.value = null
    return
  }
  let entries:HistoryEntry[]
  try {entries=await listVersions(path)} catch(error) {
    if(request===listRequest&&matches(path,documentId))bodyError.value = `读取历史版本失败：${error instanceof Error ? error.message : String(error)}`
    return
  }
  if(request!==listRequest||!matches(path,documentId))return
  versions.value=entries
  if (versions.value.length > 0) selectedId.value = versions.value[0].id
  else selectedId.value = null
}

watch(() => [props.open, props.filePath, props.documentId], async () => {
  bodyError.value = ''
  await loadVersions()
}, { immediate: true, flush:'sync' })

watch(() => selectedId.value, async id => {
  invalidateBody()
  bodyError.value = ''
  if (!id || !props.filePath || !props.open) return
  const request=bodyRequest,path=props.filePath,documentId=props.documentId,entry=selectedSnapshot.value
  if(!entry)return
  const current=()=>request===bodyRequest&&matches(path,documentId)&&selectedId.value===id&&selectedSnapshot.value?.hash===entry.hash
  loadingBody.value = true
  try {
    const body=await readVersion(path,id)
    if(!current())return
    if(await hashBody(body)!==entry.hash)throw Error('版本内容哈希不匹配，已禁止恢复')
    if(!current())return
    loaded.value={path,documentId,id,hash:entry.hash,body}
    updateDiff()
  } catch (error) {
    if(current()){loaded.value=null;bodyError.value = `读取该版本失败：${error instanceof Error ? error.message : String(error)}`}
  } finally {
    if(current())loadingBody.value = false
  }
}, { immediate: true, flush:'sync' })

watch(() => [viewMode.value,props.currentContent], () => { if (viewMode.value === 'diff') updateDiff() })

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function originLabel(origin: HistoryEntry['origin']): string {
  if (origin === 'disk') return '保存前'
  if (origin === 'saved') return '已保存'
  return '手动'
}

function selectSnapshot(entry: HistoryEntry) {
  if(selectedId.value===entry.id && bodyError.value)selectedId.value=null
  selectedId.value = entry.id
}

function updateDiff() {
  if (selectedBody.value === null) {
    diffLines.value = []
    return
  }
  diffLines.value = computeDiffLines(props.currentContent, selectedBody.value)
}

function close() {
  listRequest++;invalidateBody();selectedId.value=null;versions.value=[]
  emit('close')
}

async function restoreSelected() {
  if (restoring.value || loadingBody.value || selectedBody.value === null || !props.manager || !props.documentId || !selectedSnapshot.value || !loaded.value) return
  const manager=props.manager,documentId=props.documentId,path=props.filePath,entry=selectedSnapshot.value,body=loaded.value
  const doc = manager.metadata(documentId)
  if (!doc || doc.readOnly || !doc.path || !sameFilePath(doc.path,path)) return
  const original=manager.getState(documentId)?.doc,currentText=manager.getText(documentId)
  if(!original || currentText===undefined)return
  // A restore is a destructive edit: say exactly what will happen before it does.
  const warning = doc.dirty
    ? '当前文档有未保存的修改，恢复后这些修改会被历史版本替换（可用撤销找回）。'
    : '当前文档已保存，恢复后内容会变为该历史版本。'
  const request=++restoreRequest
  const current=()=>request===restoreRequest&&matches(path,documentId)&&selectedId.value===entry.id&&loaded.value===body&&props.manager===manager
  restoring.value=true
  const targetContent = body.body
  // Protection point first: the current text is recorded as a version so even a
  // failed restore can never cost the user their document.
  try {
    // Tauri replaces window.confirm with an async native API. Keep confirmation
    // inside the app and bind the entire wait to this exact restore request.
    const ok=await askConfirmation(`${warning}\n\n确定恢复为 ${formatTime(entry.createdAt)} 的版本吗？`,'确认恢复')
    if(!ok||!current())return
    if(manager.getState(documentId)?.doc!==original)throw Error('当前文档在确认期间发生变化，已取消恢复并保留新修改')
    const protectedVersion=await recordVersion(path, currentText, 'manual', '恢复前保护点')
    if(!protectedVersion)throw Error('历史存储不可用')
    if(!current())return
    const verified=await readVersion(path,entry.id)
    if(verified!==targetContent||await hashBody(verified)!==entry.hash)throw Error('目标版本已改变或哈希不匹配')
    if(!current())return
    const latest=manager.metadata(documentId)
    if(!latest||latest.readOnly||!latest.path||!sameFilePath(latest.path,path)||manager.getState(documentId)?.doc!==original)throw Error('当前文档在恢复期间发生变化，已取消恢复并保留新修改')
    // Identity, selected version, bytes and the current immutable document are
    // checked immediately before this single canonical transaction.
    manager.dispatch(documentId, {changes:{from:0,to:original.length,insert:targetContent},userEvent:'input.history.restore'})
    emit('restored');close()
  } catch (error) {
    if(current())bodyError.value = `已取消恢复：${error instanceof Error ? error.message : String(error)}`
  } finally {
    if(request===restoreRequest)restoring.value=false
  }
}

function copySelected() {
  if (selectedBody.value !== null) navigator.clipboard?.writeText(selectedBody.value)
}

async function deleteSelected() {
  if (!selectedId.value || !props.filePath) return
  const path=props.filePath,id=selectedId.value,documentId=props.documentId
  invalidateBody();selectedId.value=null
  try {if(!await deleteVersion(path,id))throw Error('版本已不存在');if(matches(path,documentId))await loadVersions()}
  catch(error){if(matches(path,documentId))bodyError.value=`删除历史版本失败：${String(error)}`}
}

async function clearAll() {
  if (!props.filePath || restoring.value) return
  const path=props.filePath,documentId=props.documentId
  const request=++restoreRequest
  const ok = await askConfirmation('确定清空该文件的所有历史版本记录吗？此操作不可撤销。','确认清空')
  if (!ok||request!==restoreRequest||!matches(path,documentId)) return
  listRequest++;invalidateBody();selectedId.value=null
  try {await clearVersions(path);if(matches(path,documentId))versions.value=[]}
  catch(error){if(matches(path,documentId))bodyError.value=`清理历史版本失败：${String(error)}`}
}
onBeforeUnmount(()=>{listRequest++;invalidateBody()})
</script>

<style scoped>
.history-confirm-overlay{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;background:rgba(0,0,0,.4);padding:16px}
.history-confirm{width:min(460px,100%);padding:22px;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow)}
.history-confirm p{white-space:pre-wrap;line-height:1.6;overflow-wrap:anywhere}.history-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.history-confirm-actions button{padding:8px 14px;border-radius:5px;background:var(--soft);color:var(--bright)}
.history-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-dialog {
  width: 900px;
  max-width: 92vw;
  height: 640px;
  max-height: 90vh;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line);
}

.history-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--bright);
}

.history-subtitle {
  margin-left: 10px;
  font-size: 12px;
  color: var(--muted);
}

.history-close-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
}
.history-close-btn:hover {
  color: var(--bright);
}

.history-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.history-sidebar {
  width: 260px;
  flex: none;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  background: var(--side);
}

.history-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}

.history-clean-btn {
  border: 0;
  background: transparent;
  color: var(--red, #ef4444);
  font-size: 11px;
  cursor: pointer;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
  transition: all .12s ease;
}
.history-item:hover {
  background: var(--hover);
}
.history-item.active {
  background: var(--paper);
  border-color: var(--accent);
}

.history-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.history-item-time {
  font-size: 13px;
  font-weight: 600;
  color: var(--bright);
}

.history-item-label {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--soft);
  color: var(--muted);
}

.history-item-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
}

.history-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.history-view-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
}

.history-tab {
  border: 0;
  background: transparent;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  color: var(--ink);
}
.history-tab.active {
  background: var(--soft);
  color: var(--bright);
  font-weight: 600;
}

.history-tab-spacer {
  flex: 1;
}

.history-action-btn {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.history-action-btn:hover {
  background: var(--hover);
  color: var(--bright);
}
.history-action-btn.restore {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.history-action-btn.restore:hover {
  opacity: 0.9;
}
.history-action-btn.delete {
  color: var(--red, #ef4444);
}

.history-preview-box, .history-diff-box {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.history-preview-pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--ink);
}

.diff-line {
  display: flex;
  align-items: baseline;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  padding: 1px 4px;
}
.diff-line.added {
  background: rgba(16, 185, 129, 0.12);
  color: var(--green, #10b981);
}
.diff-line.removed {
  background: rgba(239, 68, 68, 0.12);
  color: var(--red, #ef4444);
}
.diff-marker {
  width: 20px;
  flex: none;
  user-select: none;
  font-weight: 700;
}
.diff-text {
  flex: 1;
  white-space: pre-wrap;
}

.history-empty, .history-content-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--muted);
  font-size: 13px;
}
</style>
