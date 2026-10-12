// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { MAX_LOCAL_SCORES, storage } from "../src/storage/storage"

describe("local persistence", () => {
  beforeEach(() => localStorage.clear())

  it("keeps only a higher personal best", () => {
    expect(storage.getBest()).toBe(0)
    expect(storage.recordBest(500)).toBe(true)
    expect(storage.recordBest(300)).toBe(false)
    expect(storage.getBest()).toBe(500)
    expect(localStorage.getItem("suwe.v1.best")).toBe("500")
  })

  it("keeps the top local scores, highest first", () => {
    for (let i = 1; i <= MAX_LOCAL_SCORES + 3; i++) storage.addLocalScore({ score: i * 10, level: 1, date: i })
    const list = storage.getLocalScores()
    expect(list).toHaveLength(MAX_LOCAL_SCORES)
    expect(list[0].score).toBe((MAX_LOCAL_SCORES + 3) * 10)
    storage.addLocalScore({ score: 0, level: 1, date: 1 })
    expect(storage.getLocalScores()).toHaveLength(MAX_LOCAL_SCORES)
  })

  it("ignores corrupted stored data", () => {
    localStorage.setItem("suwe.v1.best", "not json")
    localStorage.setItem("suwe.v1.scores", JSON.stringify([{ score: "x" }]))
    localStorage.setItem("suwe.v1.settings", "{}")
    expect(storage.getBest()).toBe(0)
    expect(storage.getLocalScores()).toEqual([])
    expect(storage.getSettings()).toEqual({ muted: false, tutorialDone: false, chalk: "classic" })
  })

  it("persists settings", () => {
    storage.updateSettings({ muted: true })
    expect(storage.getSettings()).toEqual({ muted: true, tutorialDone: false, chalk: "classic" })
    storage.updateSettings({ tutorialDone: true, chalk: "lagoon" })
    expect(storage.getSettings()).toEqual({ muted: true, tutorialDone: true, chalk: "lagoon" })
  })

  it("upgrades settings saved before chalk colours existed", () => {
    localStorage.setItem("suwe.v1.settings", JSON.stringify({ muted: true, tutorialDone: true }))
    expect(storage.getSettings()).toEqual({ muted: true, tutorialDone: true, chalk: "classic" })
  })

  it("caches server-confirmed ownership per player and ignores corrupt data", () => {
    expect(storage.getCachedOwned("test:t_1")).toEqual([])
    storage.setCachedOwned("test:t_1", ["chalk_pack"])
    expect(storage.getCachedOwned("test:t_1")).toEqual(["chalk_pack"])
    expect(storage.getCachedOwned("test:t_2")).toEqual([])
    localStorage.setItem("suwe.v1.owned", JSON.stringify({ "test:t_1": "yes" }))
    expect(storage.getCachedOwned("test:t_1")).toEqual([])
  })

  it("tracks the highest level reached", () => {
    storage.recordLevelReached(3)
    storage.recordLevelReached(2)
    expect(storage.getBestLevel()).toBe(3)
  })
})
