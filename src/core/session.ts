import type { LevelConfig } from "../config/levels"
import type { SuweRules } from "../config/rules"
import { type Board, type Vec, getCell } from "./board"
import { type HopFault, type Position, type Step, buildHopPath, judgeTap, positionAfter } from "./movement"
import type { Rng } from "./rng"
import { coursePoints, hopPoints, levelCompletePoints, starsFor, throwPoints } from "./scoring"
import { type ThrowJudgement, type ThrowMiss, judgeThrow, resolveLanding, rollWind, swayOffset } from "./throw"

/**
 *  aiming ──throw──▶ throwing ──completeThrow──▶ hopping ⇄ moving ──(last step)──▶ round-complete
 *     ▲                  │ miss                    │ fault                              │
 *     └──acknowledgeFault── fault ◀────────────────┘                    continueAfterRound
 *                         │ no lives left                                    │        │
 *                         ▼                                                  ▼        ▼
 *                     game-over                                      aiming (next)  level-complete
 *
 * Every transition checks the current phase first, so duplicate taps, a double-fired animation
 * callback or a late timer can never award points twice or skip a state.
 */
export type Phase = "aiming" | "throwing" | "hopping" | "moving" | "fault" | "round-complete" | "level-complete" | "game-over"

export type FaultReason = ThrowMiss | HopFault

export interface Fault {
  reason: FaultReason
  at: Vec | null
  lifeLost: boolean
}

export interface Award {
  points: number
  label: string
  at: Vec
}

export interface MarkerState {
  pos: Vec
  cellId: number | null
  picked: boolean
}

export interface LevelSummary {
  level: number
  name: string
  roundsScore: number
  levelBonus: number
  flawlessBonus: number
  total: number
  livesLost: number
  averageAccuracy: number
  stars: 1 | 2 | 3
  campaignComplete: boolean
}

export interface SessionOptions {
  board: Board
  rules: SuweRules
  levels: LevelConfig[]
  lives: number
  rng: Rng
  startLevelIndex?: number
  /** Tutorial: faults never cost a life. */
  forgiving?: boolean
}

export interface SessionState {
  phase: Phase
  levelIndex: number
  roundIndex: number
  lives: number
  score: number
  levelScore: number
  livesLostThisLevel: number
  cleanStreak: number
  wind: Vec
  marker: MarkerState | null
  path: Step[]
  stepIndex: number
  position: Position
  /** Where the player's feet last touched down (for drawing). */
  landing: Vec | null
  balance: number
  balanceMax: number | null
  lastThrow: ThrowJudgement | null
  lastFault: Fault | null
  lastAwards: Award[]
  levelSummary: LevelSummary | null
  levelAccuracies: number[]
  roundsCompleted: number
}

export class GameSession {
  readonly board: Board
  readonly rules: SuweRules
  readonly levels: LevelConfig[]
  private readonly rng: Rng
  private readonly forgiving: boolean
  private s: SessionState

  constructor(opts: SessionOptions) {
    if (opts.levels.length === 0) throw new Error("A session needs at least one level")
    for (const level of opts.levels) for (const t of level.targets) getCell(opts.board, t) // validates config
    this.board = opts.board
    this.rules = opts.rules
    this.levels = opts.levels
    this.rng = opts.rng
    this.forgiving = !!opts.forgiving
    const levelIndex = Math.min(Math.max(0, opts.startLevelIndex ?? 0), opts.levels.length - 1)
    this.s = {
      phase: "aiming",
      levelIndex,
      roundIndex: 0,
      lives: opts.lives,
      score: 0,
      levelScore: 0,
      livesLostThisLevel: 0,
      cleanStreak: 0,
      wind: { x: 0, y: 0 },
      marker: null,
      path: [],
      stepIndex: 0,
      position: { at: "start" },
      landing: null,
      balance: 0,
      balanceMax: null,
      lastThrow: null,
      lastFault: null,
      lastAwards: [],
      levelSummary: null,
      levelAccuracies: [],
      roundsCompleted: 0,
    }
    this.beginRound(true)
  }

