/** Two clean, short Shift taps. Native Shift behavior is never prevented. */
export class DoubleShiftShortcut {
  private heldAt: number | null = null
  private previousTap: number | null = null
  private readonly interval = 400

  constructor(
    private activate: () => void,
    private enabled: (event: KeyboardEvent) => boolean,
    private now: () => number = () => performance.now(),
  ) {}

  reset = () => { this.heldAt = this.previousTap = null }

  private allowed(event: KeyboardEvent) {
    return !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 &&
      !event.ctrlKey && !event.altKey && !event.metaKey && this.enabled(event)
  }

  keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Shift' || !this.allowed(event)) { this.reset(); return }
    if (event.repeat) return
    // Pressing both Shift keys together is not two separate taps.
    if (this.heldAt !== null) { this.reset(); return }
    this.heldAt = this.now()
  }

  keyup = (event: KeyboardEvent) => {
    if (event.key !== 'Shift' || !this.allowed(event)) { this.reset(); return }
    const now = this.now(), heldAt = this.heldAt
    this.heldAt = null
    if (heldAt === null || now - heldAt > this.interval || event.shiftKey) { this.reset(); return }
    if (this.previousTap !== null && now - this.previousTap <= this.interval) {
      this.reset()
      this.activate()
    } else this.previousTap = now
  }
}
