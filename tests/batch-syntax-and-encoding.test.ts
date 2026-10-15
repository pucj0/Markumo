import { describe, it, expect, vi } from 'vitest'
import { batchParser } from '../src/editor/languages/batch'
import { detectLanguage, loadLanguage } from '../src/editor/languages'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { FileController } from '../src/features/files/FileController'
import type { FileGateway, FileMetadata, OpenFile } from '../src/features/files/contracts'
import { EditorState } from '@codemirror/state'
import { StringStream } from '@codemirror/language'

describe('Batch / CMD Language Highlighting (Pure Syntax, No Execution)', () => {
  it('detects .bat and .cmd as Batch language', () => {
    expect(detectLanguage('package.bat')).toBe('Batch')
    expect(detectLanguage('build.cmd')).toBe('Batch')
    expect(detectLanguage('C:\\project\\deploy.BAT')).toBe('Batch')
    expect(detectLanguage('D:/scripts/run.CMD')).toBe('Batch')
  })

  function tokenizeLine(line: string): { text: string; token: string | null }[] {
    const stream = new StringStream(line, 4, 1)
    const state = {}
    const tokens: { text: string; token: string | null }[] = []
    while (!stream.eol()) {
      stream.start = stream.pos
      const start = stream.pos
      const token = batchParser.token(stream, state)
      if (stream.pos === start) {
        stream.next()
      }
      tokens.push({ text: line.slice(start, stream.pos), token })
    }
    return tokens
  }

  it('tokenizes @echo, echo, rem and :: comments properly', () => {
    const line1 = tokenizeLine('@echo off')
    expect(line1.some(t => t.text === '@echo' && t.token === 'builtin')).toBe(true)

    const line2 = tokenizeLine('rem 这是中文注释')
    expect(line2.some(t => t.text.startsWith('rem') && t.token === 'comment')).toBe(true)

    const line3 = tokenizeLine(':: 这是冒号注释')
    expect(line3.some(t => t.text.startsWith('::') && t.token === 'comment')).toBe(true)
  })

  it('tokenizes %date%, %web%, !variable!, and parameter forms %~dp0, %1, %%i', () => {
    const line1 = tokenizeLine('echo 今天日期是 %date%，网址是 %web%')
    expect(line1.some(t => t.text === '%date%' && t.token === 'variable')).toBe(true)
    expect(line1.some(t => t.text === '%web%' && t.token === 'variable')).toBe(true)

    const line2 = tokenizeLine('setlocal enabledelayedexpansion && echo !variable!')
    expect(line2.some(t => t.text === '!variable!' && t.token === 'variable')).toBe(true)
    expect(line2.some(t => t.text === 'setlocal' && t.token === 'keyword')).toBe(true)

    const line3 = tokenizeLine('cd /d %~dp0 && call :build %1')
    expect(line3.some(t => t.text === '%~dp0' && t.token === 'variable')).toBe(true)
    expect(line3.some(t => t.text === '%1' && t.token === 'variable')).toBe(true)
    expect(line3.some(t => t.text === ':build' && t.token === 'label')).toBe(true)
  })

  it('tokenizes control flow keywords: if, else, for, in, do, goto, exit', () => {
    const line = tokenizeLine('if "%1"=="" (goto :help) else (exit /b 0)')
    expect(line.some(t => t.text === 'if' && t.token === 'keyword')).toBe(true)
    expect(line.some(t => t.text === 'goto' && t.token === 'keyword')).toBe(true)
    expect(line.some(t => t.text === 'else' && t.token === 'keyword')).toBe(true)
    expect(line.some(t => t.text === 'exit' && t.token === 'keyword')).toBe(true)
  })

  it('loads into CodeMirror EditorState without execution or side effects', async () => {
    const extension = await loadLanguage('Batch')
    const state = EditorState.create({
      doc: '@echo off\r\nrem 安全检查\r\nset MSG=hello\r\necho %MSG%\r\n',
      extensions: [extension],
    })
    expect(state.doc.toString()).toContain('@echo off')
    expect(state.doc.lines).toBe(5)
  })
})