  get state(): Readonly<SessionState> {
    return this.s
  }

  get level(): LevelConfig {
    return this.levels[this.s.levelIndex]
  }

  get target(): number {
    return this.level.targets[this.s.roundIndex]
  }

  get currentStep(): Step | null {
    return this.s.path[this.s.stepIndex] ?? null
  }

  get isLastLevel(): boolean {
    return this.s.levelIndex === this.levels.length - 1
  }

  /** Release the stone. `aim` is the aimed world point, `t` the sway clock in seconds. */
  throwStone(aim: Vec, t: number): ThrowJudgement | null {
    if (this.s.phase !== "aiming") return null
    const level = this.level
    const landing = resolveLanding(aim, swayOffset(level, t), this.s.wind, level.scatter, this.rng)
    const judgement = judgeThrow(this.board, landing, this.target, this.rules, level.lineBand)
    this.s.lastThrow = judgement
    this.s.lastAwards = []
    this.s.phase = "throwing"
    return judgement
  }

  /** Called when the stone's flight animation ends. Applies the throw result. */
  completeThrow(): ThrowJudgement | null {
    if (this.s.phase !== "throwing" || !this.s.lastThrow) return null
    const j = this.s.lastThrow
    this.s.marker = { pos: j.landing, cellId: j.cellId, picked: false }
    if (!j.ok || j.cellId === null) {
      this.fault(j.miss ?? "off-board", j.landing)
      return j
    }
    const points = throwPoints(j.accuracy, this.level.level, this.s.cleanStreak)
    this.addPoints(points, j.grade === "perfect" ? "Perfect throw!" : j.grade === "great" ? "Great throw!" : "Good throw", j.landing)
    this.s.levelAccuracies.push(j.accuracy)
    this.s.path = buildHopPath(this.board, this.rules, j.cellId)
    this.s.stepIndex = 0
    this.s.position = { at: "start" }
    this.s.phase = "hopping"
    this.resetBalance()
    return j
  }

  /** A tap or click on the board while hopping. */
  tap(p: Vec): ReturnType<typeof judgeTap> | null {
    if (this.s.phase !== "hopping") return null
    const step = this.currentStep
    const marker = this.s.marker
    if (!step || !marker || marker.cellId === null) return null
    const outcome = judgeTap(
      {
        board: this.board,
        rules: this.rules,
        step,
        position: this.s.position,
        markerCellId: marker.cellId,
        markerPicked: marker.picked,
        lineBand: this.level.lineBand,
      },
      p,
    )
    if (outcome.result === "fault") {
      this.fault(outcome.fault, outcome.landing)
    } else if (outcome.result === "ok") {
      const balanceLeft = this.s.balanceMax ? this.s.balance / this.s.balanceMax : 0
      this.s.lastAwards = []
      this.addPoints(hopPoints(balanceLeft, this.level.level, this.s.cleanStreak), step.kind === "pickup" ? "Picked up!" : "", outcome.landing)
      this.s.landing = step.kind === "pickup" ? this.s.landing : outcome.landing
      this.s.phase = "moving"
    }
    return outcome
  }

  /** Called when the hop animation ends. Advances to the next step or finishes the round. */
  completeMove(): boolean {
    if (this.s.phase !== "moving") return false
    const step = this.currentStep
    if (!step) return false
    this.s.position = positionAfter(step, this.s.position)
    if (step.kind === "pickup" && this.s.marker) this.s.marker = { ...this.s.marker, picked: true }
    this.s.stepIndex++
    if (this.s.stepIndex >= this.s.path.length) {
      this.s.lastAwards = []
      this.addPoints(coursePoints(this.level.level, this.s.cleanStreak), "Course complete!", this.s.landing ?? this.board.throwOrigin)
      this.s.cleanStreak++
      this.s.roundsCompleted++
      this.s.phase = "round-complete"
    } else {
      this.s.phase = "hopping"
      this.resetBalance()
    }
    return true
  }

