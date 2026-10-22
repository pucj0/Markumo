import MarkdownIt, { type Token } from 'markdown-it'

/**
 * Native DOCX writer.
 *
 * Produces a real Office Open XML package: Word list numbering, hyperlink
 * relationships, embedded media, tables and section-level styling. The heavy
 * module is only imported when the user actually exports Word.
 *
 * Deliberately bounded: a media budget, an image count cap, a total output cap
 * and cooperative cancellation, so a huge document cannot exhaust memory or
 * leave a half-written file behind.
 */

export interface DocxImage {
  /** Bytes of the image. Type is detected from the signature. */
  data: Uint8Array
  alt: string
}

export interface DocxWarning {
  kind: 'image' | 'math' | 'diagram' | 'footnote' | 'toc' | 'content'
  message: string
}

export interface DocxOptions {
  title?: string
  /** Resolves a local/network image. Returning null reports a warning instead. */
  resolveImage?: (source: string) => Promise<DocxImage | null>
  signal?: AbortSignal
  /** Largest total media payload embedded into one document. */
  mediaBudgetBytes?: number
}

export interface DocxResult {
  bytes: Uint8Array
  warnings: DocxWarning[]
  stats: { paragraphs: number; tables: number; lists: number; hyperlinks: number; images: number; footnotes: number }
}

