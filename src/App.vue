<template>
  <div class="app" :class="{ focus: focusMode }" :inert="updateInstalling || undefined">
    <!-- 顶部标题栏 -->
    <TopBar
      v-if="!focusMode"
      :app-mode="appMode"
      :theme="theme"
      :focus-mode="focusMode"
      :desktop="desktop"
      :file-busy="fileBusy || (!!activeDoc?.kind && activeDoc.kind !== 'text')"
      :menu-groups="menuGroups"
      :command-registry="commandRegistry"
      :quick-shortcut="shortcuts['quick-open']"
      :update-state="updateStatus"
      @open-update="openUpdatePanel"
      @execute-command="executeCommand"
      @open-file="openFile()"
      @save-file="saveActive()"
      @request-close="quitApp('titlebar')"
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
        :ui-font-size="uiFontSize"
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
        :recent-files="recentFiles"
        :workspace="workspace"
        :manager="manager"
        :desktop="desktop"
        :tree-click-mode="treeClickMode"
        :auto-follow-active-file="autoFollowActiveFile"
        :ui-font-size="uiFontSize"
        @open-recent="openRecent"
        @toggle-side="toggleSidebar"
        @new-doc="createNewDoc"
        @select-doc="handleSelectDoc"
        @select-outline="activeDocId && manager.revealOutline(activeDocId, $event)"
      />

      <!-- 编辑主体区 -->
      <section class="center-area">
        <!-- 主编辑器容器 -->
        <EditorContainer
          v-model:outline-width="outlineWidth"
          :doc="activeDoc"
          :manager="manager"
          :show-outline="showOutline"
          :desktop="desktop"
          :word-wrap="wordWrap"
          :files="files"
          :welcome="!openedDocuments.length && !workspace.rootPath"
          :startup-loading="startupLoading"
          :root-path="workspace.rootPath"
          @open-file="openFile()"
          @open-workspace="workspace.openWorkspaceDialog()"
          @new-doc="createNewDoc"
          @open-palette="openPalette"
          @close-outline="showOutline = false"
          @close-tab="closeDocById($event.id, $event.pane)"
          @open-path="openRecent($event)"
          @reveal-in-explorer="revealInExplorerToken($event)"
        />
      </section>
    </div>

    <!-- 底部状态栏 -->
    <StatusBar
      v-if="!focusMode"
      :doc="activeDoc"
      @set-language="setLanguage"
      @reopen-encoding="reopenEncoding"
      @convert-encoding="convertEncoding"
      @save-as-encoding="saveAsEncoding"
      :root="activeRoot"
      :multi-root="workspace.roots.length > 1"
      :indent-size="indentSize"
      :use-tabs="useTabs"
    />

    <!-- 命令面板模态框 -->
    <CommandPalette
      ref="paletteRef"
      :items="paletteActions"
      @query-change="workspace.quickOpen($event)"
    />

    <!-- 转到指定行模态框 (Ctrl+G) -->
    <GotoLineModal
      ref="gotoLineRef"
      :max-lines="activeDocLineCount"
      @goto="handleGotoLine"
    />

    <!-- 首选项模态框 -->
    <SettingsModal
      v-model:auto-check-updates="autoCheckUpdates"
      v-model:auto-download-updates="autoDownloadUpdates"
      :current-version="updateStatus.currentVersion"
      @check-update="settingsRef?.close();openUpdatePanel()"
      v-model:markdown-clipboard="markdownClipboard"
      v-model:markdown-typography="markdownTypography"
      v-model:image-rules="imageRules"
      :document-image-rules="currentDocumentImageRules"
      :markdown-path="activeDoc?.mode && activeDoc?.fileToken ? activeDoc.path : undefined"
      :markdown-name="activeDoc?.mode ? activeDoc.name : undefined"
      @update:document-image-rules="updateDocumentImageRules"
      ref="settingsRef"
      v-model:theme="theme"
      v-model:ui-font-size="uiFontSize"
      v-model:font-size="fontSize"
      v-model:caret-animation="caretAnimation"
      v-model:word-wrap="wordWrap"
      v-model:show-outline="showOutline"
      v-model:default-md-mode="defaultMdMode"
      v-model:font-family="fontFamily"
      v-model:indent-size="indentSize"
      v-model:use-tabs="useTabs"
      v-model:auto-save="autoSave"
      v-model:auto-save-delay="autoSaveDelay"
      v-model:tree-click-mode="treeClickMode"
      v-model:auto-follow-active-file="autoFollowActiveFile"
      :keymap-preset="keymapPreset"
      @update:keymap="updateKeymap"
      :shortcuts="shortcuts"
      @update:shortcuts="updateShortcuts"
    />

    <!-- 操作提示 Toast -->
    <DiscardDialog ref="discardRef" :can-save="desktop" :busy="fileBusy" @save="savePending" @discard="discardPending" @cancel="cancelPendingClose" />
    <Toast ref="toastRef" />
  </div>
  <UpdatePanel v-if="updatePanelOpen" :state="updateStatus" @close="updatePanelOpen=false" @check="updateManager.checkForUpdates()" @download="updateManager.downloadUpdate()" @install="updateManager.installUpdate()" @release="openUpdateRelease" @link="openUpdateLink" />
  <UpdateConfirm ref="updateConfirmRef" />
  <div v-if="updateInstalling" class="update-install-overlay" role="status">{{ updateStatus.phase==='preparing' ? '正在保存文档和工作现场…' : '正在安装更新，请稍候…' }}</div>
