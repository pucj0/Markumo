const animations = new WeakMap<HTMLElement, () => void>()

export function cancelSmoothScroll(element: HTMLElement | null | undefined) {
  if (element) animations.get(element)?.()
}

export function isSmoothScrolling(element: HTMLElement | null | undefined): boolean {
  return !!element && animations.has(element)
}

/** One short animation per scroll container. Resolve the destination on every
 * frame because CodeMirror measures virtualized lines as they enter view. */
export function smoothScrollTo(element: HTMLElement, destination: () => number, valid = () => true) {
  cancelSmoothScroll(element)
  const target = () => Math.max(0, Math.min(element.scrollHeight - element.clientHeight, destination()))
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (valid()) element.scrollTop = target()
    return
  }
  const from = element.scrollTop, distance = Math.abs(target() - from)
  if (distance < 1) return
  const duration = Math.min(420, Math.max(240, 220 + Math.sqrt(distance) * 2))
  const started = performance.now()
  let frame = 0, settling = 0
  const finish = (event?: Event) => {
    if (event?.type === 'blur' && event.target !== window) return
    cancelAnimationFrame(frame)
    animations.delete(element)
    for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown', 'blur', 'resize']) window.removeEventListener(name, finish, true)
  }
  const tick = (now: number) => {
    if (!element.isConnected || !valid()) { finish(); return }
    const progress = Math.min(1, (now - started) / duration)
    const next = target()
    element.scrollTop = from + (next - from) * (1 - (1 - progress) ** 3)
    // Give virtualized editors a few frames to finish measuring the destination.
    if (progress >= 1 && ++settling >= 3) { finish(); return }
    frame = requestAnimationFrame(tick)
  }
  animations.set(element, finish)
  for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown', 'blur', 'resize']) window.addEventListener(name, finish, { capture: true, passive: true })
  frame = requestAnimationFrame(tick)
}
