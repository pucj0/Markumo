import { describe, it, expect } from 'vitest'
import {
  extractDocumentTitle,
  renderMarkdownForExport,
} from '../src/features/document-conversion/ExportRenderer'
import {
  buildCompleteHtml,
  getPrintCss,
} from '../src/features/document-conversion/ExportStyles'
import { importHtmlToMarkdown } from '../src/features/document-conversion/HtmlImporter'
import {
  defaultConversionSettings,
  loadConversionSettings,
  saveConversionSettings,
  loadLastExport,
  saveLastExport,
} from '../src/features/document-conversion/conversionSettings'
import { ExportController } from '../src/features/document-conversion/ExportController'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { getPandocStatus, exportMarkdownToDocx, importDocxToMarkdown } from '../src/features/document-conversion/PandocBridge'
import { existsSync, unlinkSync, readFileSync, rmdirSync } from 'node:fs'

describe('Document Conversion - HTML Export & Styles', () => {
  it('extracts document title from first H1 or falls back gracefully', () => {
    expect(extractDocumentTitle('# 我的主标题\n\n正文内容')).toBe('我的主标题')
    expect(extractDocumentTitle('## 二级标题\n\n正文内容', '默认名称')).toBe('默认名称')
    expect(extractDocumentTitle('没有标题的文本')).toBe('Untitled')
  })

  it('renders markdown to safe HTML with GFM tables, tasks and code blocks', async () => {
    const md = `# 标题测试

这是一段普通的正文，包含 **粗体** 和 *斜体*。

- [x] 已完成任务
- [ ] 待办任务

| 列 1 | 列 2 |
| :--- | ---: |
| 数据 A | 数据 B |

\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`

> 引用文字

<script>alert("xss")</script>
`
    const { title, bodyHtml } = await renderMarkdownForExport(md)
    expect(title).toBe('标题测试')
    expect(bodyHtml).toContain('这是一段普通的正文')
    expect(bodyHtml).toContain('<strong>粗体</strong>')
    expect(bodyHtml).toContain('<em>斜体</em>')
    expect(bodyHtml).toContain('<table>')
    expect(bodyHtml).toContain('type="checkbox"')
    expect(bodyHtml).toContain('<blockquote>')
    // Malicious script must not be rendered as HTML tag
    expect(bodyHtml).not.toContain('<script>')
    expect(bodyHtml).toContain('&lt;script&gt;')
  })

  it('buildCompleteHtml generates valid HTML5 document with or without styling', () => {
    const styled = buildCompleteHtml('文档标题', '<p>正文</p>', true)
    expect(styled).toContain('<!DOCTYPE html>')
    expect(styled).toContain('<title>文档标题</title>')
    expect(styled).toContain('<style>')
    expect(styled).toContain('--font-sans')
    expect(styled).toContain('class="markumo-document styled"')

    const plain = buildCompleteHtml('纯净标题', '<p>纯净正文</p>', false)
    expect(plain).toContain('<!DOCTYPE html>')
    expect(plain).toContain('<title>纯净标题</title>')
    expect(plain).not.toContain('<style>')
    expect(plain).toContain('class="markumo-document plain"')
  })

  it('generates print CSS respecting paper size and orientation', () => {
    const cssA4 = getPrintCss({ paperSize: 'A4', orientation: 'portrait', margins: 'default', printBackground: true, codeWrap: true })
    expect(cssA4).toContain('size: a4 portrait;')
    expect(cssA4).toContain('margin: 18mm;')
    expect(cssA4).toContain('page-break-inside: avoid;')

    const cssLetter = getPrintCss({ paperSize: 'Letter', orientation: 'landscape', margins: 'compact', printBackground: false, codeWrap: false })
    expect(cssLetter).toContain('size: letter landscape;')
    expect(cssLetter).toContain('margin: 12mm;')
  })
})

describe('Document Conversion - HTML Import', () => {
  it('converts basic HTML elements into Markdown', () => {
    const html = `
      <h1>主标题</h1>
      <p>一段文字与 <strong>加粗</strong> 及 <em>斜体</em> 以及 <a href="https://example.com">链接</a>。</p>
      <ul>
        <li>项目 1</li>
        <li>项目 2</li>
      </ul>
      <blockquote>这是一段引用</blockquote>
      <pre><code class="language-js">const a = 1;</code></pre>
    `
    const { markdown, title } = importHtmlToMarkdown(html)
    expect(title).toBe('主标题')
    expect(markdown).toContain('# 主标题')
    expect(markdown).toContain('**加粗**')
    expect(markdown).toContain('*斜体*')
    expect(markdown).toContain('[链接](https://example.com)')
    expect(markdown).toContain('-   项目 1')
    expect(markdown).toContain('> 这是一段引用')
    expect(markdown).toContain('```')
  })

  it('converts standard HTML tables to GFM Markdown tables', () => {
    const html = `
      <table>
        <thead>
          <tr><th>姓名</th><th>年龄</th></tr>
        </thead>
        <tbody>
          <tr><td>张三</td><td>25</td></tr>
          <tr><td>李四</td><td>30</td></tr>
        </tbody>
      </table>
    `
    const { markdown } = importHtmlToMarkdown(html)
    expect(markdown).toContain('| 姓名 | 年龄 |')
    expect(markdown).toContain('| 张三 | 25 |')
    expect(markdown).toContain('| 李四 | 30 |')
  })

  it('preserves complex tables with colspan or rowspan as safe HTML to prevent data loss', () => {
    const complexHtml = `
      <table>
        <tr><th colspan="2">合并表头</th></tr>
        <tr><td>单元格 1</td><td>单元格 2</td></tr>
      </table>
    `
    const { markdown } = importHtmlToMarkdown(complexHtml)
    expect(markdown).toContain('<th colspan="2">合并表头</th>')
  })

  it('strips script, style, navigation and malicious event handlers from imported HTML', () => {
    const maliciousHtml = `
      <h1>安全测试</h1>
      <script>window.hack = true;</script>
      <style>body { display: none; }</style>
      <nav><a href="/home">首页</a><a href="/about">关于</a></nav>
      <p onclick="alert('xss')">普通文本</p>
    `
    const { markdown } = importHtmlToMarkdown(maliciousHtml)
    expect(markdown).not.toContain('window.hack')
    expect(markdown).not.toContain('<script>')
    expect(markdown).not.toContain('display: none')
    expect(markdown).not.toContain('onclick')
    expect(markdown).toContain('# 安全测试')
    expect(markdown).toContain('普通文本')
  })
})