describe('Encoding Reopen and Conversion Workflows with Dirty Protection', () => {
  function createGateway() {
    return {
      openRecent: vi.fn(),
      reopen: vi.fn(async (_token: string, encoding: string): Promise<OpenFile> => ({
        token: 'token-reopened',
        path: 'C:\\test\\package.bat',
        name: 'package.bat',
        text: '@echo off\r\nrem 重新加载的 GB18030 批处理\r\necho 成功\r\n',
        encoding: encoding as any,
        bom: false,
        eol: 'CRLF',
        readOnly: false,
        version: 'v2',
      })),
      save: vi.fn(async (token: string, _text: string, _version: string | null, encoding: string, bom: boolean): Promise<FileMetadata> => ({
        token,
        path: 'C:\\test\\package.bat',
        name: 'package.bat',
        encoding: encoding as any,
        bom,
        eol: 'CRLF',
        readOnly: false,
        version: 'v3',
      })),
      saveTarget: vi.fn(),
      release: vi.fn(async () => {}),
    } as unknown as FileGateway
  }

  it('reopens clean document and preserves encoding and CRLF', async () => {
    const manager = new DocumentManager([], async () => [])
    const gateway = createGateway()
    const notify = vi.fn()
    const files = new FileController(manager, gateway, notify)

    const initialFile: OpenFile = {
      token: 'token-1',
      path: 'C:\\test\\package.bat',
      name: 'package.bat',
      text: '@echo off\r\n',
      encoding: 'UTF-8',
      bom: false,
      eol: 'CRLF',
      readOnly: false,
      version: 'v1',
    }
    const id = manager.openFile(initialFile)!
    expect(manager.metadata(id)?.language).toBe('Batch')

    // Clean document reopen succeeds directly
    await files.reopen('GB18030')
    expect(gateway.reopen).toHaveBeenCalledWith('token-1', 'GB18030')
    expect(manager.metadata(id)?.encoding).toBe('GB18030')
    expect(manager.metadata(id)?.language).toBe('Batch')
    expect(manager.getText(id)).toContain('GB18030 批处理')

    manager.dispose()
  })

  it('refuses to reload dirty document unless force=true is provided', async () => {
    const manager = new DocumentManager([], async () => [])
    const gateway = createGateway()
    const notify = vi.fn()
    const files = new FileController(manager, gateway, notify)

    const initialFile: OpenFile = {
      token: 'token-1',
      path: 'C:\\test\\package.bat',
      name: 'package.bat',
      text: '@echo off\r\n',
      encoding: 'UTF-8',
      bom: false,
      eol: 'CRLF',
      readOnly: false,
      version: 'v1',
    }
    const id = manager.openFile(initialFile)!

    // Make dirty
    manager.dispatch(id, { changes: { from: 0, insert: 'rem 未保存修改\r\n' } })
    expect(manager.metadata(id)?.dirty).toBe(true)

    // Unforced reopen is refused with notice to protect unsaved work
    await files.reopen('GB18030', false)
    expect(notify).toHaveBeenCalledWith('请先保存修改并完成输入，再用其他编码重开。')
    expect(manager.getText(id)).toContain('未保存修改')

    // Forced reopen (after user confirmation to discard) reloads
    await files.reopen('GB18030', true)
    expect(manager.getText(id)).toContain('GB18030 批处理')
    expect(manager.metadata(id)?.encoding).toBe('GB18030')
    expect(manager.metadata(id)?.dirty).toBe(false)

    manager.dispose()
  })

  it('switching from HEX mode to GB18030 restores normal text editing and Batch language highlighting', async () => {
    const manager = new DocumentManager([], async () => [])
    const gateway = createGateway()
    const notify = vi.fn()
    const files = new FileController(manager, gateway, notify)

    const hexFile: OpenFile = {
      token: 'token-hex',
      path: 'C:\\test\\package.bat',
      name: 'package.bat',
      text: '40 65 63 68 6F 20 6F 66 66',
      encoding: 'Hex',
      bom: false,
      eol: 'CRLF',
      readOnly: false,
      version: 'v1',
    }
    const id = manager.openFile(hexFile)!
    expect(manager.metadata(id)?.encoding).toBe('Hex')
    expect(manager.metadata(id)?.language).toBe('Plain Text')

    // Reopen as GB18030
    await files.reopen('GB18030', true)
    expect(manager.metadata(id)?.encoding).toBe('GB18030')
    expect(manager.metadata(id)?.language).toBe('Batch')
    expect(manager.getText(id)).toContain('@echo off')

    manager.dispose()
  })
})
