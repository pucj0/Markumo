/**
 * Document Version History Service.
 * Manages saved document snapshots, content deduplication, quotas and rollback.
 * Independent of Crash Recovery.
 */

export interface DocumentSnapshot {
  id: string
  path: string
  timestamp: number
  hash: string
  content: string
  byteLength: number
  label?: string
}

export interface DiffLine {
  type: 'added' | 'removed' | 'same'
  text: string
  lineNumberA?: number
  lineNumberB?: number
}

const MAX_VERSIONS_PER_FILE = 30
const STORAGE_KEY_PREFIX = 'markumo:history:snapshots:'

function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(36)
}

function storageKey(filePath: string): string {
  return `${STORAGE_KEY_PREFIX}${hashString(filePath.toLowerCase())}`
}

export class HistoryService {
  private inMemorySnapshots = new Map<string, DocumentSnapshot[]>()

  /**
   * Save a snapshot if content is not identical to the latest snapshot
   */
  async recordSnapshot(filePath: string, content: string, label?: string): Promise<DocumentSnapshot | null> {
    if (!filePath || content === undefined) return null

    const hash = hashString(content)
    const list = await this.getSnapshots(filePath)

    // Deduplicate identical content
    if (list.length > 0 && list[0].hash === hash) {
      return null
    }

    const snapshot: DocumentSnapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: filePath,
      timestamp: Date.now(),
      hash,
      content,
      byteLength: new TextEncoder().encode(content).length,
      label,
    }

    // Prepend latest snapshot
    list.unshift(snapshot)

    // Enforce quota
    if (list.length > MAX_VERSIONS_PER_FILE) {
      list.length = MAX_VERSIONS_PER_FILE
    }

    this.saveList(filePath, list)
    return snapshot
  }

  /**
   * Get all snapshots for a given file
   */
  async getSnapshots(filePath: string): Promise<DocumentSnapshot[]> {
    if (!filePath) return []
    const key = storageKey(filePath)

    if (this.inMemorySnapshots.has(key)) {
      return this.inMemorySnapshots.get(key)!
    }

    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const list = JSON.parse(stored) as DocumentSnapshot[]
        this.inMemorySnapshots.set(key, list)
        return list
      }
    } catch {
      // Fallback to empty
    }

    const empty: DocumentSnapshot[] = []
    this.inMemorySnapshots.set(key, empty)
    return empty
  }

  /**
   * Delete a specific snapshot
   */
  async deleteSnapshot(filePath: string, snapshotId: string): Promise<boolean> {
    const list = await this.getSnapshots(filePath)
    const next = list.filter(s => s.id !== snapshotId)
    if (next.length !== list.length) {
      this.saveList(filePath, next)
      return true
    }
    return false
  }

  /**
   * Clear all snapshots for a file
   */
  async clearSnapshots(filePath: string): Promise<void> {
    const key = storageKey(filePath)
    this.inMemorySnapshots.delete(key)
    try {
      localStorage.removeItem(key)
    } catch {}
  }

  private saveList(filePath: string, list: DocumentSnapshot[]) {
    const key = storageKey(filePath)
    this.inMemorySnapshots.set(key, list)
    try {
      localStorage.setItem(key, JSON.stringify(list))
    } catch {}
  }

  /**
   * Lightweight diff calculation between current text and historical snapshot
   */
  computeDiff(currentText: string, historicText: string): DiffLine[] {
    const currentLines = currentText.split(/\r?\n/)
    const historicLines = historicText.split(/\r?\n/)
    const diff: DiffLine[] = []

    let i = 0, j = 0
    while (i < historicLines.length || j < currentLines.length) {
      if (i < historicLines.length && j < currentLines.length && historicLines[i] === currentLines[j]) {
        diff.push({ type: 'same', text: historicLines[i], lineNumberA: i + 1, lineNumberB: j + 1 })
        i++; j++
      } else if (i < historicLines.length && (j >= currentLines.length || !currentLines.slice(j).includes(historicLines[i]))) {
        diff.push({ type: 'removed', text: historicLines[i], lineNumberA: i + 1 })
        i++
      } else if (j < currentLines.length) {
        diff.push({ type: 'added', text: currentLines[j], lineNumberB: j + 1 })
        j++
      }
    }
    return diff
  }
}

export const historyService = new HistoryService()
