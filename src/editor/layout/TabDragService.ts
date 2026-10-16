import { ref } from 'vue'

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface TabDragPayload {
  documentId: string
  fromPaneId: string
  documentName: string
  isCopy: boolean
}

export interface TabInsertTarget {
  paneId: string
  targetDocId: string
  position: 'before' | 'after'
}

export interface PaneDropTarget {
  paneId: string
  zone: DropZone
}

export class TabDragService {
  private static instance: TabDragService

  static getInstance(): TabDragService {
    if (!TabDragService.instance) {
      TabDragService.instance = new TabDragService()
    }
    return TabDragService.instance
  }

  readonly isDragging = ref(false)
  readonly dragPayload = ref<TabDragPayload | null>(null)
  readonly activePaneDrop = ref<PaneDropTarget | null>(null)
  readonly activeTabInsert = ref<TabInsertTarget | null>(null)

  private ghostEl: HTMLElement | null = null
  private startX = 0
  private startY = 0
  private pendingPayload: TabDragPayload | null = null
  private dragThreshold = 5 // 鼠标移动超过 5px 视为拖拽，保证单击/双击/右键完全不受影响
  private onCommitCallback?: (result: {
    payload: TabDragPayload
    paneDrop: PaneDropTarget | null
    tabInsert: TabInsertTarget | null
  }) => void

  private handlePointerMove = (e: PointerEvent) => {
    if (!this.pendingPayload) return

    // 检查是否达到拖动阈值
    if (!this.isDragging.value) {
      const dist = Math.hypot(e.clientX - this.startX, e.clientY - this.startY)
      if (dist >= this.dragThreshold) {
        this.startDrag(this.pendingPayload, e)
      } else {
        return
      }
    }

    // 更新 Ctrl 复制标志
    if (this.dragPayload.value) {
      this.dragPayload.value.isCopy = e.ctrlKey || e.altKey
    }

    // 更新幽灵卡片位置
    this.updateGhostPosition(e.clientX, e.clientY)

    // 检测落点目标
    this.detectDropTarget(e.clientX, e.clientY)
  }

