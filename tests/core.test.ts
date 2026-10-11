import { describe, expect, it } from "vitest"
import { COMPOUND_LADDER, LAGOS_CLASSIC, LAYOUTS } from "../src/config/board"
import { LEVELS, STARTING_LIVES, TUTORIAL_LEVEL } from "../src/config/levels"
import { ONE_WAY_RULES, TRADITIONAL_RULES } from "../src/config/rules"
import { buildBoard, cellCenter, getCell, restCenter, startCenter } from "../src/core/board"
import { buildHopPath, judgeTap } from "../src/core/movement"
import { seededRng } from "../src/core/rng"
import { coursePoints, hopPoints, levelCompletePoints, streakMultiplier, throwPoints } from "../src/core/scoring"
import { GameSession } from "../src/core/session"
import { aimFromDrag, judgeThrow, MIN_THROW_DISTANCE, swayOffset } from "../src/core/throw"
import type { Step } from "../src/core/movement"
import type { LevelConfig } from "../src/config/levels"

const board = buildBoard(LAGOS_CLASSIC)

/** A calm level with no randomness so throws land exactly where aimed. */
const calm = (targets: number[], extra: Partial<LevelConfig> = {}): LevelConfig => ({
  ...TUTORIAL_LEVEL,
  level: 1,
  targets,
  hopTime: 3,
  ...extra,
})

function newSession(levels: LevelConfig[], opts: { lives?: number; forgiving?: boolean } = {}) {
  return new GameSession({ board, rules: TRADITIONAL_RULES, levels, lives: opts.lives ?? STARTING_LIVES, rng: seededRng(7), ...opts })
}

/** The centre point a player would tap to perform a step correctly. */
function tapFor(step: Step): { x: number; y: number } {
  switch (step.kind) {
    case "hop": {
      const cells = step.cells.map((id) => getCell(board, id))
      if (step.feet === 2) return cellCenter(board.rows[step.row].rect)
      return cellCenter(cells[0])
    }
    case "pickup":
      return cellCenter(getCell(board, step.cellId))
    case "turn":
      return restCenter(board)
    case "exit":
      return startCenter(board)
  }
}

function throwAt(session: GameSession, id: number) {
  const r = session.throwStone(cellCenter(getCell(board, id)), 0)
  session.completeThrow()
  return r
}

function hopCourse(session: GameSession) {
  let guard = 0
  while (session.state.phase === "hopping" && guard++ < 50) {
    const step = session.currentStep!
    const p = step.kind === "hop" && step.feet === 2 ? cellCenter(getCell(board, step.cells[0])) : tapFor(step)
    const out = session.tap(p)
    expect(out?.result).toBe("ok")
    expect(session.completeMove()).toBe(true)
  }
}

describe("board layouts", () => {
  it("builds every configured layout with unique squares", () => {
    for (const layout of Object.values(LAYOUTS)) {
      const b = buildBoard(layout)
      const ids = layout.rows.flat()
      expect(b.cells.size).toBe(ids.length)
    }
  })

  it("rejects duplicate squares", () => {
    expect(() => buildBoard({ ...LAGOS_CLASSIC, rows: [[1], [1]] })).toThrow()
  })

  it("every campaign target exists on the default board", () => {
    for (const level of LEVELS) for (const t of level.targets) expect(board.cells.has(t)).toBe(true)
  })

  it("has ten levels that get harder", () => {
    expect(LEVELS).toHaveLength(10)
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].scatter).toBeGreaterThanOrEqual(LEVELS[i - 1].scatter)
      expect(LEVELS[i].hopTime!).toBeLessThanOrEqual(LEVELS[i - 1].hopTime!)
      expect(LEVELS[i].targets.length).toBeGreaterThanOrEqual(LEVELS[i - 1].targets.length)
    }
  })
})

describe("throwing", () => {
  it("accepts a centred throw into the target with full accuracy", () => {
    const c = cellCenter(getCell(board, 3))
    const j = judgeThrow(board, c, 3, TRADITIONAL_RULES, 0.06)
    expect(j.ok).toBe(true)
    expect(j.accuracy).toBeCloseTo(1)
    expect(j.grade).toBe("perfect")
  })

  it("rejects the wrong square, the line, the rest area and off-board throws", () => {
    const c3 = cellCenter(getCell(board, 3))
    expect(judgeThrow(board, c3, 2, TRADITIONAL_RULES, 0.06).miss).toBe("wrong-square")
    const cell = getCell(board, 2)
    expect(judgeThrow(board, { x: c3.x, y: cell.y + 0.01 }, 2, TRADITIONAL_RULES, 0.06).miss).toBe("line")
    expect(judgeThrow(board, restCenter(board), 9, TRADITIONAL_RULES, 0.06).miss).toBe("rest-area")
    expect(judgeThrow(board, { x: 5, y: 2 }, 2, TRADITIONAL_RULES, 0.06).miss).toBe("off-board")
  })

  it("ignores tiny or backwards drags", () => {
    expect(aimFromDrag(board, { x: 0, y: MIN_THROW_DISTANCE / 10 })).toBeNull()
    expect(aimFromDrag(board, { x: 0, y: -1 })).toBeNull()
    expect(aimFromDrag(board, { x: 0, y: 1 })).not.toBeNull()
  })

  it("clamps very long drags to the throw range", () => {
    const aim = aimFromDrag(board, { x: 0, y: 100 })!
    expect(aim.y).toBeLessThan(board.bounds.y + board.bounds.h + 1)
  })
})

