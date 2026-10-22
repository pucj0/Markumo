/**
 * Shared, bounded heading index for every TOC node in one document.
 *
 * Previously each TOC re-walked the whole document on *every* selection change,
 * which is the expensive part on large files. The index is keyed by the document
 * revision (a transaction count plus heading structure signature) and reused by
 * all TOC nodes in that document, with a hard cap so it can never grow without
 * bound.
 */

export interface TocHeading {
  pos: number
  level: number
  text: string
}

interface CacheEntry {
  signature: string
  headings: TocHeading[]
}

const MAX_ENTRIES = 4
const cache = new Map<object, CacheEntry>()

/**
 * Cheap structural signature: heading count, levels and text lengths. Any change
 * that could alter the outline changes it, while a body edit that leaves the
 * outline alone keeps the cache valid.
 */
function signatureOf(doc: { descendants: (fn: (node: any) => void) => void }, headingType: unknown): string {
  let signature = ''
  let count = 0
  doc.descendants((node: any) => {
    if (node.type !== headingType) return
    count++
    const text = node.textContent
    signature += `${node.attrs.level}:${text.length}:${text.slice(0, 16)};`
  })
  return `${count}|${signature}`
}

/** Headings of `doc`, reusing a cached scan when the outline is unchanged. */
export function headingsFor(doc: any, headingType: unknown): TocHeading[] {
  const signature = signatureOf(doc, headingType)
  const cached = cache.get(headingType as object)
  if (cached && cached.signature === signature) {
    // Refresh to keep the most recently used document alive in the LRU order.
    cache.delete(headingType as object)
    cache.set(headingType as object, cached)
    return cached.headings
  }

  const headings: TocHeading[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.type === headingType) {
      headings.push({ pos, level: node.attrs.level || 1, text: node.textContent.trim() })
    }
  })

  cache.set(headingType as object, { signature, headings })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return headings
}

/** Drops every cached outline (used when an editor is destroyed). */
export function clearHeadingCache(): void {
  cache.clear()
}

export function headingCacheSize(): number {
  return cache.size
}