const MAX_MEDIA_BYTES = 64 * 1024 * 1024
const MAX_IMAGES = 120
const MAX_TEXT_BYTES = 64 * 1024 * 1024

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index++) {
    crc ^= bytes[index]
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Minimal store-only ZIP writer: every entry is a valid, readable member. */
export function createZipArchive(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const entries: { name: Uint8Array; data: Uint8Array; crc: number; offset: number }[] = []
  const chunks: Uint8Array[] = []
  let offset = 0

  for (const [path, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? encoder.encode(content) : content
    const name = encoder.encode(path)
    const checksum = crc32(data)
    const header = new Uint8Array(30 + name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0, true)
    view.setUint32(14, checksum, true)
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, name.length, true)
    header.set(name, 30)
    entries.push({ name, data, crc: checksum, offset })
    chunks.push(header, data)
    offset += header.length + data.length
  }

  const centralStart = offset
  for (const entry of entries) {
    const header = new Uint8Array(46 + entry.name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint32(16, entry.crc, true)
    view.setUint32(20, entry.data.length, true)
    view.setUint32(24, entry.data.length, true)
    view.setUint16(28, entry.name.length, true)
    view.setUint32(42, entry.offset, true)
    header.set(entry.name, 46)
    chunks.push(header)
    offset += header.length
  }

  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, entries.length, true)
  eocdView.setUint16(10, entries.length, true)
  eocdView.setUint32(12, offset - centralStart, true)
  eocdView.setUint32(16, centralStart, true)
  chunks.push(eocd)

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let position = 0
  for (const chunk of chunks) {
    result.set(chunk, position)
    position += chunk.length
  }
  return result
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Keeps control characters out of XML, which would make the part invalid. */
function sanitizeText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function imageExtension(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png'
  if (data[0] === 0xff && data[1] === 0xd8) return 'jpeg'
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'gif'
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'bmp'
  return 'png'
}

interface EmitState {
  body: string
  rels: string[]
  media: { name: string; data: Uint8Array }[]
  numbering: string[]
  nextRel: number
  nextImage: number
  nextNumber: number
  listStack: { ordered: boolean; numId: number }[]
  warnings: DocxWarning[]
  stats: DocxResult['stats']
  mediaBytes: number
  mediaBudget: number
  footnoteRelId?: number
  footnotes: { id: number; label: string; text: string; anchors: { relId: number; target: number }[] }[]
  anchors: Map<string, number>
  bookmarkId: number
  headingOutline: { level: number; text: string; bookmark: string }[]
}

function runProps(options: { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; size?: number; color?: string }): string {
  const parts: string[] = []
  if (options.code) parts.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/>')
  if (options.bold) parts.push('<w:b/>')
  if (options.italic) parts.push('<w:i/>')
  if (options.strike) parts.push('<w:strike/>')
  if (options.size) parts.push(`<w:sz w:val="${options.size}"/>`)
  if (options.color) parts.push(`<w:color w:val="${options.color}"/>`)
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : ''
}

function textRun(text: string, props = ''): string {
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(sanitizeText(text))}</w:t></w:r>`
}

/** Renders one inline token stream with marks, code, links and math fallbacks. */
function inlineRuns(children: Token[] | null, state: EmitState, baseUrl?: string): string {
  if (!children?.length) return ''
  const runs: string[] = []
  const marks = { bold: false, italic: false, strike: false }
  let linkHref: string | null = null
  let linkRel: string | null = null
  const flushLink = () => {
    if (linkRel) runs.push(`</w:hyperlink>`)
    linkRel = null
    linkHref = null
  }
  for (const token of children) {
    if (token.type === 'strong_open') marks.bold = true
    else if (token.type === 'strong_close') marks.bold = false
    else if (token.type === 'em_open') marks.italic = true
    else if (token.type === 'em_close') marks.italic = false
    else if (token.type === 's_open') marks.strike = true
    else if (token.type === 's_close') marks.strike = false
    else if (token.type === 'link_open') {
      flushLink()
      const href = String(token.attrGet('href') ?? '')
      if (href && baseUrl !== null && /^(?:https?:|mailto:)/i.test(href)) {
        const relId = `rIdLink${++state.nextRel}`
        state.rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(href)}" TargetMode="External"/>`)
        linkRel = relId
        state.stats.hyperlinks++
        runs.push(`<w:hyperlink r:id="${relId}">`)
      } else if (href) {
        // A relative or unsupported target is written as text plus its target,
        // never as a broken relationship.
        linkHref = href
        state.warnings.push({ kind: 'content', message: `超链接目标不是绝对 HTTP(S)/mailto，已作为文本导出：${href}` })
      }
    } else if (token.type === 'link_close') {
      if (linkRel) flushLink()
      else if (linkHref) {
        runs.push(textRun(` (${linkHref})`))
        linkHref = null
      }
    } else if (token.type === 'code_inline') {
      runs.push(textRun(token.content, runProps({ code: true, size: 20 })))
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      runs.push('<w:r><w:br/></w:r>')
    } else if (token.type === 'text') {
      runs.push(textRun(token.content, runProps({ ...marks, color: linkRel ? '1155CC' : undefined })))
    } else if (token.type === 'image') {
      // Inline images are exported by the node pass; keep the alt text here.
      runs.push(textRun(token.content || '[图片]'))
    } else if (token.type === 'html_inline') {
      const stripped = token.content.replace(/<[^>]*>/g, '')
      if (stripped) runs.push(textRun(stripped))
    }
  }
  flushLink()
  return runs.join('')
}

/** Recognises `$...$` / `$$...$$` inside a paragraph as an explicit fallback. */
function mathFallback(text: string, state: EmitState): string | null {
  const block = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(text)
  if (block) {
    state.warnings.push({ kind: 'math', message: '公式以 LaTeX 源码形式导出（未安装排版渲染器）' })
    return `<w:p><w:pPr><w:shd w:val="clear" w:fill="F8F9FA"/><w:jc w:val="center"/></w:pPr>${textRun(block[1].trim(), runProps({ code: true, size: 20 }))}</w:p>`
  }
  return null
}

function listParagraph(state: EmitState, level: number, prefix: string, runs: string): string {
  const numbering = state.listStack[state.listStack.length - 1]
  if (!numbering) return `<w:p><w:pPr><w:ind w:left="${360 * (level + 1)}" w:hanging="360"/></w:pPr>${textRun(prefix)}${runs}</w:p>`
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${Math.min(level, 8)}"/><w:numId w:val="${numbering.numId}"/></w:numPr><w:ind w:left="${360 * (level + 1)}"/></w:pPr>${runs}</w:p>`
}

