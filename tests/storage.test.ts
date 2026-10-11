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
    expect(storage.getSettings()).toEqual({ muted: false, tutorialDone: false })
  })

  it("persists settings", () => {
    storage.updateSettings({ muted: true })
    expect(storage.getSettings()).toEqual({ muted: true, tutorialDone: false })
    storage.updateSettings({ tutorialDone: true })
    expect(storage.getSettings()).toEqual({ muted: true, tutorialDone: true })
  })

  it("tracks the highest level reached", () => {
    storage.recordLevelReached(3)
    storage.recordLevelReached(2)
    expect(storage.getBestLevel()).toBe(3)
  })
})
