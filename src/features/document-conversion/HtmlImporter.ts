import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { sanitizeHtml } from '../../editor/markdown/html/SafeHtmlRenderer'

export interface HtmlImportResult {
  markdown: string
  title: string
  images: { originalSrc: string; isLocal: boolean }[]
}

export function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  })

  // Use GitHub Flavored Markdown (strikethrough, tables, task lists)
  service.use(gfm)

  // Custom rule: Preserve HTML tables if they contain colspan or rowspan to avoid data loss
  service.addRule('complexTables', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'TABLE') return false
      return !!node.querySelector('[colspan], [rowspan]')
    },
    replacement: (_content: string, node: Node) => {
      const el = node as HTMLElement
      return `\n\n${el.outerHTML}\n\n`
    },
  })

  // Custom rule: Preserve details / summary as clean HTML
  service.addRule('detailsSummary', {
    filter: ['details', 'summary'],
    replacement: (content: string, node: Node) => {
      const el = node as HTMLElement
      if (el.nodeName === 'DETAILS') {
        return `\n\n<details>\n${content.trim()}\n</details>\n\n`
      }
      return `<summary>${content.trim()}</summary>\n`
    },
  })

  return service
}

function cleanHtmlForImport(html: string): string {
  if (typeof window !== 'undefined') {
    return sanitizeHtml(html)
  }
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
}

export function importHtmlToMarkdown(html: string): HtmlImportResult {
  // 1. Sanitize HTML and remove dangerous or UI-only elements
  const cleanHtml = cleanHtmlForImport(html)

  let pageTitle = 'Untitled'
  const images: { originalSrc: string; isLocal: boolean }[] = []
  let bodyContent = cleanHtml

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser()
    const doc = parser.parseFromString(cleanHtml, 'text/html')

    pageTitle =
      doc.querySelector('title')?.textContent?.trim() ||
      doc.querySelector('h1')?.textContent?.trim() ||
      'Untitled'

    const imgElements = doc.querySelectorAll('img')
    for (const img of Array.from(imgElements)) {
      const src = img.getAttribute('src') || ''
      if (src) {
        const isRemote = /^https?:\/\//i.test(src) || src.startsWith('data:')
        images.push({ originalSrc: src, isLocal: !isRemote })
      }
    }
    const body = doc.body || doc.documentElement
    bodyContent = body.innerHTML
  } else {
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(cleanHtml) || /<h1[^>]*>([^<]+)<\/h1>/i.exec(cleanHtml)
    if (titleMatch) pageTitle = titleMatch[1].trim()
  }

  const turndown = createTurndownService()
  const markdown = turndown.turndown(bodyContent).trim()

  return {
    markdown,
    title: pageTitle,
    images,
  }
}
