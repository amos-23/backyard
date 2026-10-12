import { describe, expect, it, vi } from "vitest"
import { Platform } from "../src/platform/platform"
import { type Clock, SCORE_INTERVAL_MS, ScoreQueue, type SubmissionStatus } from "../src/platform/score-queue"
import type { VatarSdk } from "../src/platform/vatar-types"
import { fakeSdk } from "./helpers/fake-sdk"

/** A manual clock so rate-limit timing can be stepped precisely. */
function fakeClock() {
  let now = 1_000_000
  let timers: { at: number; fn: () => void; id: number }[] = []
  let seq = 0
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq
      timers.push({ at: now + ms, fn, id })
      return id
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id)
    },
  }
  async function advance(ms: number) {
    const end = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > end) break
      timers.shift()
      now = next.at
      next.fn()
      await flushPromises()
    }
    now = end
    await flushPromises()
  }
  return { clock, advance }
}

const flushPromises = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const sdkError = (code: string) => Object.assign(new Error(`Vatar: ${code}`), { code })

describe("ScoreQueue", () => {
  it("sends at most one score per 20 seconds and only the highest pending one", async () => {
    const { clock, advance } = fakeClock()
    const send = vi.fn(async (n: number) => ({ best: n, accepted: true }))
    const q = new ScoreQueue(send, clock)
    q.enable()
    q.submit(100)
    await advance(0)
    expect(send).toHaveBeenCalledTimes(1)
    q.submit(200)
    q.submit(150) // lower than pending: dropped
    q.submit(300)
    await advance(SCORE_INTERVAL_MS - 1000)
    expect(send).toHaveBeenCalledTimes(1)
    await advance(1000)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(300)
  })

  it("never resubmits a score that is not higher than one already sent", async () => {
    const { clock, advance } = fakeClock()
    const send = vi.fn(async (n: number) => ({ best: n, accepted: true }))
    const q = new ScoreQueue(send, clock)
    q.enable()
    q.submit(500)
    await advance(0)
    q.submit(500)
    q.submit(400)
    await advance(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("retries after too_soon without losing the score", async () => {
    const { clock, advance } = fakeClock()
    const send = vi.fn().mockRejectedValueOnce(sdkError("too_soon")).mockResolvedValue({ best: 700, accepted: true })
    const q = new ScoreQueue(send, clock)
    const states: SubmissionStatus["state"][] = []
    q.onChange((s) => states.push(s.state))
    q.enable()
    q.submit(700)
    await advance(0)
    expect(send).toHaveBeenCalledTimes(1)
    await advance(SCORE_INTERVAL_MS)
    expect(send).toHaveBeenCalledTimes(2)
    expect(q.current).toMatchObject({ state: "sent", score: 700 })
    expect(states).toContain("queued")
  })

  it("gives up on non-retryable errors and reports failure", async () => {
    const { clock, advance } = fakeClock()
    const q = new ScoreQueue(vi.fn().mockRejectedValue(sdkError("signed_out")), clock)
    q.enable()
    q.submit(10)
    await advance(0)
    expect(q.current).toMatchObject({ state: "failed", code: "signed_out" })
  })

  it("holds scores until connected, and reports local-only when there is no platform", async () => {
    const { clock, advance } = fakeClock()
    const send = vi.fn(async (n: number) => ({ best: n, accepted: true }))
    const q = new ScoreQueue(send, clock)
    q.submit(50)
    expect(q.current).toMatchObject({ state: "waiting", score: 50 })
    q.disableLocal()
    expect(q.current).toMatchObject({ state: "local", score: 50 })
    q.submit(80)
    await advance(60_000)
    expect(send).not.toHaveBeenCalled()
    expect(q.current).toMatchObject({ state: "local", score: 80 })
  })
})

describe("Platform adapter", () => {
  it("waits for a still-loading SDK script before connecting", async () => {
    let ready: (s: VatarSdk) => void = () => {}
    const sdk = fakeSdk()
    const p = new Platform(new Promise<VatarSdk>((ok) => (ready = ok)), () => [])
    const connecting = p.connect()
    expect(p.status.state).toBe("connecting")
    ready(sdk)
    expect((await connecting).state).toBe("connected")
  })

  it("falls back to local mode when the SDK script is missing", async () => {
    const p = new Platform(undefined, () => [{ score: 5, level: 1, date: 1 }])
    const s = await p.connect()
    expect(s.state).toBe("local")
    expect(s.message).toMatch(/Local mode/)
    const lb = await p.leaderboard()
    expect(lb.source).toBe("local")
  })

  it("falls back to local mode when not framed by the host", async () => {
    const sdk = fakeSdk({ init: vi.fn().mockRejectedValue(sdkError("not_framed")) })
    const p = new Platform(sdk, () => [])
    expect((await p.connect()).state).toBe("local")
    p.submitScore(100)
    expect(p.submission).toMatchObject({ state: "local" })
    expect(sdk.submitScore).not.toHaveBeenCalled()
  })

  it("connects, reports the player and sandbox mode, and submits", async () => {
    const { clock, advance } = fakeClock()
    const sdk = fakeSdk()
    const p = new Platform(sdk, () => [], clock)
    const s = await p.connect()
    expect(s).toMatchObject({ state: "connected", mode: "test" })
    expect(p.player?.name).toBe("Tolu")
    p.submitScore(1234.7)
    await advance(0)
    expect(sdk.submitScore).toHaveBeenCalledWith(1234)
  })

  it("caches the leaderboard for 30 seconds and shares concurrent requests", async () => {
    const { clock, advance } = fakeClock()
    const sdk = fakeSdk()
    const p = new Platform(sdk, () => [], clock)
    await p.connect()
    await Promise.all([p.leaderboard(), p.leaderboard()])
    await p.leaderboard()
    expect(sdk.leaderboard).toHaveBeenCalledTimes(1)
    await advance(31_000)
    await p.leaderboard()
    expect(sdk.leaderboard).toHaveBeenCalledTimes(2)
  })

  it("reports leaderboard errors with local scores as a fallback", async () => {
    const sdk = fakeSdk({ leaderboard: vi.fn().mockRejectedValue(sdkError("rate_limited")) })
    const p = new Platform(sdk, () => [{ score: 9, level: 1, date: 1 }])
    await p.connect()
    const lb = await p.leaderboard()
    expect(lb).toMatchObject({ source: "error", code: "rate_limited" })
  })

  it("marks the platform unavailable for signed-out players", async () => {
    const p = new Platform(fakeSdk({ init: vi.fn().mockRejectedValue(sdkError("signed_out")) }), () => [])
    expect(await p.connect()).toMatchObject({ state: "unavailable" })
  })

  it("forwards pause and resume from the host", async () => {
    const sdk = fakeSdk()
    const p = new Platform(Promise.resolve(sdk), () => [])
    await p.connect()
    const paused = vi.fn()
    const resumed = vi.fn()
    p.onPause(paused)
    p.onResume(resumed)
    sdk.pause()
    sdk.resume()
    expect(paused).toHaveBeenCalledOnce()
    expect(resumed).toHaveBeenCalledOnce()
  })
})
