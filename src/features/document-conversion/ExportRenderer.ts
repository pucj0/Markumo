import { createMarkdownRenderer } from '../../editor/markdown/rendering'
import { imageDestination, type MarkdownResources } from '../../editor/markdown/images'
import { sanitizeHtml } from '../../editor/markdown/html/SafeHtmlRenderer'

export interface RenderResult {
  title: string
  bodyHtml: string
}

export function extractDocumentTitle(markdown: string, fallback = 'Untitled'): string {
  // Check for first H1 header '# Title'
  const match = /^#\s+(.+)$/m.exec(markdown)
  if (match && match[1]) {
    return match[1].trim()
  }
  return fallback
}

function cleanHtmlForExport(html: string): string {
  if (typeof window !== 'undefined') {
    return sanitizeHtml(html)
  }
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
}

export async function renderMarkdownForExport(
  markdown: string,
  resources?: MarkdownResources,
  embedImages = true
): Promise<RenderResult> {
  const title = extractDocumentTitle(markdown)
  const renderer = createMarkdownRenderer()
  let rendered = renderer.render(markdown)

  // If in browser / DOM environment, process interactive features
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser()
    const doc = parser.parseFromString(`<div>${rendered}</div>`, 'text/html')
    const container = doc.body.firstElementChild as HTMLElement

    // 1. Process Mermaid diagrams if any exist
    const mermaidBlocks = container.querySelectorAll<HTMLElement>('pre > code.language-mermaid')
    if (mermaidBlocks.length > 0) {
      try {
        const [{ default: mermaid }, { default: purify }] = await Promise.all([
          import('mermaid'),
          import('dompurify'),
        ])
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'default',
          htmlLabels: false,
        })

        let counter = 0
        for (const block of Array.from(mermaidBlocks)) {
          const source = block.textContent || ''
          const id = `markumo-export-mermaid-${++counter}`
          try {
            const { svg } = await mermaid.render(id, source)
            const cleanSvg = purify.sanitize(svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
            })
            const wrapper = doc.createElement('div')
            wrapper.className = 'markumo-diagram-export'
            wrapper.innerHTML = cleanSvg
            block.parentElement?.replaceWith(wrapper)
          } catch (e) {
            console.warn('Mermaid export render fallback:', e)
          } finally {
            document.getElementById('d' + id)?.remove()
          }
        }
      } catch (e) {
        console.warn('Failed to load mermaid for export:', e)
      }
    }

    // 2. Process KaTeX math formulas if any exist
    const mathDisplay = container.querySelectorAll<HTMLElement>('pre > code.language-math, .math-display')
    if (mathDisplay.length > 0) {
      try {
        const { default: katex } = await import('katex')
        for (const block of Array.from(mathDisplay)) {
          const source = block.textContent || ''
          const host = doc.createElement('div')
          host.className = 'katex-display'
          katex.render(source, host, { displayMode: true, throwOnError: false })
          block.parentElement?.replaceWith(host)
        }
      } catch (e) {
        console.warn('Failed to render math for export:', e)
      }
    }

    // 3. Process images: embed local images as Data URI if requested
    if (embedImages && resources) {
      const images = container.querySelectorAll<HTMLImageElement>('img')
      for (const img of Array.from(images)) {
        const src = img.getAttribute('src') || ''
        if (!src || src.startsWith('data:')) continue

        const dest = imageDestination(src)
        if (dest.kind === 'local') {
          try {
            const bytes = await resources.loadLocal(dest.path)
            const dataUri = uint8ArrayToDataUri(bytes)
            img.setAttribute('src', dataUri)
          } catch (e) {
            console.warn(`Export: Could not embed local image "${src}":`, e)
          }
        }
      }
    }
    rendered = container.innerHTML
  }

  // 4. Sanitize final HTML to ensure strict XSS safety
  const cleanHtml = cleanHtmlForExport(rendered)

  return {
    title,
    bodyHtml: cleanHtml,
  }
}

function uint8ArrayToDataUri(bytes: Uint8Array): string {
  let mimeType = 'image/png'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    mimeType = 'image/png'
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = 'image/jpeg'
  } else if (bytes[0] === 0x47 && bytes[1] === 0x49) {
    mimeType = 'image/gif'
  } else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    mimeType = 'image/webp'
  }

  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}