  private handlePointerUp = (e: PointerEvent) => {
    if (this.isDragging.value && this.dragPayload.value) {
      // 最终确认是否是按住 Ctrl
      this.dragPayload.value.isCopy = e.ctrlKey || e.altKey

      if (this.onCommitCallback) {
        this.onCommitCallback({
          payload: { ...this.dragPayload.value },
          paneDrop: this.activePaneDrop.value,
          tabInsert: this.activeTabInsert.value,
        })
      }
    }
    this.cancelDrag()
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.cancelDrag()
    } else if (e.key === 'Control' || e.key === 'Alt') {
      if (this.dragPayload.value) {
        this.dragPayload.value.isCopy = true
        this.updateGhostCopyBadge(true)
      }
    }
  }

  private handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Control' || e.key === 'Alt') {
      if (this.dragPayload.value) {
        this.dragPayload.value.isCopy = false
        this.updateGhostCopyBadge(false)
      }
    }
  }

  /**
   * 在 Tab 上 pointerdown 时注册潜在拖动
   */
  startWatching(
    e: PointerEvent,
    payload: Omit<TabDragPayload, 'isCopy'>,
    onCommit: (result: {
      payload: TabDragPayload
      paneDrop: PaneDropTarget | null
      tabInsert: TabInsertTarget | null
    }) => void
  ) {
    // 仅允许鼠标左键拖拽
    if (e.button !== 0) return

    this.startX = e.clientX
    this.startY = e.clientY
    this.pendingPayload = {
      ...payload,
      isCopy: e.ctrlKey || e.altKey,
    }
    this.onCommitCallback = onCommit

    window.addEventListener('pointermove', this.handlePointerMove, { passive: true })
    window.addEventListener('pointerup', this.handlePointerUp, { once: true })
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
  }

  private startDrag(payload: TabDragPayload, e: PointerEvent) {
    this.isDragging.value = true
    this.dragPayload.value = payload

    document.body.classList.add('is-tab-dragging')
    this.createGhost(payload.documentName, payload.isCopy, e.clientX, e.clientY)
  }

  private detectDropTarget(x: number, y: number) {
    // 1. 先检测是否落在某个 TabBar 或 Tab 上
    const elUnderCursor = document.elementFromPoint(x, y)
    if (!elUnderCursor) {
      this.activePaneDrop.value = null
      this.activeTabInsert.value = null
      return
    }

    const tabEl = elUnderCursor.closest<HTMLElement>('.tab')
    const tabBarEl = elUnderCursor.closest<HTMLElement>('.tabs')

    if (tabBarEl) {
      this.activePaneDrop.value = null
      const paneEl = tabBarEl.closest<HTMLElement>('.pane')
      const paneId = paneEl?.dataset.paneId || 'main'

      if (tabEl && tabEl.dataset.document) {
        const rect = tabEl.getBoundingClientRect()
        const isAfter = x > rect.left + rect.width / 2
        this.activeTabInsert.value = {
          paneId,
          targetDocId: tabEl.dataset.document,
          position: isAfter ? 'after' : 'before',
        }
      } else {
        // 落在标签栏空白处
        this.activeTabInsert.value = {
          paneId,
          targetDocId: '',
          position: 'after',
        }
      }
      return
    }

    // 2. 如果没有落在标签栏，检测是否落在某个编辑 Pane 内部
    this.activeTabInsert.value = null
    const paneEl = elUnderCursor.closest<HTMLElement>('.pane')
    if (paneEl) {
      const paneId = paneEl.dataset.paneId || 'main'
      const rect = paneEl.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const relX = (x - rect.left) / rect.width
        const relY = (y - rect.top) / rect.height
        const margin = 0.22

        let zone: DropZone = 'center'
        if (relX < margin) zone = 'left'
        else if (relX > 1 - margin) zone = 'right'
        else if (relY < margin) zone = 'top'
        else if (relY > 1 - margin) zone = 'bottom'
        else zone = 'center'

        this.activePaneDrop.value = { paneId, zone }
        return
      }
    }

    this.activePaneDrop.value = null
  }

  private createGhost(name: string, isCopy: boolean, x: number, y: number) {
    this.destroyGhost()
    const ghost = document.createElement('div')
    ghost.className = 'tab-drag-ghost'
    ghost.innerHTML = `
      <span class="tab-ghost-icon">📄</span>
      <span class="tab-ghost-name">${name}</span>
      <span class="tab-ghost-badge" ${isCopy ? '' : 'style="display:none;"'}>+ 副本</span>
    `
    document.body.append(ghost)
    this.ghostEl = ghost
    this.updateGhostPosition(x, y)
  }

  private updateGhostPosition(x: number, y: number) {
    if (this.ghostEl) {
      this.ghostEl.style.transform = `translate3d(${x + 12}px, ${y + 12}px, 0)`
    }
  }

  private updateGhostCopyBadge(isCopy: boolean) {
    if (this.ghostEl) {
      const badge = this.ghostEl.querySelector<HTMLElement>('.tab-ghost-badge')
      if (badge) {
        badge.style.display = isCopy ? 'inline-block' : 'none'
      }
    }
  }

  private destroyGhost() {
    if (this.ghostEl) {
      this.ghostEl.remove()
      this.ghostEl = null
    }
  }

  cancelDrag() {
    this.isDragging.value = false
    this.dragPayload.value = null
    this.pendingPayload = null
    this.activePaneDrop.value = null
    this.activeTabInsert.value = null
    this.onCommitCallback = undefined

    document.body.classList.remove('is-tab-dragging')
    this.destroyGhost()

    window.removeEventListener('pointermove', this.handlePointerMove)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
  }
}

export const tabDragService = TabDragService.getInstance()
