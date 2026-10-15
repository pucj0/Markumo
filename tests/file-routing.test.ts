import { describe, expect, it, vi } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { FileController } from '../src/features/files/FileController'
import { filePathKey, sameFilePath, usesCaseInsensitivePaths } from '../src/features/files/pathKey'
import type { FileGateway, FileMetadata, OpenFile } from '../src/features/files/contracts'

describe('File identity helpers used by the external open router', () => {
  it('folds separator and (on Windows) case differences but keeps distinct files apart', () => {
    expect(filePathKey('C:\\Docs\\Note.TXT', true)).toBe('c:/docs/note.txt')
    expect(filePathKey('C:/Docs/Note.txt', true)).toBe('c:/docs/note.txt')
    // A trailing separator never changes which file a path names.
    expect(filePathKey('C:\\Docs\\', true)).toBe('c:/docs')
    expect(sameFilePath('C:\\Docs\\Note.TXT', 'c:/docs/note.txt', true)).toBe(true)
    // Case-sensitive file systems keep distinct names distinct.
    expect(sameFilePath('/Docs/Note.TXT', '/docs/note.txt', false)).toBe(false)
    expect(sameFilePath('/docs/note.txt', '/docs/note.txt', false)).toBe(true)
    // Never deduplicate by file name alone.
    expect(sameFilePath('C:\\a\\Same.txt', 'C:\\b\\Same.txt', true)).toBe(false)
    // Chinese and spaced paths survive untouched.
    expect(sameFilePath('C:\\项目 目录\\说明 文档.md', 'c:/项目 目录/说明 文档.md', true)).toBe(true)
    expect(sameFilePath(null, 'C:/a.txt')).toBe(false)
    expect(sameFilePath('C:/a.txt', undefined)).toBe(false)
    expect(usesCaseInsensitivePaths('Win32')).toBe(true)
    expect(usesCaseInsensitivePaths('MacIntel')).toBe(false)
  })
})

describe('Opening a file that is already open does not duplicate or reload it', () => {
  function gateway(save = vi.fn(async (token: string): Promise<FileMetadata> => ({ ...file, token, version: 'v2' }))) {
    return { save, saveTarget: vi.fn(), release: vi.fn(async () => {}) } as unknown as FileGateway
  }
  const file: OpenFile = { token: 't1', path: 'C:\\docs\\Note.txt', name: 'Note.txt', text: 'first', encoding: 'UTF-8', eol: 'LF', bom: false, readOnly: false, version: 'v1' }
  function setup() {
    const manager = new DocumentManager([], async () => [])
    const notify = vi.fn()
    const files = new FileController(manager, gateway(), notify)
    const id = manager.openFile(file)!
    manager.dispatch(id, { changes: { from: 0, insert: 'unsaved ' } })
    return { manager, files, notify, id }
  }

  it('activates the existing tab, keeps unsaved edits and releases the extra grant', () => {
    const { manager, files, id } = setup()
    // A second external open of the same file with a fresh token and a different
    // path spelling (case and separator) must reuse the open document.
    const again: OpenFile = { ...file, token: 't2', path: 'c:/docs/note.txt' }
    expect(files.accept(again)).toBe(true)
    expect(manager.openedDocuments.map(doc => doc.id)).toEqual([id])
    expect(manager.getText(id)).toBe('unsaved first')
    expect(manager.metadata(id)?.dirty).toBe(true)
    // The unused grant is returned to the native layer, never leaked.
    expect((files.gateway.release as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('t2')
    manager.dispose()
  })

  it('opens a different file as an additional tab', () => {
    const { manager, files } = setup()
    files.accept({ ...file, token: 't3', path: 'C:\\docs\\Other.txt', name: 'Other.txt', text: 'other' })
    expect(manager.openedDocuments.map(doc => doc.name)).toEqual(['Note.txt', 'Other.txt'])
    manager.dispose()
  })
})

describe('Save dialog default type follows the document being saved', () => {
  it('new Markdown drafts are .md and new text drafts are .txt', () => {
    const manager = new DocumentManager([], async () => [])
    const markdown = manager.createUntitled('md')!
    expect(manager.metadata(markdown)?.name).toBe('Untitled-1.md')
    const text = manager.createUntitled('txt')!
    expect(manager.metadata(text)?.name).toBe('Untitled-2.txt')
    // The native filter/completion logic derives the default type from this name.
    expect(filePathKey(manager.metadata(markdown)!.name).endsWith('.md')).toBe(true)
    expect(filePathKey(manager.metadata(text)!.name).endsWith('.txt')).toBe(true)
    manager.dispose()
  })
  it('an existing document keeps its own extension for save-as', () => {
    const manager = new DocumentManager([], async () => [])
    const jsonc: OpenFile = { token: 'x', path: 'C:\\docs\\data.jsonc', name: 'data.jsonc', text: '{}', encoding: 'UTF-8', eol: 'LF', bom: false, readOnly: false, version: 'v1' }
    const id = manager.openFile(jsonc)!
    expect(manager.metadata(id)?.name).toBe('data.jsonc')
    // The frontend forwards this name, so Rust completes to .jsonc rather than .txt.
    expect(manager.metadata(id)!.name.split('.').pop()).toBe('jsonc')
    manager.dispose()
  })
})
