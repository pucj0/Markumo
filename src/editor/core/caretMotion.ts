export type CaretAnimation = 'off' | 'quick' | 'smooth'
export interface CaretPoint { x: number; y: number; height: number }
export interface CaretTiming { horizontal: number; vertical: number; maxX: number; maxY: number }
export const caretTimings: Record<Exclude<CaretAnimation, 'off'>, CaretTiming> = {
  quick: { horizontal: 100, vertical: 140, maxX: 320, maxY: 320 },
  smooth: { horizontal: 120, vertical: 160, maxX: 320, maxY: 320 },
}

/** Pure interpolation state. Retarget from the current presentation, never queue moves. */
export class CaretMotion {
  private from: CaretPoint | null = null
  private target: CaretPoint | null = null
  private started = 0
  private duration = 0
  get moving() { return this.duration > 0 }
  reset() { this.from = this.target = null; this.duration = 0 }
  sample(now: number): CaretPoint | null {
    if (!this.target || !this.from) return null
    const t = this.duration ? Math.min(1, Math.max(0, (now - this.started) / this.duration)) : 1
    if (t === 1) { this.duration = 0; return this.target }
    const eased = 1 - (1 - t) ** 3
    return { x: this.from.x + (this.target.x - this.from.x) * eased,
      y: this.from.y + (this.target.y - this.from.y) * eased, height: this.target.height }
  }
  set(target: CaretPoint, now: number, timing: CaretTiming, snap = false) {
    const current = this.sample(now)
    // Repeated layout notifications must not restart an in-flight animation.
    if (!snap && this.target && target.x === this.target.x && target.y === this.target.y && target.height === this.target.height) return
    const dy = current ? Math.abs(target.y - current.y) : 0
    // Glyph height is smaller than line height, so a glyph-height multiple
    // incorrectly snaps ordinary clicks a few lines apart (e.g. line 6 → 12).
    snap ||= !current || Math.abs(target.x - current.x) > timing.maxX ||
      dy > timing.maxY || Math.abs(target.height - current.height) > 2
    this.from = snap ? target : current
    this.target = target
    this.started = now
    this.duration = snap || (current?.x === target.x && current?.y === target.y) ? 0 : dy > target.height / 2 ? timing.vertical : timing.horizontal
  }
}
