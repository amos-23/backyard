import { type VatarErrorCode, type VatarScoreResult, errorCode } from "./vatar-types"

/** The SDK accepts one score per player every 20 s; we leave a small margin. */
export const SCORE_INTERVAL_MS = 20_500
export const MAX_RETRIES = 3

export type SubmissionStatus =
  | { state: "idle" }
  | { state: "waiting"; score: number } // held until the platform connection is known
  | { state: "queued"; score: number; sendAt: number }
  | { state: "sending"; score: number }
  | { state: "sent"; score: number; best: number; accepted: boolean }
  | { state: "failed"; score: number; code: VatarErrorCode }
  | { state: "local"; score: number } // no platform: saved on this device only

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

type Mode = "pending" | "enabled" | "local"

/**
 * Sends scores at milestones without breaking the documented rate limit. Only the highest
 * unsent score is kept; lower or repeated scores are dropped, and too_soon / rate_limited /
 * transient errors are retried later in the background so gameplay is never interrupted.
 */
export class ScoreQueue {
  private mode: Mode = "pending"
  private pending: number | null = null
  private sentBest = 0
  private lastAttempt = -Infinity
  private inFlight = false
  private timer: unknown = null
  private retries = 0
  private status: SubmissionStatus = { state: "idle" }
  private listeners = new Set<(s: SubmissionStatus) => void>()

  constructor(
    private readonly send: (n: number) => Promise<VatarScoreResult>,
    private readonly clock: Clock = realClock,
  ) {}

  get current(): SubmissionStatus {
    return this.status
  }

  onChange(fn: (s: SubmissionStatus) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** The platform connected: start sending. */
  enable(): void {
    if (this.mode === "enabled") return
    this.mode = "enabled"
    if (this.pending !== null) this.schedule(0)
  }

  /** No platform (local development or unavailable): nothing will ever be sent. */
  disableLocal(): void {
    this.mode = "local"
    this.cancelTimer()
    if (this.pending !== null) this.emit({ state: "local", score: this.pending })
    this.pending = null
  }

  submit(raw: number): void {
    const score = Math.floor(raw)
    if (!Number.isFinite(score) || score <= 0) return
    if (this.mode === "local") return this.emit({ state: "local", score })
    if (score <= this.sentBest || (this.pending !== null && score <= this.pending)) return
    this.pending = score
    if (this.mode === "pending") return this.emit({ state: "waiting", score })
    this.schedule(0)
  }

  private schedule(minDelay: number): void {
    if (this.inFlight || this.pending === null || this.mode !== "enabled") return
    const now = this.clock.now()
    const wait = Math.max(minDelay, this.lastAttempt + SCORE_INTERVAL_MS - now, 0)
    this.cancelTimer()
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      void this.flush()
    }, wait)
    this.emit({ state: "queued", score: this.pending, sendAt: now + wait })
  }

  private async flush(): Promise<void> {
    if (this.inFlight || this.pending === null || this.mode !== "enabled") return
    const score = this.pending
    this.pending = null
    this.inFlight = true
    this.lastAttempt = this.clock.now()
    this.emit({ state: "sending", score })
    let retryIn: number | null = null
    try {
      const r = await this.send(score)
      this.sentBest = Math.max(this.sentBest, score)
      this.retries = 0
      this.emit({ state: "sent", score, best: r.best, accepted: r.accepted })
    } catch (e) {
      const code = errorCode(e)
      const transient = code === "too_soon" || code === "rate_limited" || code === "timeout" || code === "error"
      if (transient && this.retries < MAX_RETRIES) {
        this.retries++
        this.pending = Math.max(this.pending ?? 0, score)
        retryIn = SCORE_INTERVAL_MS * (code === "too_soon" ? 1 : this.retries)
      } else {
        this.retries = 0
        this.emit({ state: "failed", score, code })
      }
    } finally {
      this.inFlight = false
    }
    if (this.pending !== null) this.schedule(retryIn ?? 0)
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
  }

  private emit(s: SubmissionStatus): void {
    this.status = s
    for (const fn of this.listeners) fn(s)
  }
}
