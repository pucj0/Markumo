import { CaretMotion, caretTimings, type CaretAnimation, type CaretPoint } from './caretMotion'
import './smoothCaret.css'

interface Rect { left: number; top: number; right: number; bottom: number }
export interface CaretMeasurement { point: CaretPoint; width: number; height: number; scrollX: number; scrollY: number; clip: string }

/** Read only in an editor's measurement phase. Coordinates arrive in viewport pixels. */
export function measureCaret(host: HTMLElement, rect: Rect | null, clipHost = host): CaretMeasurement | null {
  if (!rect || !host.isConnected || ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) || rect.bottom <= rect.top) return null
  const box = host.getBoundingClientRect()
  const style = getComputedStyle(host)
  const borderBox = (dimension: 'width' | 'height') => {
    const sides = dimension === 'width' ? ['Left', 'Right'] : ['Top', 'Bottom']
    return parseFloat(style[dimension]) + (style.boxSizing === 'border-box' ? 0 : sides.reduce((sum, side) =>
      sum + parseFloat(style.getPropertyValue(`padding-${side.toLowerCase()}`)) + parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)), 0))
  }
  // offsetWidth/Height round to integer CSS pixels. Small, auto-sized code
  // blocks need the fractional border box to avoid introducing a fake scale.
  const sx = box.width / borderBox('width'), sy = box.height / borderBox('height')
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0 || !host.clientWidth || !host.clientHeight) return null
  const left = box.left + host.clientLeft * sx, top = box.top + host.clientTop * sy
  let l = Math.max(0, left), t = Math.max(0, top)
  let r = Math.min(window.innerWidth, left + host.clientWidth * sx), b = Math.min(window.innerHeight, top + host.clientHeight * sy)
  for (let el: HTMLElement | null = clipHost; el; el = el.parentElement) {
    const style = getComputedStyle(el)
    const x = /(auto|scroll|hidden|clip)/.test(style.overflowX), y = /(auto|scroll|hidden|clip)/.test(style.overflowY)
    if (!x && !y) continue
    const bounds = el.getBoundingClientRect()
    if (x) { l = Math.max(l, bounds.left + el.clientLeft * sx); r = Math.min(r, bounds.left + (el.clientLeft + el.clientWidth) * sx) }
    if (y) { t = Math.max(t, bounds.top + el.clientTop * sy); b = Math.min(b, bounds.top + (el.clientTop + el.clientHeight) * sy) }
  }
  if (rect.left < l || rect.left + 2 > r || rect.top < t || rect.bottom > b) return null
  return { point: { x: (rect.left - left) / sx, y: (rect.top - top) / sy, height: (rect.bottom - rect.top) / sy },
    width: host.clientWidth, height: host.clientHeight, scrollX: host.scrollLeft, scrollY: host.scrollTop,
    clip: `inset(${(t - top) / sy}px ${Math.max(0, host.clientWidth - (r - left) / sx)}px ${Math.max(0, host.clientHeight - (b - top) / sy)}px ${(l - left) / sx}px)` }
}

