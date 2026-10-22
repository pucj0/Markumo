// Load only for documents containing diagrams or formulas.
let serial: Promise<unknown> = Promise.resolve(), identity = 0

// Bounded LRU caches for compiled math HTML and sanitized diagram SVG
const MATH_CACHE_LIMIT = 300
const mathHtmlCache = new Map<string, string>()

const DIAGRAM_CACHE_LIMIT = 30
const diagramSvgCache = new Map<string, string>()

/** Namespace a sanitized DOM fragment on every mount, including cache hits.
 * Rewrite CSS through CSSOM so selectors and declarations remain separate. */
function mountDiagram(host: HTMLElement, sanitized: string) {
  const template = document.createElement('template')
  template.innerHTML = sanitized
  const ids = new Map<string, string>(), prefix = `markumo-mount-${++identity}-`
  for (const element of template.content.querySelectorAll('[id]')) {
    const old = element.id, next = prefix + ids.size
    ids.set(old, next)
    element.id = next
  }
  const urls = (value: string) => value.replace(/url\(\s*(["']?)#([^\s)'"]+)\1\s*\)/g,
    (original, _quote, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : original)
  const decodeIdentifier = (value: string) => value.replace(/\\([\da-f]{1,6}\s?|.)/gi, (_all, escaped: string) =>
    /^[\da-f]/i.test(escaped) ? String.fromCodePoint(parseInt(escaped.trim(), 16)) : escaped)
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'id') continue
      let value = urls(attribute.value)
      if (['aria-labelledby', 'aria-describedby'].includes(attribute.name)) value = value.split(/\s+/).map(id => ids.get(id) ?? id).join(' ')
      if (['href', 'xlink:href'].includes(attribute.name) && value.startsWith('#')) value = '#' + (ids.get(value.slice(1)) ?? value.slice(1))
      element.setAttribute(attribute.name, value)
    }
    if (element.localName === 'style') {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(element.textContent ?? '')
      const rewrite = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule) {
            rule.selectorText = rule.selectorText.replace(/#((?:\\[\da-f]{1,6}\s?|\\.|[\w\u0080-\uFFFF-])+)/gi, (original, token: string) => {
              const id = ids.get(decodeIdentifier(token))
              return id ? '#' + CSS.escape(id) : original
            })
            for (const property of rule.style) rule.style.setProperty(property, urls(rule.style.getPropertyValue(property)), rule.style.getPropertyPriority(property))
          } else if ('cssRules' in rule) rewrite((rule as CSSGroupingRule).cssRules)
        }
      }
      rewrite(sheet.cssRules)
      element.textContent = [...sheet.cssRules].map(rule => rule.cssText).join('\n')
    }
  }
  host.replaceChildren(template.content)
}

export function clearRenderCaches() {
  mathHtmlCache.clear()
  diagramSvgCache.clear()
}

export async function renderDiagram(host: HTMLElement, source: string, current: () => boolean = () => true) {
  if (source.length > 8000 || source.split('\n').length > 200) throw new Error('图表超过 8000 字符 / 200 行安全预算，请编辑源码。')
  if (/%%\{|^\s*---|@\{|<|https?:|url\s*\(|\b(?:click|href|callback|linkStyle|classDef|style)\b/im.test(source)) throw new Error('图表中的配置、资源、样式、外链和回调未启用。')

  const isLight = typeof document !== 'undefined' && document.body.classList.contains('light')
  const cacheKey = `${isLight ? 'L:' : 'D:'}${source}`
  const cachedSvg = diagramSvgCache.get(cacheKey)

  if (cachedSvg !== undefined) {
    if (!host.isConnected || !current()) return
    diagramSvgCache.delete(cacheKey)
    diagramSvgCache.set(cacheKey, cachedSvg)
    mountDiagram(host, cachedSvg)
    return
  }

  const request = serial.then(async () => {
    if (!host.isConnected || !current()) return
    // Concurrent identical requests may have queued before the first render.
    const queuedCache = diagramSvgCache.get(cacheKey)
    if (queuedCache !== undefined) { mountDiagram(host, queuedCache); return }
    const [{ default: mermaid }, { default: purify }] = await Promise.all([import('mermaid'), import('dompurify')])
    if (!host.isConnected || !current()) return

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      maxTextSize: 8000,
      maxEdges: 200,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: isLight ? 'default' : 'dark',
    })

    const id = `markumo-diagram-${++identity}`
    try {
      const { svg } = await mermaid.render(id, source)
      if (!host.isConnected || !current()) return
      const cleaned = purify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'a', 'image', 'script', 'iframe'],
        FORBID_ATTR: ['href', 'xlink:href', 'onclick', 'onload'],
      })

      if (diagramSvgCache.size >= DIAGRAM_CACHE_LIMIT) {
        const oldest = diagramSvgCache.keys().next().value
        if (oldest) diagramSvgCache.delete(oldest)
      }
      diagramSvgCache.set(cacheKey, cleaned)

      mountDiagram(host, cleaned)
    } finally {
      document.getElementById('d' + id)?.remove()
    }
  })
  serial = request.catch(() => {})
  await request
}

export async function renderMath(host: HTMLElement, source: string, displayMode = false, current: () => boolean = () => true) {
  if (source.length > 4096) throw new Error('公式超过 4096 字符预算，请编辑源码。')

  const cacheKey = `${displayMode ? 'D:' : 'I:'}${source}`
  const cachedHtml = mathHtmlCache.get(cacheKey)
  if (cachedHtml !== undefined) {
    if (!host.isConnected || !current()) return
    host.innerHTML = cachedHtml
    return
  }

  const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
  if (!host.isConnected || !current()) return

  // Render to static HTML string with trust disabled; bounds AST allocation
  const html = katex.renderToString(source, {
    displayMode,
    trust: false,
    strict: 'error',
    throwOnError: false,
    maxExpand: 200,
    maxSize: 20,
  })

  if (mathHtmlCache.size >= MATH_CACHE_LIMIT) {
    const oldest = mathHtmlCache.keys().next().value
    if (oldest) mathHtmlCache.delete(oldest)
  }
  mathHtmlCache.set(cacheKey, html)

  if (host.isConnected && current()) {
    host.innerHTML = html
  }
}