</template>

<script setup lang="ts">
import TopBar from './components/layout/TopBar.vue'
import ActivityBar from './components/layout/ActivityBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import EditorContainer from './components/layout/EditorContainer.vue'
import StatusBar from './components/layout/StatusBar.vue'
import CommandPalette from './components/modals/CommandPalette.vue'
import SettingsModal from './components/modals/SettingsModal.vue'
import DiscardDialog from './components/modals/DiscardDialog.vue'
import GotoLineModal from './components/modals/GotoLineModal.vue'
import Toast from './components/common/Toast.vue'
import UpdatePanel from './components/common/UpdatePanel.vue'
import UpdateConfirm from './components/modals/UpdateConfirm.vue'
import { computed } from 'vue'
import { useAppShell } from './app/useAppShell'
const { autoCheckUpdates,autoDownloadUpdates,updateStatus,updatePanelOpen,updateConfirmRef,updateManager,openUpdatePanel,openUpdateRelease,openUpdateLink,caretAnimation,outlineWidth,markdownClipboard,markdownTypography,appMode, sidebarVisible, sidebarWidth, sidebarPanel, focusMode, theme, uiFontSize, fontSize, fontFamily, indentSize, useTabs, shortcuts, updateShortcuts, updateKeymap, keymapPreset, wordWrap, showOutline, defaultMdMode, autoSave, autoSaveDelay, treeClickMode, autoFollowActiveFile, imageRules,currentDocumentImageRules,updateDocumentImageRules,
  paletteRef, settingsRef, discardRef, toastRef, manager, files, workspace, openedDocuments, activeDoc, activeDocId, paletteActions, menuGroups,commandRegistry,executeCommand,
  setMode, toggleSidebar, handleSelectPanel, toggleTheme, toggleFocus, openSettings, openPalette, handleSelectDoc,
  createNewDoc, closeDocById, cancelPendingClose, discardPending, savePending, setLanguage,
  reopenEncoding, convertEncoding, saveAsEncoding,
  gotoLineRef, handleGotoLine, revealInExplorerToken,
  desktop, fileBusy, recentFiles, openFile, openRecent, saveActive, quitApp, startupLoading,updateInstalling } = useAppShell()

const activeDocLineCount = computed(() => {
  if (!activeDoc.value) return 1
  const state = manager.getState(activeDoc.value.id)
  return state ? state.doc.lines : 1
})
const activeRoot = computed(() => appMode.value === 'workspace' && activeDoc.value?.path ? workspace.roots.find(root => root.rootPath === workspace.rootForPath(activeDoc.value!.path)) : null)
</script>

<style scoped>
.update-install-overlay {position:fixed;inset:0;z-index:2000;display:grid;place-items:center;background:var(--app);color:var(--ink);font-size:15px}
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
  .workspace-layout > .sidebar-wrapper { width: 210px !important; }
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