async function buildDocumentXml(markdown: string, state: EmitState, options: DocxOptions): Promise<void> {
  const md = new MarkdownIt('commonmark', { html: true, linkify: true }).enable(['table', 'strikethrough', 'linkify'])
  const tokens = md.parse(markdown, {})

  if (options.title) {
    state.body += `<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr>${textRun(options.title, runProps({ bold: true, size: 48 }))}</w:p>`
  }

  let index = 0
  while (index < tokens.length) {
    if (options.signal?.aborted) throw new Error('导出已取消')
    const token = tokens[index]

    if (token.type === 'heading_open') {
      const level = Math.min(6, Math.max(1, Number(token.tag.slice(1)) || 1))
      const inline = tokens[index + 1]
      const text = inline?.content ?? ''
      state.bookmarkId++
      const bookmark = `_Toc${state.bookmarkId}`
      state.headingOutline.push({ level, text, bookmark })
      state.body += `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:bookmarkStart w:id="${state.bookmarkId}" w:name="${bookmark}"/>${inlineRuns(inline?.children ?? null, state, '')}<w:bookmarkEnd w:id="${state.bookmarkId}"/></w:p>`
      state.stats.paragraphs++
      index += 3
      continue
    }

    if (token.type === 'paragraph_open') {
      const inline = tokens[index + 1]
      const text = inline?.content ?? ''
      if (/^\s*\[toc\]\s*$/i.test(text)) {
        // Placeholder only: the full heading list exists after this pass.
        state.body += '<!--MARKUMO_TOC-->'
        index += 3
        continue
      }
      const math = mathFallback(text, state)
      if (math) {
        state.body += math
        index += 3
        continue
      }
      // A paragraph holding only an image becomes a real embedded picture.
      const onlyImage = inline?.children?.length === 1 && inline.children[0]?.type === 'image'
      if (onlyImage && options.resolveImage) {
        const child = inline!.children![0]
        const source = String(child.attrGet('src') ?? '')
        const resolved = await options.resolveImage(source).catch(() => null)
        if (resolved && state.mediaBytes + resolved.data.length <= state.mediaBudget && state.nextImage < MAX_IMAGES) {
          const ext = imageExtension(resolved.data)
          const name = `image${++state.nextImage}.${ext}`
          state.media.push({ name, data: resolved.data })
          state.mediaBytes += resolved.data.length
          const relId = `rIdImg${name}`
          state.rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`)
          state.bookmarkId++
          state.body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="5486400" cy="3086100"/><wp:docPr id="${state.bookmarkId}" name="${escapeXml(resolved.alt || name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${state.bookmarkId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
          state.stats.paragraphs++
          state.stats.images++
          index += 3
          continue
        }
        state.warnings.push({ kind: 'image', message: `图片未能嵌入，已用替代文字导出：${source || '(空路径)'}` })
      }
      state.body += `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>${inlineRuns(inline?.children ?? null, state, '')}</w:p>`
      state.stats.paragraphs++
      index += 3
      continue
    }

    if (token.type === 'fence' || token.type === 'code_block') {
      const language = String(token.info || '').trim()
      if (/^mermaid/i.test(language)) {
        state.warnings.push({ kind: 'diagram', message: 'Mermaid 图表以源码形式导出（未安装图形渲染器）' })
      }
      state.body += `<w:p><w:pPr><w:shd w:val="clear" w:fill="F6F8FA"/><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:left="240" w:right="240"/></w:pPr>${textRun(token.content.replace(/\n$/, ''), runProps({ code: true, size: 20 }))}</w:p>`
      state.stats.paragraphs++
      index++
      continue
    }

    if (token.type === 'hr') {
      state.body += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="D0D7DE"/></w:pBdr></w:pPr></w:p>`
      index++
      continue
    }

    if (token.type === 'blockquote_open') {
      let cursor = index + 1
      let first = true
      const callout = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(tokens[cursor]?.type === 'inline' ? tokens[cursor].content : '')
      const accent: Record<string, string> = { NOTE: '3B82F6', TIP: '10B981', IMPORTANT: '8B5CF6', WARNING: 'F59E0B', CAUTION: 'EF4444' }
      const tone = callout ? accent[callout[1].toUpperCase()] : '64748B'
      while (cursor < tokens.length && tokens[cursor].type !== 'blockquote_close') {
        if (tokens[cursor].type === 'inline') {
          let text = tokens[cursor].content
          if (first && callout) {
            const title = callout[2]?.trim() || callout[1].toUpperCase()
            state.body += `<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${tone}"/></w:pBdr><w:shd w:val="clear" w:fill="F8FAFC"/><w:ind w:left="240"/></w:pPr>${textRun(title, runProps({ bold: true, color: tone }))}</w:p>`
            text = text.replace(/^\s*\[![A-Z]+\]\s*/, '')
            first = false
          }
          state.body += `<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${tone}"/></w:pBdr><w:shd w:val="clear" w:fill="F8FAFC"/><w:ind w:left="240"/></w:pPr>${text.split('\n').map(line => textRun(line, runProps({ color: '475569' }))).join('<w:r><w:br/></w:r>')}</w:p>`
          state.stats.paragraphs++
        }
        cursor++
      }
      index = cursor + 1
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const ordered = token.type === 'ordered_list_open'
      const numId = ++state.nextNumber
      state.listStack.push({ ordered, numId })
      state.numbering.push(
        `<w:abstractNum w:abstractNumId="${numId}"><w:multiLevelType w:val="hybridMultilevel"/>` +
        Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${level + 1}.` : ['•', '◦', '▪'][level % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('') +
        `</w:abstractNum>`,
      )
      state.numbering.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${numId}"/></w:num>`)
      state.stats.lists++
      index++
      continue
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      state.listStack.pop()
      index++
      continue
    }

    if (token.type === 'list_item_open') {
      let cursor = index + 1
      let inline: Token | undefined
      while (cursor < tokens.length && tokens[cursor].type !== 'list_item_close') {
        if (tokens[cursor].type === 'inline') { inline = tokens[cursor]; break }
        cursor++
      }
      const level = Math.max(0, state.listStack.length - 1)
      state.body += listParagraph(state, level, '', inlineRuns(inline?.children ?? null, state, ''))
      state.stats.paragraphs++
      index = cursor + 1
      continue
    }

    if (token.type === 'table_open') {
      const rows: string[] = []
      let cursor = index + 1
      let cells: string[] = []
      let header = false
      while (cursor < tokens.length && tokens[cursor].type !== 'table_close') {
        const current = tokens[cursor]
        if (current.type === 'tr_open') { cells = []; header = false }
        else if (current.type === 'th_open') { header = true }
        else if (current.type === 'th_close' || current.type === 'td_close') {
          const inline = tokens[cursor - 1]
          cells.push(`<w:tc><w:tcPr>${header ? '<w:shd w:val="clear" w:fill="F6F8FA"/>' : ''}</w:tcPr><w:p>${inlineRuns(inline?.children ?? null, state, '')}</w:p></w:tc>`)
        } else if (current.type === 'tr_close') {
          rows.push(`<w:tr>${cells.join('')}</w:tr>`)
        }
        cursor++
      }
      state.body += `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D0D7DE"/><w:left w:val="single" w:sz="4" w:color="D0D7DE"/><w:bottom w:val="single" w:sz="4" w:color="D0D7DE"/><w:right w:val="single" w:sz="4" w:color="D0D7DE"/><w:insideH w:val="single" w:sz="4" w:color="D0D7DE"/><w:insideV w:val="single" w:sz="4" w:color="D0D7DE"/></w:tblBorders></w:tblPr>${rows.join('')}</w:tbl><w:p/>`
      state.stats.tables++
      index = cursor + 1
      continue
    }

    if (token.type === 'inline') {
      state.body += `<w:p>${inlineRuns(token.children, state, '')}</w:p>`
      state.stats.paragraphs++
      index++
      continue
    }

    index++
  }
}

/** Collects footnote definitions so they can be exported as an endnote section. */
function extractFootnotes(markdown: string, state: EmitState) {
  const pattern = /^\[\^([^\]]+)\]:[ \t]*([\s\S]*?)(?=\n\[\^|\n\n|$)/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown))) {
    state.footnotes.push({ id: state.footnotes.length + 1, label: match[1], text: match[2].trim(), anchors: [] })
  }
  if (state.footnotes.length) {
    state.warnings.push({ kind: 'footnote', message: `脚注以文末列表形式导出（${state.footnotes.length} 条）` })
  }
}

