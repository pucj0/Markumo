import type * as PDFJS from 'pdfjs-dist'
import { openMarkdownLink, safeMarkdownURL } from '../../editor/markdown/links'

export interface ResolvedPdfTarget {
  pageNumber: number
  top?: number
  left?: number
  zoom?: number
  fitMode?: string
}

export interface PdfLinkItem {
  id: string
  rects: { left: number; top: number; width: number; height: number }[]
  type: 'url' | 'dest' | 'action' | 'unsupported'
  url?: string
  dest?: any
  action?: string
  title?: string
  ariaLabel: string
}

/**
 * Validates external URLs against a strict whitelist (http and https only).
 * Disallows javascript:, data:, file:, etc.
 */
export function safePdfUrl(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  return safeMarkdownURL(raw)
}

/**
 * Open external URL via trusted system handler.
 */
export async function openPdfExternalUrl(raw: string) {
  const safe = safePdfUrl(raw)
  if (!safe) {
    window.dispatchEvent(new CustomEvent('editor-notice', { detail: '已拦截非安全或无效的链接' }))
    return
  }
  await openMarkdownLink(safe)
}

/**
 * Resolves PDF destination (array or named string) to concrete page number and target coordinates.
 * Handles XYZ, Fit, FitH, FitV, FitR, FitB, FitBH, FitBV.
 */
export async function resolvePdfDestination(
  docProxy: PDFJS.PDFDocumentProxy,
  dest: any
): Promise<ResolvedPdfTarget | null> {
  if (!dest) return null
  let explicitDest = dest
  if (typeof dest === 'string') {
    explicitDest = await docProxy.getDestination(dest)
  }
  if (!Array.isArray(explicitDest) || !explicitDest.length) return null

  const [pageRef, mode, ...args] = explicitDest
  let pageIndex = -1
  if (typeof pageRef === 'number') {
    pageIndex = pageRef
  } else if (pageRef && typeof pageRef === 'object') {
    pageIndex = await docProxy.getPageIndex(pageRef)
  }
  if (pageIndex < 0 || pageIndex >= docProxy.numPages) return null
  const pageNumber = pageIndex + 1

  let top: number | undefined
  let left: number | undefined
  let zoom: number | undefined
  let fitMode: string | undefined

  const modeName = typeof mode === 'string' ? mode.replace(/^\//, '') : mode?.name ? String(mode.name).replace(/^\//, '') : ''

  if (modeName === 'XYZ') {
    left = typeof args[0] === 'number' && Number.isFinite(args[0]) ? args[0] : undefined
    top = typeof args[1] === 'number' && Number.isFinite(args[1]) ? args[1] : undefined
    if (typeof args[2] === 'number' && Number.isFinite(args[2]) && args[2] > 0) {
      zoom = args[2]
    }
  } else if (modeName === 'Fit' || modeName === 'FitB') {
    fitMode = 'page'
  } else if (modeName === 'FitH' || modeName === 'FitBH') {
    top = typeof args[0] === 'number' && Number.isFinite(args[0]) ? args[0] : undefined
    fitMode = 'width'
  } else if (modeName === 'FitV' || modeName === 'FitBV') {
    left = typeof args[0] === 'number' && Number.isFinite(args[0]) ? args[0] : undefined
  } else if (modeName === 'FitR') {
    left = typeof args[0] === 'number' && Number.isFinite(args[0]) ? args[0] : undefined
    top = typeof args[3] === 'number' && Number.isFinite(args[3]) ? args[3] : undefined
  }

  return { pageNumber, top, left, zoom, fitMode }
}

/**
 * Converts annotation rectangle(s) from PDF user space to viewport pixel coordinates.
 * Honors quadPoints if provided, otherwise falls back to rect bounding box.
 */
export function convertAnnotationRects(
  viewport: PDFJS.PageViewport,
  annot: any
): { left: number; top: number; width: number; height: number }[] {
  const rects: { left: number; top: number; width: number; height: number }[] = []

  if (annot.quadPoints && Array.isArray(annot.quadPoints) && annot.quadPoints.length >= 8) {
    for (let i = 0; i + 7 < annot.quadPoints.length; i += 8) {
      const p1 = viewport.convertToViewportPoint(annot.quadPoints[i], annot.quadPoints[i + 1])
      const p2 = viewport.convertToViewportPoint(annot.quadPoints[i + 2], annot.quadPoints[i + 3])
      const p3 = viewport.convertToViewportPoint(annot.quadPoints[i + 4], annot.quadPoints[i + 5])
      const p4 = viewport.convertToViewportPoint(annot.quadPoints[i + 6], annot.quadPoints[i + 7])

      const xs = [p1[0], p2[0], p3[0], p4[0]]
      const ys = [p1[1], p2[1], p3[1], p4[1]]
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)

      rects.push({
        left: minX,
        top: minY,
        width: Math.max(2, maxX - minX),
        height: Math.max(2, maxY - minY),
      })
    }
  } else if (annot.rect && Array.isArray(annot.rect) && annot.rect.length >= 4) {
    const p1 = viewport.convertToViewportPoint(annot.rect[0], annot.rect[1])
    const p2 = viewport.convertToViewportPoint(annot.rect[2], annot.rect[3])
    const minX = Math.min(p1[0], p2[0])
    const maxX = Math.max(p1[0], p2[0])
    const minY = Math.min(p1[1], p2[1])
    const maxY = Math.max(p1[1], p2[1])

    rects.push({
      left: minX,
      top: minY,
      width: Math.max(2, maxX - minX),
      height: Math.max(2, maxY - minY),
    })
  }

  return rects
}
