/**
 * Guards for the few places that legitimately need markup instead of text.
 *
 * Document content is never allowed through these helpers: they exist only for
 * fixed icon templates that ship with the editor. Callers pass a constant, and
 * the constant is re-validated here so an accidental string interpolation can
 * never turn a template into an injection point.
 */

const ALLOWED_ICON_TAGS = new Set(['svg', 'g', 'path', 'polyline', 'line', 'circle', 'rect', 'polygon', 'ellipse'])
const ALLOWED_ICON_ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'class', 'aria-hidden', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
])
const TAG_PATTERN = /<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:="[^"<>]*")?)*)\s*\/?>/g
const ATTRIBUTE_PATTERN = /([^\s=/>]+)(?:="([^"<>]*)")?/g

/** True only for a well-formed, attribute-allow-listed static SVG icon. */
export function isStaticSvgIcon(markup: string): boolean {
  if (!markup || !markup.trimStart().startsWith('<svg')) return false
  // Reject any markup that could execute or load something.
  if (/<\s*(script|style|iframe|object|embed|foreignObject|image|use|a)\b/i.test(markup)) return false
  if (/\son[a-z]+\s*=/i.test(markup)) return false
  let wellFormed = true
  for (const tag of markup.matchAll(TAG_PATTERN)) {
    const name = tag[1]
    // Lowercase comparison: SVG uses camelCase (viewBox) but tags are lowercase.
    if (!ALLOWED_ICON_TAGS.has(name.toLowerCase())) { wellFormed = false; break }
    for (const attribute of tag[2].matchAll(ATTRIBUTE_PATTERN)) {
      const key = attribute[1]
      if (key === '/') continue
      if (!ALLOWED_ICON_ATTRIBUTES.has(key)) { wellFormed = false; break }
      if (/^on/i.test(key)) { wellFormed = false; break }
    }
    if (!wellFormed) break
  }
  return wellFormed
}

/**
 * Sets a validated static icon template. Throws on anything else so a template
 * mistake fails loudly in tests instead of silently becoming an XSS sink.
 */
export function setStaticIcon(element: HTMLElement, iconMarkup: string): void {
  if (!isStaticSvgIcon(iconMarkup)) throw new Error('拒绝非静态图标标记')
  element.innerHTML = iconMarkup
}

/** Appends plain text; use for every value that came from a document. */
export function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string | undefined,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = text
  return element
}