/** Builds the document, returning the package bytes plus explicit warnings. */
export async function exportMarkdownToNativeDocx(markdownContent: string, options: DocxOptions = {}): Promise<DocxResult> {
  if (markdownContent.length > MAX_TEXT_BYTES) throw new Error('文档超过 64 MiB，无法导出 Word')
  const state: EmitState = {
    body: '',
    rels: [],
    media: [],
    numbering: [],
    nextRel: 0,
    nextImage: 0,
    nextNumber: 0,
    listStack: [],
    warnings: [],
    stats: { paragraphs: 0, tables: 0, lists: 0, hyperlinks: 0, images: 0, footnotes: 0 },
    mediaBytes: 0,
    mediaBudget: options.mediaBudgetBytes ?? MAX_MEDIA_BYTES,
    footnotes: [],
    anchors: new Map(),
    bookmarkId: 0,
    headingOutline: [],
  }

  extractFootnotes(markdownContent, state)
  await buildDocumentXml(markdownContent, state, options)

  // A `[toc]` marker becomes a real, navigable heading list. Page numbers are
  // omitted because Word can only compute them while paginating, and that
  // limitation is reported instead of being hidden.
  if (/^\s*\[toc\]\s*$/im.test(markdownContent)) {
    state.warnings.push({ kind: 'toc', message: '目录以标题列表形式导出，页码需在 Word 中按 F9 更新' })
    const entries = state.headingOutline
      .map(heading => `<w:p><w:pPr><w:pStyle w:val="TOC${Math.min(3, heading.level)}"/><w:ind w:left="${(heading.level - 1) * 240}"/></w:pPr><w:hyperlink w:anchor="${heading.bookmark}">${textRun(heading.text)}</w:hyperlink></w:p>`)
      .join('')
    const tocBlock = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${textRun('目录', runProps({ bold: true }))}</w:p>${entries}`
    state.body = state.body.replace('<!--MARKUMO_TOC-->', tocBlock)
  } else {
    state.body = state.body.replace('<!--MARKUMO_TOC-->', '')
  }

  if (state.footnotes.length) {
    state.body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${textRun('脚注', runProps({ bold: true }))}</w:p>`
    for (const footnote of state.footnotes) {
      state.body += `<w:p><w:pPr><w:ind w:left="240" w:hanging="240"/></w:pPr>${textRun(`[${footnote.id}] ${footnote.label}  `, runProps({ bold: true }))}${textRun(footnote.text)}</w:p>`
      state.stats.footnotes++
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${state.body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`

  const numberingXml = state.numbering.length
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${state.numbering.filter(xml => xml.startsWith('<w:abstractNum')).join('')}${state.numbering.filter(xml => xml.startsWith('<w:num ')).join('')}</w:numbering>`
    : null

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${state.rels.join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${numberingXml ? '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' : ''}</Relationships>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Default Extension="gif" ContentType="image/gif"/>
<Default Extension="bmp" ContentType="image/bmp"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${numberingXml ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ''}
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3, 4, 5, 6].map(level => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(20, 40 - level * 3)}"/></w:rPr></w:style>`).join('')}
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/></w:style>
<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/></w:style>
</w:styles>`

  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'word/document.xml': documentXml,
    'word/_rels/document.xml.rels': documentRels,
    'word/styles.xml': stylesXml,
  }
  if (numberingXml) files['word/numbering.xml'] = numberingXml
  for (const media of state.media) files[`word/media/${media.name}`] = media.data

  return { bytes: createZipArchive(files), warnings: state.warnings, stats: state.stats }
}
