/** Viewport coordinates: overlays never participate in document layout. */
export function positionImageOverlay(overlay: HTMLElement, anchor: HTMLElement, pane: HTMLElement) {
  const bounds = pane.getBoundingClientRect(), image = anchor.getBoundingClientRect()
  const left = Math.max(8, bounds.left + 8), right = Math.min(innerWidth - 8, bounds.right - 8)
  const top = Math.max(8, bounds.top + 8), bottom = Math.min(innerHeight - 8, bounds.bottom - 8)
  overlay.style.maxWidth = `${Math.max(0, right - left)}px`
  overlay.style.maxHeight = `${Math.max(0, bottom - top)}px`
  const size = overlay.getBoundingClientRect()
  const visible = image.bottom > top && image.top < bottom && image.right > left && image.left < right
  overlay.style.visibility = visible ? '' : 'hidden'
  const x = Math.max(left, Math.min(right - size.width, image.left + (image.width - size.width) / 2))
  // A tall image may fill the viewport; keep controls on its own surface then.
  const fits = (y: number) => y >= top && y + size.height <= bottom
  const inside = Math.max(top, Math.min(bottom - size.height, image.top + 8))
  const y = [image.top - size.height - 8, image.bottom + 8, inside].find(fits) ?? inside
  overlay.style.left = `${x}px`
  overlay.style.top = `${y}px`
}