/** Stable, inert DOM outside editable content. Animation frames only write transforms. */
export class CaretOverlay {
  readonly layer = document.createElement('div')
  private caret = document.createElement('div')
  private motion = new CaretMotion()
  private frame = 0
  private blink?: Animation
  private dead = false
  private geometry = ''
  constructor(private host: HTMLElement, private nativeHost: HTMLElement) {
    this.layer.className = 'smooth-caret-layer'
    this.layer.setAttribute('aria-hidden', 'true')
    this.layer.contentEditable = 'false'
    this.caret.className = 'smooth-caret'
    this.layer.append(this.caret)
    this.layer.hidden = true
    host.append(this.layer)
  }
  show(measurement: CaretMeasurement | null, mode: CaretAnimation, reduced: boolean, snap = false, activity = false) {
    if (this.dead) return
    if (!measurement || mode === 'off') { this.hide(); return }
    const { point, width, height, scrollX, scrollY, clip } = measurement
    const geometry = `${scrollX}/${scrollY}`
    snap ||= this.layer.hidden || geometry !== this.geometry
    this.geometry = geometry
    this.layer.style.width = `${width}px`
    this.layer.style.height = `${height}px`
    this.layer.style.transform = `translate(${scrollX}px, ${scrollY}px)`
    this.layer.style.clipPath = clip
    this.caret.style.height = `${point.height}px`
    this.motion.set(point, performance.now(), caretTimings[mode], snap || reduced)
    this.paint(performance.now())
    if (activity || this.layer.hidden) {
      this.blink?.cancel()
      // WAAPI restarts blink without forcing layout. No JS timer runs while idle.
      this.blink = reduced ? undefined : this.caret.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 1000, delay: 500, iterations: Infinity, easing: 'steps(2, jump-none)',
      })
    }
    this.layer.hidden = false
    // Install fallback suppression only after a valid visual caret has been painted.
    this.nativeHost.classList.add('smooth-caret-active')
    if (this.motion.moving && !this.frame) this.frame = requestAnimationFrame(this.tick)
  }
  private paint(now: number) {
    const point = this.motion.sample(now)
    if (point) this.caret.style.transform = `translate(${point.x}px, ${point.y}px)`
  }
  private tick = (now: number) => {
    this.frame = 0
    if (this.dead || this.layer.hidden || !this.host.isConnected) { this.hide(); return }
    this.paint(now)
    if (this.motion.moving) this.frame = requestAnimationFrame(this.tick)
  }
  hide() {
    if (this.layer.hidden && !this.frame) return
    this.nativeHost.classList.remove('smooth-caret-active')
    this.layer.hidden = true
    cancelAnimationFrame(this.frame); this.frame = 0
    this.blink?.cancel(); this.blink = undefined
    this.motion.reset()
  }
  destroy() { this.dead = true; this.hide(); this.layer.remove() }
}

/** Shared lifecycle signals; no polling, and no editor state/DOM Selection writes. */
export class CaretEnvironment {
  composing = false
  private dead = false
  private focusedWindow = true
  readonly reduced = matchMedia('(prefers-reduced-motion: reduce)')
  private cleanups: (() => void)[] = []
  private resize: ResizeObserver
  get suspended() { return this.dead || document.hidden || !this.focusedWindow || this.composing }
  constructor(root: HTMLElement, content: HTMLElement, private overlay: CaretOverlay, refresh: (snap: boolean) => void) {
    const listen = (target: EventTarget, event: string, handler: EventListener) => {
      target.addEventListener(event, handler, { capture: true, passive: true })
      this.cleanups.push(() => target.removeEventListener(event, handler, true))
    }
    const layout = () => { if (!this.dead) { overlay.hide(); refresh(true) } }
    listen(document, 'scroll', event => {
      const target = event.target
      if (!(target instanceof Element) || target.contains(root) || root.contains(target)) layout()
    })
    listen(window, 'resize', layout)
    listen(window, 'blur', () => { this.focusedWindow = false; overlay.hide() })
    listen(window, 'focus', () => { this.focusedWindow = true; refresh(true) })
    listen(document, 'visibilitychange', () => { overlay.hide(); if (!document.hidden) refresh(true) })
    listen(root, 'focusin', () => refresh(true))
    listen(root, 'focusout', () => { overlay.hide(); queueMicrotask(() => { if (!this.dead) refresh(true) }) })
    listen(root, 'compositionstart', () => { this.composing = true; overlay.hide() })
    for (const name of ['compositionend', 'compositioncancel']) listen(root, name, () => { this.composing = false; refresh(true) })
    listen(root, 'load', layout)
    listen(this.reduced, 'change', layout)
    listen(document.fonts, 'loadingdone', layout)
    let width: number | undefined
    this.resize = new ResizeObserver(entries => {
      if (this.dead) return
      const bounds = entries.find(entry => entry.target === root)?.contentRect
      const reflow = !!bounds && width !== undefined && Math.abs(bounds.width - width) > .5
      if (bounds) width = bounds.width
      // Content growing while typing must retain the normal cross-line animation.
      // A pane width change invalidates wrapping and should instead snap.
      if (reflow) layout()
      else refresh(false)
    })
    this.resize.observe(root); this.resize.observe(content)
  }
  destroy() { this.dead = true; this.resize.disconnect(); for (const cleanup of this.cleanups) cleanup(); this.overlay.hide() }
}
