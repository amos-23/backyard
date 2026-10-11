import type { LevelConfig } from "../config/levels"
import type { SuweRules } from "../config/rules"
import { type Board, type Vec, cellAt, cellCenter, distanceToEdge, getCell, inRest } from "./board"
import type { Rng } from "./rng"

/** How far (world units) one unit of drag moves the aim point. */
export const AIM_GAIN = 2.4
/** Throws shorter than this are treated as an accidental tap and cancelled. */
export const MIN_THROW_DISTANCE = 0.35
/** Radius of the stone marker in world units. */
export const MARKER_RADIUS = 0.11

export type ThrowGrade = "perfect" | "great" | "good"
export type ThrowMiss = "line" | "wrong-square" | "rest-area" | "off-board"

export interface ThrowJudgement {
  ok: boolean
  landing: Vec
  /** Square the stone came to rest in, if any. */
  cellId: number | null
  /** 0..1, how close to the centre of the target square (1 = dead centre). 0 on a miss. */
  accuracy: number
  grade: ThrowGrade | null
  miss: ThrowMiss | null
}

/** The maximum distance from the throw origin the stone can travel. */
export function maxThrowRange(board: Board): number {
  const top = board.bounds.y + board.bounds.h
  return top - board.throwOrigin.y + 0.4
}

/**
 * Turn a drag gesture (in world units, +y = forward) into an aim point, clamped to the throw range.
 * Returns null when the gesture is too short to be a deliberate throw.
 */
export function aimFromDrag(board: Board, drag: Vec): Vec | null {
  let dx = drag.x * AIM_GAIN
  let dy = drag.y * AIM_GAIN
  const len = Math.hypot(dx, dy)
  if (len < MIN_THROW_DISTANCE || dy <= 0) return null
  const max = maxThrowRange(board)
  if (len > max) {
    dx = (dx / len) * max
    dy = (dy / len) * max
  }
  return { x: board.throwOrigin.x + dx, y: board.throwOrigin.y + dy }
}

/** The visible sway offset at time t (seconds). Deterministic so the player can read and time it. */
export function swayOffset(level: LevelConfig, t: number): Vec {
  if (level.sway <= 0) return { x: 0, y: 0 }
  const w = Math.PI * 2 * level.swaySpeed
  return { x: Math.sin(t * w) * level.sway, y: Math.sin(t * w * 0.73 + 1.3) * level.sway * 0.6 }
}

/** Where the stone actually lands: the aimed point plus sway, wind and a small random scatter. */
export function resolveLanding(aim: Vec, sway: Vec, wind: Vec, scatter: number, rng: Rng): Vec {
  const angle = rng() * Math.PI * 2
  const radius = Math.sqrt(rng()) * scatter
  return {
    x: aim.x + sway.x + wind.x + Math.cos(angle) * radius,
    y: aim.y + sway.y + wind.y + Math.sin(angle) * radius,
  }
}

export function gradeFor(accuracy: number): ThrowGrade {
  if (accuracy >= 0.75) return "perfect"
  if (accuracy >= 0.45) return "great"
  return "good"
}

/** Decide whether a landing point counts as a valid throw into the target square. */
export function judgeThrow(board: Board, landing: Vec, targetId: number, rules: SuweRules, lineBand: number): ThrowJudgement {
  const cell = cellAt(board, landing)
  const miss = (reason: ThrowMiss, cellId: number | null = null): ThrowJudgement => ({
    ok: false,
    landing,
    cellId,
    accuracy: 0,
    grade: null,
    miss: reason,
  })

  if (!cell) return miss(inRest(board, landing) ? "rest-area" : "off-board")
  // The stone has a size: it touches the line when its edge reaches the chalk band.
  if (rules.linesAreFaults && distanceToEdge(landing, cell) < lineBand + MARKER_RADIUS * 0.5) return miss("line", cell.id)
  if (cell.id !== targetId) return miss("wrong-square", cell.id)

  const target = getCell(board, targetId)
  const c = cellCenter(target)
  const maxDist = Math.hypot(target.w / 2, target.h / 2)
  const accuracy = Math.max(0, Math.min(1, 1 - Math.hypot(landing.x - c.x, landing.y - c.y) / maxDist))
  return { ok: true, landing, cellId: cell.id, accuracy, grade: gradeFor(accuracy), miss: null }
}

/** Random wind for a round, scaled by the level's wind strength. Mostly sideways, a little along the board. */
export function rollWind(level: LevelConfig, rng: Rng): Vec {
  if (level.wind <= 0) return { x: 0, y: 0 }
  const strength = level.wind * (0.5 + rng() * 0.5)
  const sign = rng() < 0.5 ? -1 : 1
  return { x: strength * sign, y: (rng() - 0.5) * level.wind * 0.5 }
}
