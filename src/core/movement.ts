import type { SuweRules } from "../config/rules"
import { type Board, type Vec, cellAt, distanceToEdge, getCell, inRest, inStart } from "./board"

export type Leg = "out" | "back"

export type Step =
  /** Land in a row. `cells` are the squares the player may land in; `feet` is how many feet touch down. */
  | { kind: "hop"; row: number; cells: number[]; feet: 1 | 2; leg: Leg }
  /** Land in the rest area and turn round (or finish, on a one-way run). */
  | { kind: "turn"; finish: boolean }
  /** Bend down and pick the stone up from the next square without stepping in it. */
  | { kind: "pickup"; cellId: number }
  /** Hop back out over the throw line. */
  | { kind: "exit" }

/** Where the player is standing. */
export type Position = { at: "start" } | { at: "cells"; cells: number[]; feet: 1 | 2 } | { at: "rest" }

export type HopFault = "line" | "marker-square" | "wrong-square" | "balance"

export type TapOutcome =
  | { result: "ok"; step: Step; landing: Vec }
  | { result: "ignored"; hint: string }
  | { result: "fault"; fault: HopFault; landing: Vec; cellId: number | null }

function rowStep(board: Board, rules: SuweRules, row: number, blocked: number | null, leg: Leg): Step | null {
  const all = board.rows[row].cellIds
  const cells = blocked === null ? all : all.filter((id) => id !== blocked)
  if (cells.length === 0) return null // the whole row is the stone's square: hop over it
  const feet: 1 | 2 = rules.pairsNeedBothFeet && cells.length >= 2 ? 2 : 1
  return { kind: "hop", row, cells, feet, leg }
}

/**
 * The full sequence of moves for one round, given where the stone lies. This is where regional
 * rule variations are applied, so the session and UI just walk the list.
 */
export function buildHopPath(board: Board, rules: SuweRules, markerCellId: number): Step[] {
  const marker = getCell(board, markerCellId)
  const blocked = rules.skipMarkerSquare ? markerCellId : null
  const steps: Step[] = []

  for (let r = 0; r < board.rows.length; r++) {
    const step = rowStep(board, rules, r, blocked, "out")
    if (step) steps.push(step)
  }

  if (!rules.roundTrip) {
    if (board.rest) steps.push({ kind: "turn", finish: true })
    return steps
  }

  if (board.rest) steps.push({ kind: "turn", finish: false })

  for (let r = board.rows.length - 1; r >= 0; r--) {
    let rowBlocked = blocked
    if (r === marker.row && rules.pickUpOnReturn) {
      steps.push({ kind: "pickup", cellId: markerCellId })
      if (rules.landInMarkerSquareAfterPickup) rowBlocked = null
    }
    const step = rowStep(board, rules, r, rowBlocked, "back")
    if (step) steps.push(step)
  }
  steps.push({ kind: "exit" })
  return steps
}

/** Where the player ends up after completing a step. */
export function positionAfter(step: Step, previous: Position): Position {
  switch (step.kind) {
    case "hop":
      return { at: "cells", cells: step.cells, feet: step.feet }
    case "turn":
      return { at: "rest" }
    case "pickup":
      return previous
    case "exit":
      return { at: "start" }
  }
}

export interface TapContext {
  board: Board
  rules: SuweRules
  step: Step
  position: Position
  markerCellId: number
  markerPicked: boolean
  lineBand: number
}

/**
 * Validate a tap on the board against the expected next move. Taps on empty ground or on the
 * square the player already stands in are ignored (with a hint) rather than punished; landing in
 * the wrong square, on the stone's square or on a chalk line is a fault, as in the playground.
 */
export function judgeTap(ctx: TapContext, p: Vec): TapOutcome {
  const { board, rules, step, position } = ctx
  const cell = cellAt(board, p)
  const standingOn = position.at === "cells" ? position.cells : []
  const fault = (f: HopFault): TapOutcome => ({ result: "fault", fault: f, landing: p, cellId: cell?.id ?? null })

  if (step.kind === "pickup") {
    if (cell && cell.id === step.cellId) return { result: "ok", step, landing: p }
    return { result: "ignored", hint: "Tap your stone to pick it up" }
  }

  if (cell && standingOn.includes(cell.id)) return { result: "ignored", hint: "You're already standing there" }

  if (step.kind === "turn") {
    if (inRest(board, p)) return { result: "ok", step, landing: p }
    if (cell) return fault(!ctx.markerPicked && cell.id === ctx.markerCellId ? "marker-square" : "wrong-square")
    return { result: "ignored", hint: "Hop into the rest area" }
  }

  if (step.kind === "exit") {
    if (inStart(board, p)) return { result: "ok", step, landing: p }
    if (cell || inRest(board, p)) return fault("wrong-square")
    return { result: "ignored", hint: "Hop out behind the line" }
  }

  // step.kind === "hop"
  if (!cell) {
    if (inRest(board, p)) return fault("wrong-square")
    return { result: "ignored", hint: "Tap the next square to hop" }
  }
  if (!ctx.markerPicked && rules.skipMarkerSquare && cell.id === ctx.markerCellId) return fault("marker-square")
  if (!step.cells.includes(cell.id)) return fault("wrong-square")
  if (rules.linesAreFaults) {
    // Two feet straddle the middle line of a pair, so only the pair's outer edges count.
    const area = step.feet === 2 ? board.rows[step.row].rect : cell
    if (distanceToEdge(p, area) < ctx.lineBand) return fault("line")
  }
  return { result: "ok", step, landing: p }
}
