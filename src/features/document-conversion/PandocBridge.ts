import { invoke, isTauri } from '@tauri-apps/api/core'
import type { PandocStatus } from './contracts'
import type { ConversionSelection } from './contracts'

let cachedStatus: PandocStatus | null = null

export async function getPandocStatus(forceRefresh = false): Promise<PandocStatus> {
  if (!forceRefresh && cachedStatus !== null) {
    return cachedStatus
  }

  if (!isTauri()) {
    try {
      if (typeof process !== 'undefined' && process.versions?.node) {
        const { execFileSync } = await import(/* @vite-ignore */ 'node:child_process')
        const output = execFileSync('pandoc', ['--version'], { encoding: 'utf-8' })
        const firstLine = output.split('\n')[0].trim()
        const version = firstLine.split(/\s+/)[1] || firstLine
        cachedStatus = { available: true, version, path: 'pandoc' }
        return cachedStatus
      }
    } catch (e) {
      cachedStatus = { available: false }
      return cachedStatus
    }
    cachedStatus = { available: false }
    return cachedStatus
  }

  try {
    const status = await invoke<PandocStatus>('detect_pandoc')
    cachedStatus = status
    return status
  } catch (error) {
    console.error('Failed to detect Pandoc:', error)
    cachedStatus = { available: false }
    return cachedStatus
  }
}

export async function exportMarkdownToDocx(
  markdownContent: string,
  outputDocxPath: string,
  resourceDir?: string,
  token?: string,
  documentToken?: string
): Promise<void> {
  if (!isTauri()) {
    try {
      if (typeof process !== 'undefined' && process.versions?.node) {
        const { execFileSync } = await import(/* @vite-ignore */ 'node:child_process')
        const { writeFileSync, mkdtempSync } = await import(/* @vite-ignore */ 'node:fs')
        const { tmpdir } = await import(/* @vite-ignore */ 'node:os')
        const { join } = await import(/* @vite-ignore */ 'node:path')

        const tempDir = mkdtempSync(join(tmpdir(), 'markumo-docx-'))
        const tempMd = join(tempDir, 'input.md')
        writeFileSync(tempMd, markdownContent, 'utf-8')

        const args = ['-f', 'gfm', '-t', 'docx', '--standalone', '-o', outputDocxPath, tempMd]
        if (resourceDir) {
          args.push('--resource-path', resourceDir)
        }
        execFileSync('pandoc', args)
        return
      }
    } catch (e) {
      throw new Error(`Word 导出失败: ${e}`)
    }
    throw new Error('Word 导出需要桌面版运行环境。')
  }

  const status = await getPandocStatus()
  if (!status.available) {
    throw new Error('未检测到 Pandoc。Word 导出需要安装 Pandoc，请先前往 https://pandoc.org 安装。')
  }

  await invoke('pandoc_export_docx', {
    markdownContent,
    token,
    documentToken: documentToken || null,
  })
}

export async function importDocxToMarkdown(
  source: ConversionSelection,
  target: ConversionSelection
): Promise<string> {
  if (!isTauri()) {
    try {
      if (typeof process !== 'undefined' && process.versions?.node) {
        const { execFileSync } = await import(/* @vite-ignore */ 'node:child_process')
        const { readFileSync } = await import(/* @vite-ignore */ 'node:fs')
        const mediaDir = target.path.replace(/\.md$/i, '.assets')
        const args = ['-f', 'docx', '-t', 'gfm', '--wrap=none', '--extract-media', mediaDir, '-o', target.path, source.path]
        execFileSync('pandoc', args)
        return readFileSync(target.path, 'utf-8')
      }
    } catch (e) {
      throw new Error(`Word 导入失败: ${e}`)
    }
    throw new Error('Word 导入需要桌面版运行环境。')
  }

  const status = await getPandocStatus()
  if (!status.available) {
    throw new Error('未检测到 Pandoc。Word 导入需要安装 Pandoc，请先前往 https://pandoc.org 安装。')
  }

  return await invoke<string>('pandoc_import_docx', {
    sourceToken: source.token,
    targetToken: target.token,
  })
}