  /** Advance the balance meter. Only drains while waiting for a hop. */
  tick(dt: number): void {
    if (this.s.phase !== "hopping" || this.s.balanceMax === null) return
    this.s.balance = Math.max(0, this.s.balance - dt)
    if (this.s.balance <= 0) this.fault("balance", this.s.landing)
  }

  /** After the fault feedback: retry the same round, or end the run. */
  acknowledgeFault(): Phase | null {
    if (this.s.phase !== "fault") return null
    if (this.s.lives <= 0) {
      this.s.phase = "game-over"
    } else {
      this.beginRound(false)
    }
    return this.s.phase
  }

  /** After the round celebration: next round, or the level summary. */
  continueAfterRound(): Phase | null {
    if (this.s.phase !== "round-complete") return null
    if (this.s.roundIndex < this.level.targets.length - 1) {
      this.s.roundIndex++
      this.beginRound(true)
      return this.s.phase
    }
    const level = this.level
    const bonus = levelCompletePoints(level.level, this.s.livesLostThisLevel)
    const roundsScore = this.s.levelScore
    this.s.score += bonus.level + bonus.flawless
    this.s.levelScore += bonus.level + bonus.flawless
    const acc = this.s.levelAccuracies
    const averageAccuracy = acc.length ? acc.reduce((a, b) => a + b, 0) / acc.length : 0
    this.s.levelSummary = {
      level: level.level,
      name: level.name,
      roundsScore,
      levelBonus: bonus.level,
      flawlessBonus: bonus.flawless,
      total: this.s.levelScore,
      livesLost: this.s.livesLostThisLevel,
      averageAccuracy,
      stars: starsFor(this.s.livesLostThisLevel, averageAccuracy),
      campaignComplete: this.isLastLevel,
    }
    this.s.phase = "level-complete"
    return this.s.phase
  }

  /** From the level-complete screen. Returns false when there is no next level. */
  startNextLevel(): boolean {
    if (this.s.phase !== "level-complete" || this.isLastLevel) return false
    this.s.levelIndex++
    this.s.roundIndex = 0
    this.s.levelScore = 0
    this.s.livesLostThisLevel = 0
    this.s.levelAccuracies = []
    this.s.levelSummary = null
    this.beginRound(true)
    return true
  }

  private beginRound(newWind: boolean): void {
    if (newWind) this.s.wind = rollWind(this.level, this.rng)
    this.s.phase = "aiming"
    this.s.marker = null
    this.s.path = []
    this.s.stepIndex = 0
    this.s.position = { at: "start" }
    this.s.landing = null
    this.s.lastThrow = null
    this.s.lastFault = null
    this.s.balanceMax = null
    this.s.balance = 0
  }

  private resetBalance(): void {
    const t = this.level.hopTime
    this.s.balanceMax = t
    this.s.balance = t ?? 0
  }

  private fault(reason: FaultReason, at: Vec | null): void {
    const lifeLost = !this.forgiving
    if (lifeLost) {
      this.s.lives = Math.max(0, this.s.lives - 1)
      this.s.livesLostThisLevel++
    }
    this.s.cleanStreak = 0
    this.s.lastFault = { reason, at, lifeLost }
    this.s.phase = "fault"
  }

  private addPoints(points: number, label: string, at: Vec): void {
    this.s.score += points
    this.s.levelScore += points
    this.s.lastAwards.push({ points, label, at })
  }
}

export const FAULT_MESSAGES: Record<FaultReason, string> = {
  line: "On the line!",
  "wrong-square": "Wrong square!",
  "rest-area": "Too far — that's the rest area",
  "off-board": "Off the board!",
  "marker-square": "You stepped on the stone's square!",
  balance: "You lost your balance!",
}