describe("hop path", () => {
  it("skips the stone's single square on the way out and picks it up on the way back", () => {
    const path = buildHopPath(board, TRADITIONAL_RULES, 3)
    const out = path.filter((s) => s.kind === "hop" && s.leg === "out") as Extract<Step, { kind: "hop" }>[]
    expect(out.map((s) => s.row)).toEqual([0, 1, 3, 4, 5, 6]) // row 2 (square 3) is jumped
    const pickupIndex = path.findIndex((s) => s.kind === "pickup")
    expect(path[pickupIndex - 1]).toMatchObject({ kind: "hop", row: 3, leg: "back" })
    expect(path[pickupIndex + 1]).toMatchObject({ kind: "hop", row: 2, cells: [3], leg: "back" })
    expect(path.at(-1)).toEqual({ kind: "exit" })
  })

  it("lands on one foot in a pair when the stone is in the other square", () => {
    const path = buildHopPath(board, TRADITIONAL_RULES, 4)
    expect(path.find((s) => s.kind === "hop" && s.row === 3)).toMatchObject({ cells: [5], feet: 1 })
    expect(path.find((s) => s.kind === "hop" && s.row === 5)).toMatchObject({ cells: [7, 8], feet: 2 })
  })

  it("follows a one-way rule set", () => {
    const path = buildHopPath(board, ONE_WAY_RULES, 2)
    expect(path.at(-1)).toEqual({ kind: "turn", finish: true })
    expect(path.some((s) => s.kind === "pickup" || s.kind === "exit")).toBe(false)
  })

  it("works on an alternative layout", () => {
    const ladder = buildBoard(COMPOUND_LADDER)
    const path = buildHopPath(ladder, TRADITIONAL_RULES, 3)
    expect(path.find((s) => s.kind === "hop" && s.row === 1)).toMatchObject({ cells: [2], feet: 1 })
  })
})

describe("tap validation", () => {
  const path = buildHopPath(board, TRADITIONAL_RULES, 2)
  const ctx = { board, rules: TRADITIONAL_RULES, step: path[0], position: { at: "start" as const }, markerCellId: 2, markerPicked: false, lineBand: 0.08 }

  it("accepts the expected square", () => {
    expect(judgeTap(ctx, cellCenter(getCell(board, 1))).result).toBe("ok")
  })

  it("faults on the stone's square, a wrong square and a chalk line", () => {
    expect(judgeTap(ctx, cellCenter(getCell(board, 2)))).toMatchObject({ result: "fault", fault: "marker-square" })
    expect(judgeTap(ctx, cellCenter(getCell(board, 6)))).toMatchObject({ result: "fault", fault: "wrong-square" })
    const c1 = getCell(board, 1)
    expect(judgeTap(ctx, { x: c1.x + 0.02, y: c1.y + 0.5 })).toMatchObject({ result: "fault", fault: "line" })
  })

  it("ignores taps on empty ground", () => {
    expect(judgeTap(ctx, { x: 6, y: 3 }).result).toBe("ignored")
  })

  it("does not treat the middle line of a two-footed pair as a fault", () => {
    const pairStep = path.find((s) => s.kind === "hop" && s.feet === 2)!
    const row = board.rows[(pairStep as Extract<Step, { kind: "hop" }>).row].rect
    const middle = { x: row.x + row.w / 2 + 0.01, y: row.y + row.h / 2 }
    expect(judgeTap({ ...ctx, step: pairStep, position: { at: "cells", cells: [3], feet: 1 } }, middle).result).toBe("ok")
  })
})

describe("scoring", () => {
  it("rewards accuracy, level and streak", () => {
    expect(throwPoints(1, 1, 0)).toBe(150)
    expect(throwPoints(0, 1, 0)).toBe(50)
    expect(throwPoints(1, 2, 0)).toBe(165)
    expect(throwPoints(1, 1, 1)).toBe(188)
    expect(streakMultiplier(100)).toBe(2)
    expect(hopPoints(1, 1, 0)).toBe(20)
    expect(hopPoints(0, 1, 0)).toBe(10)
    expect(coursePoints(1, 0)).toBe(100)
    expect(levelCompletePoints(3, 0)).toEqual({ level: 600, flawless: 450 })
    expect(levelCompletePoints(3, 1).flawless).toBe(0)
  })
})

