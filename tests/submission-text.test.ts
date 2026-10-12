import { describe, expect, it } from "vitest"
import type { PlatformStatus } from "../src/platform/platform"
import { submissionText } from "../src/ui/screens"

const sandbox: PlatformStatus = { state: "connected", mode: "test", message: null }
const local: PlatformStatus = { state: "local", mode: null, message: "Local mode" }

describe("score submission wording", () => {
  it("only says 'posted' once the SDK confirms an accepted score", () => {
    expect(submissionText({ state: "sent", score: 900, best: 900, accepted: true }, sandbox).text).toMatch(/^Sandbox: Posted 900/)
    for (const s of [
      { state: "queued", score: 900, sendAt: 0 },
      { state: "sending", score: 900 },
      { state: "waiting", score: 900 },
      { state: "failed", score: 900, code: "too_soon" },
      { state: "local", score: 900 },
    ] as const) {
      expect(submissionText(s, sandbox).text).not.toMatch(/posted/i)
    }
  })

  it("says a non-best score was received, not that the leaderboard changed", () => {
    const t = submissionText({ state: "sent", score: 400, best: 900, accepted: false }, sandbox).text
    expect(t).toMatch(/received/)
    expect(t).not.toMatch(/updated|posted/i)
  })

  it("is explicit that local scores never reach the live leaderboard", () => {
    expect(submissionText({ state: "idle" }, local).text).toMatch(/not on the live leaderboard/)
    expect(submissionText({ state: "local", score: 5 }, local).text).toMatch(/not on the live leaderboard/)
  })

  it("reports failures with the SDK error code", () => {
    expect(submissionText({ state: "failed", score: 5, code: "rate_limited" }, sandbox)).toMatchObject({ tone: "warn", text: expect.stringMatching(/rate limited/) })
  })
})