describe('Document Conversion - Settings & State Persistence', () => {
  it('loads default conversion settings and merges saved preferences', () => {
    const defaults = defaultConversionSettings()
    expect(defaults.pdf.paperSize).toBe('A4')
    expect(defaults.pdf.orientation).toBe('portrait')
    expect(defaults.embedImagesAsDataUri).toBe(true)

    saveConversionSettings({
      ...defaults,
      pdf: { ...defaults.pdf, paperSize: 'Letter' },
    })
    const loaded = loadConversionSettings()
    expect(loaded.pdf.paperSize).toBe('Letter')
  })

  it('records and retrieves last export format and options', () => {
    saveLastExport({
      format: 'pdf',
      targetPath: 'C:/docs/report.pdf',
      options: { pdf: { paperSize: 'A4', orientation: 'landscape', margins: 'compact', printBackground: true, codeWrap: true } },
      timestamp: Date.now(),
    })
    const last = loadLastExport()
    expect(last?.format).toBe('pdf')
    expect(last?.targetPath).toBe('C:/docs/report.pdf')
    expect(last?.options.pdf?.orientation).toBe('landscape')
  })
})

describe('Document Conversion - ExportController Eligibility', () => {
  it('only allows export on markdown documents; rejects java, hex and plain non-markdown text', () => {
    const manager = new DocumentManager([], async () => [])
    const controller = new ExportController(manager, () => {})

    expect(controller.canExportActive()).toBe(false)

    // Open a Java class / hex file
    manager.openFile({ token: '1', path: 'Main.java', name: 'Main.java', text: 'class Main {}', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false, version: '1', kind: 'text' })
    expect(controller.canExportActive()).toBe(false)

    // Open a Markdown file
    const mdId = manager.openFile({ token: '2', path: 'Note.md', name: 'Note.md', text: '# Markdown Content', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false, version: '1', kind: 'text' })!
    manager.setMarkdownMode(mdId, 'live')
    expect(controller.canExportActive()).toBe(true)

    manager.dispose()
  })
})

describe('Document Conversion - Pandoc DOCX Export & Import', () => {
  it('detects real Pandoc installation on host', async () => {
    const status = await getPandocStatus(true)
    expect(status.available).toBe(true)
    expect(status.version).toBeDefined()
    expect(status.version?.length).toBeGreaterThan(0)
    expect(status.path).toBeDefined()
  })

  it('exports markdown to DOCX and imports DOCX back to markdown via Pandoc', async () => {
    const status = await getPandocStatus()
    if (!status.available) {
      console.warn('Pandoc not available, skipping live roundtrip test.')
      return
    }

    const testMd = '# Pandoc Roundtrip Test\n\nThis is a **bold** paragraph with a table:\n\n| Item | Qty |\n| :--- | --: |\n| Apple | 10 |\n| Orange | 20 |\n'
    const outDocx = 'tests/live-pandoc-export.docx'
    const roundtripMd = 'tests/live-pandoc-import.md'
    const mediaDir = 'tests/live-pandoc-media'

    try {
      await exportMarkdownToDocx(testMd, outDocx)
      expect(existsSync(outDocx)).toBe(true)
      const docxBytes = readFileSync(outDocx)
      // Verify OOXML zip header 'PK' (0x50, 0x4b)
      expect(docxBytes[0]).toBe(0x50)
      expect(docxBytes[1]).toBe(0x4b)

      const importedMd = await importDocxToMarkdown(outDocx, roundtripMd, mediaDir)
      expect(importedMd).toContain('# Pandoc Roundtrip Test')
      expect(importedMd).toContain('**bold**')
      expect(importedMd).toContain('| Apple')
    } finally {
      if (existsSync(outDocx)) unlinkSync(outDocx)
      if (existsSync(roundtripMd)) unlinkSync(roundtripMd)
      if (existsSync(mediaDir)) {
        try { rmdirSync(mediaDir, { recursive: true }) } catch {}
      }
    }
  })
})