describe("game session", () => {
  it("plays a full clean round and level", () => {
    const s = newSession([calm([2])])
    const j = throwAt(s, 2)
    expect(j?.ok).toBe(true)
    expect(s.state.phase).toBe("hopping")
    const afterThrow = s.state.score
    expect(afterThrow).toBe(150)
    hopCourse(s)
    expect(s.state.phase).toBe("round-complete")
    expect(s.state.score).toBeGreaterThan(afterThrow + 100)
    expect(s.continueAfterRound()).toBe("level-complete")
    expect(s.state.levelSummary).toMatchObject({ level: 1, flawlessBonus: 150, livesLost: 0, campaignComplete: true })
    expect(s.startNextLevel()).toBe(false)
  })

  it("loses a life on a missed throw and retries the same target", () => {
    const s = newSession([calm([5])])
    throwAt(s, 6)
    expect(s.state.phase).toBe("fault")
    expect(s.state.lastFault?.reason).toBe("wrong-square")
    expect(s.state.lives).toBe(2)
    expect(s.acknowledgeFault()).toBe("aiming")
    expect(s.target).toBe(5)
    expect(s.state.marker).toBeNull()
  })

  it("ends the run after three faults", () => {
    const s = newSession([calm([5])])
    for (let i = 0; i < 3; i++) {
      throwAt(s, 1)
      s.acknowledgeFault()
    }
    expect(s.state.lives).toBe(0)
    expect(s.state.phase).toBe("game-over")
    expect(s.throwStone({ x: 0, y: 1 }, 0)).toBeNull()
  })

  it("loses a life when the balance meter runs out", () => {
    const s = newSession([calm([2], { hopTime: 2 })])
    throwAt(s, 2)
    s.tick(1)
    expect(s.state.phase).toBe("hopping")
    s.tick(1.1)
    expect(s.state.phase).toBe("fault")
    expect(s.state.lastFault?.reason).toBe("balance")
    expect(s.state.lives).toBe(2)
  })

  it("does not count the same throw or hop twice", () => {
    const s = newSession([calm([2])])
    s.throwStone(cellCenter(getCell(board, 2)), 0)
    expect(s.throwStone(cellCenter(getCell(board, 2)), 0)).toBeNull()
    s.completeThrow()
    const score = s.state.score
    expect(s.completeThrow()).toBeNull()
    expect(s.state.score).toBe(score)
    s.tap(cellCenter(getCell(board, 1)))
    expect(s.tap(cellCenter(getCell(board, 1)))).toBeNull() // still animating
    const afterHop = s.state.score
    s.completeMove()
    expect(s.completeMove()).toBe(false)
    expect(s.state.score).toBe(afterHop)
  })

  it("progresses through levels and resets per-level counters", () => {
    const s = newSession([calm([1]), calm([3], { level: 2 })])
    throwAt(s, 1)
    hopCourse(s)
    s.continueAfterRound()
    expect(s.startNextLevel()).toBe(true)
    expect(s.state.levelIndex).toBe(1)
    expect(s.target).toBe(3)
    expect(s.state.levelScore).toBe(0)
  })

  it("never loses lives in forgiving (tutorial) mode", () => {
    const s = newSession([calm([2])], { forgiving: true })
    throwAt(s, 6)
    expect(s.state.lastFault?.lifeLost).toBe(false)
    expect(s.state.lives).toBe(STARTING_LIVES)
  })

  it("rejects a level that targets a square the board does not have", () => {
    expect(() => newSession([calm([42])])).toThrow()
  })

  it("can be played through all ten campaign levels with correct play", () => {
    const s = new GameSession({ board, rules: TRADITIONAL_RULES, levels: LEVELS, lives: STARTING_LIVES, rng: seededRng(99) })
    let lastScore = 0
    for (let level = 1; level <= 10; level++) {
      expect(s.level.level).toBe(level)
      for (let round = 0; round < LEVELS[level - 1].targets.length; round++) {
        // A skilled player compensates for the visible wind and sway.
        const c = cellCenter(getCell(board, s.target))
        const sway = swayOffset(s.level, 0)
        const aim = { x: c.x - s.state.wind.x - sway.x, y: c.y - s.state.wind.y - sway.y }
        expect(s.throwStone(aim, 0)?.ok).toBe(true)
        s.completeThrow()
        hopCourse(s)
        expect(s.state.phase).toBe("round-complete")
        s.continueAfterRound()
      }
      expect(s.state.phase).toBe("level-complete")
      expect(s.state.score).toBeGreaterThan(lastScore)
      lastScore = s.state.score
      if (level < 10) expect(s.startNextLevel()).toBe(true)
    }
    expect(s.state.levelSummary?.campaignComplete).toBe(true)
    expect(s.state.lives).toBe(STARTING_LIVES)
  })
})
