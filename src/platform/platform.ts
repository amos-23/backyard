import type { LocalScore } from "../storage/storage"
import { type Clock, ScoreQueue, type SubmissionStatus, realClock } from "./score-queue"
import { type VatarErrorCode, type VatarLeaderboard, type VatarSdk, errorCode } from "./vatar-types"

/**
 * The one place the game talks to the Vatar host. Everything else sees this small interface,
 * so the game runs identically inside the Lagos Life game player, in the Vatar sandbox, or opened
 * directly in a browser during development (where it clearly reports "local mode").
 */
export type ConnectionState = "connecting" | "connected" | "local" | "unavailable"

export interface PlatformStatus {
  state: ConnectionState
  /** "live" or "test" once connected (test = Vatar sandbox). */
  mode: "live" | "test" | null
  /** Human-readable explanation when not connected. */
  message: string | null
}

export interface PlayerInfo {
  name: string
  avatar: string | null
}

export type LeaderboardResult =
  | { source: "platform"; board: VatarLeaderboard; fetchedAt: number; stale: boolean }
  | { source: "local"; scores: LocalScore[]; reason: string }
  | { source: "error"; code: VatarErrorCode; message: string; scores: LocalScore[] }

/** The SDK refreshes its leaderboard at most every 30 s and allows 12 reads a minute. */
export const LEADERBOARD_CACHE_MS = 30_000
const INIT_RETRY_MS = 2_500

const MESSAGES: Record<string, string> = {
  "sdk-missing": "Local mode: the Vatar SDK could not be loaded. Scores are saved on this device only.",
  not_framed: "Local mode: open the game inside Lagos Life to join the leaderboard. Scores are saved on this device only.",
  signed_out: "You're not signed in to Lagos Life, so scores can't be posted. They're saved on this device.",
  off: "Online features for this game are switched off right now. Scores are saved on this device.",
  rate_limited: "Lagos Life is busy. Scores are saved on this device for now.",
  timeout: "Couldn't reach Lagos Life. Scores are saved on this device for now.",
  error: "Lagos Life had a problem. Scores are saved on this device for now.",
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? MESSAGES.error
}

export class Platform {
  private statusValue: PlatformStatus = { state: "connecting", mode: null, message: null }
  private playerValue: PlayerInfo | null = null
  private readonly queue: ScoreQueue
  private statusListeners = new Set<(s: PlatformStatus) => void>()
  private pauseListeners = new Set<() => void>()
  private resumeListeners = new Set<() => void>()
  private cache: { board: VatarLeaderboard; at: number } | null = null
  private inflightBoard: Promise<LeaderboardResult> | null = null
  private connecting: Promise<PlatformStatus> | null = null
  private sdk: VatarSdk | undefined
  private readonly sdkReady: Promise<VatarSdk | undefined>

  /** @param sdk the SDK, or a promise for it while its script is still loading (undefined = unavailable). */
  constructor(
    sdk: VatarSdk | undefined | Promise<VatarSdk | undefined>,
    private readonly localScores: () => LocalScore[],
    private readonly clock: Clock = realClock,
  ) {
    this.queue = new ScoreQueue((n) => this.requireSdk().submitScore(n), clock)
    this.sdkReady = Promise.resolve(sdk).then((s) => {
      this.sdk = s
      if (s) {
        // Listeners are harmless outside the host; inside it they fire when the phone backgrounds the
        // game or a world sheet covers it.
        s.onPause(() => this.pauseListeners.forEach((fn) => fn()))
        s.onResume(() => this.resumeListeners.forEach((fn) => fn()))
      }
      return s
    })
  }

  get status(): PlatformStatus {
    return this.statusValue
  }

  get player(): PlayerInfo | null {
    return this.playerValue
  }

  get submission(): SubmissionStatus {
    return this.queue.current
  }

  get isConnected(): boolean {
    return this.statusValue.state === "connected"
  }

  /** Connect to the host. Safe to call more than once; never rejects. */
  connect(): Promise<PlatformStatus> {
    this.connecting ??= this.doConnect()
    return this.connecting
  }

  private async doConnect(): Promise<PlatformStatus> {
    const sdk = await this.sdkReady
    if (!sdk) return this.goLocal("sdk-missing")
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await sdk.init()
        this.playerValue = { name: r.player.name, avatar: r.player.avatar }
        this.setStatus({ state: "connected", mode: r.mode, message: null })
        this.queue.enable()
        return this.statusValue
      } catch (e) {
        const code = errorCode(e)
        if (code === "not_framed") return this.goLocal(code)
        const retryable = code === "rate_limited" || code === "timeout" || code === "error"
        if (!retryable || attempt === 1) {
          this.queue.disableLocal()
          this.setStatus({ state: "unavailable", mode: null, message: messageFor(code) })
          return this.statusValue
        }
        await new Promise((ok) => this.clock.setTimeout(() => ok(undefined), INIT_RETRY_MS))
      }
    }
    return this.statusValue
  }

  private goLocal(code: string): PlatformStatus {
    this.queue.disableLocal()
    this.setStatus({ state: "local", mode: null, message: messageFor(code) })
    return this.statusValue
  }

  /** Queue a score for the leaderboard. Call at milestones (level complete, end of run), not per frame. */
  submitScore(score: number): void {
    this.queue.submit(score)
  }

  onSubmission(fn: (s: SubmissionStatus) => void): () => void {
    return this.queue.onChange(fn)
  }

  onStatus(fn: (s: PlatformStatus) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  onPause(fn: () => void): () => void {
    this.pauseListeners.add(fn)
    return () => this.pauseListeners.delete(fn)
  }

  onResume(fn: () => void): () => void {
    this.resumeListeners.add(fn)
    return () => this.resumeListeners.delete(fn)
  }

  /**
   * The platform leaderboard when connected, otherwise this device's own scores. The platform only
   * refreshes it every 30 s, so a fresher copy is served from cache and concurrent calls share one request.
   */
  async leaderboard(): Promise<LeaderboardResult> {
    await this.connect()
    if (!this.isConnected) {
      return { source: "local", scores: this.localScores(), reason: this.statusValue.message ?? messageFor("not_framed") }
    }
    if (this.cache && this.clock.now() - this.cache.at < LEADERBOARD_CACHE_MS) {
      return { source: "platform", board: this.cache.board, fetchedAt: this.cache.at, stale: false }
    }
    this.inflightBoard ??= this.fetchBoard().finally(() => (this.inflightBoard = null))
    return this.inflightBoard
  }

  private async fetchBoard(): Promise<LeaderboardResult> {
    try {
      const board = await this.requireSdk().leaderboard()
      this.cache = { board, at: this.clock.now() }
      return { source: "platform", board, fetchedAt: this.cache.at, stale: false }
    } catch (e) {
      const code = errorCode(e)
      if (this.cache) return { source: "platform", board: this.cache.board, fetchedAt: this.cache.at, stale: true }
      return { source: "error", code, message: messageFor(code), scores: this.localScores() }
    }
  }

  private requireSdk(): VatarSdk {
    if (!this.sdk) throw Object.assign(new Error("Vatar: not_framed"), { code: "not_framed" })
    return this.sdk
  }

  private setStatus(s: PlatformStatus): void {
    this.statusValue = s
    this.statusListeners.forEach((fn) => fn(s))
  }
}
