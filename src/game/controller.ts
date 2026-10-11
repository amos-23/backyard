import type { Sound } from "../audio/sound"
import type { LevelConfig } from "../config/levels"
import type { SuweRules } from "../config/rules"
import { type Board, type Vec, cellCenter, getCell, restCenter, startCenter } from "../core/board"
import { type Position, type Step, positionAfter } from "../core/movement"
import type { Rng } from "../core/rng"
import { FAULT_MESSAGES, GameSession, type LevelSummary } from "../core/session"
import { MARKER_RADIUS, aimFromDrag, judgeThrow, swayOffset } from "../core/throw"
import { Effects } from "../render/effects"
import { renderStaticLayer } from "../render/ground"
import { PALETTE } from "../render/palette"
import { type CharacterPose, drawCharacter, drawStone } from "../render/sprites"
import { Viewport } from "../render/viewport"

export interface HudState {
  level: number
  levelName: string
  round: number
  rounds: number
  score: number
  lives: number
  maxLives: number
  target: number
  wind: Vec
  /** 0..1 balance remaining, or null when there's no time pressure right now. */
  balance: number | null
  streak: number
  forgiving: boolean
}

export interface Banner {
  title: string
  subtitle?: string
  tone: "good" | "bad" | "info"
}

export interface ControllerCallbacks {
  hud(h: HudState): void
  banner(b: Banner | null): void
  coach(text: string): void
  levelComplete(summary: LevelSummary): void
  gameOver(finalScore: number, levelReached: number): void
}

export interface ControllerOptions {
  board: Board
  rules: SuweRules
  levels: LevelConfig[]
  lives: number
  rng: Rng
  sound: Sound
  forgiving?: boolean
  insetTop: number
  insetBottom: number
}

interface WorldPose {
  body: Vec
  feet: Vec[]
}

interface Timer {
  at: number
  fn: () => void
}

const FAULT_PAUSE = 1.5
const ROUND_PAUSE = 1.35
const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Drives one run: turns pointer input into session actions, animates the results and draws the
 * board. Game rules live in GameSession; this class only decides *when* to call it and how to show it.
 */
export class GameController {
  readonly session: GameSession
  private readonly ctx: CanvasRenderingContext2D
  private readonly vp = new Viewport()
  private readonly effects = new Effects()
  private staticLayer: HTMLCanvasElement | null = null
  private dpr = 1
  private raf = 0
  private lastFrame = 0
  private time = 0
  private pausedValue = false
  private destroyed = false
  private timers: Timer[] = []
  private resizeObserver: ResizeObserver | null = null

  // Interaction and animation state.
  private drag: { id: number; start: Vec; current: Vec } | null = null
  private flight: { from: Vec; to: Vec; start: number; dur: number } | null = null
  private hop: { from: WorldPose; to: WorldPose; start: number; dur: number; pickup: boolean } | null = null
  private pose: WorldPose
  private facing: 1 | -1 = 1
  private shake = 0
  private hurt = 0
  private awaiting = false // a scheduled transition (fault / round end) is pending
  private lastTick = -1
  private lastHudKey = ""

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: ControllerOptions,
    private readonly cb: ControllerCallbacks,
  ) {
    this.ctx = canvas.getContext("2d")!
    this.session = new GameSession({
      board: opts.board,
      rules: opts.rules,
      levels: opts.levels,
      lives: opts.lives,
      rng: opts.rng,
      forgiving: opts.forgiving,
    })
    this.pose = this.restingPose({ at: "start" })
    canvas.addEventListener("pointerdown", this.onPointerDown)
    canvas.addEventListener("pointermove", this.onPointerMove)
    canvas.addEventListener("pointerup", this.onPointerUp)
    canvas.addEventListener("pointercancel", this.onPointerCancel)
    canvas.addEventListener("contextmenu", preventDefault)
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(canvas)
    }
    this.resize()
    // The chalk numbers use a bundled web font; redraw the board once it is ready.
    document.fonts?.load('400 40px "Gochi Hand"').then(() => !this.destroyed && this.resize(), () => {})
    this.announceRound()
    this.raf = requestAnimationFrame(this.frame)
  }

  get paused(): boolean {
    return this.pausedValue
  }

  pause(): void {
    if (this.pausedValue || this.destroyed) return
    this.pausedValue = true
    this.drag = null
    this.opts.sound.pause()
  }

  resume(): void {
    if (!this.pausedValue || this.destroyed) return
    this.pausedValue = false
    this.lastFrame = performance.now()
    this.opts.sound.resume()
  }

  /** From the level-complete screen. */
  nextLevel(): boolean {
    if (!this.session.startNextLevel()) return false
    this.resetForRound()
    this.announceRound()
    return true
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver?.disconnect()
    this.canvas.removeEventListener("pointerdown", this.onPointerDown)
    this.canvas.removeEventListener("pointermove", this.onPointerMove)
    this.canvas.removeEventListener("pointerup", this.onPointerUp)
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel)
    this.canvas.removeEventListener("contextmenu", preventDefault)
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.canvas.width = Math.round(rect.width * this.dpr)
    this.canvas.height = Math.round(rect.height * this.dpr)
    this.vp.fit(this.opts.board, rect.width, rect.height, this.opts.insetTop, this.opts.insetBottom)
    this.staticLayer = renderStaticLayer(this.opts.board, this.vp, this.dpr)
  }

  /**
   * Read-only geometry for automated browser tests (exposed only with ?debug). Points are CSS pixels
   * relative to the canvas. It cannot change game state; tests still play through real pointer input.
   */
  debugInfo() {
    const board = this.opts.board
    const s = this.session.state
    const pt = (p: Vec) => this.vp.toScreen(p)
    return {
      phase: s.phase,
      target: this.session.target,
      step: this.session.currentStep,
      lives: s.lives,
      score: s.score,
      level: this.session.level.level,
      scale: this.vp.scale,
      origin: pt(board.throwOrigin),
      cells: Object.fromEntries([...board.cells.values()].map((c) => [c.id, pt(cellCenter(c))])),
      rest: pt(restCenter(board)),
      start: pt(startCenter(board)),
      marker: s.marker ? pt(s.marker.pos) : null,
      wind: s.wind,
    }
  }

  // ---------------------------------------------------------------- input

  private pointerWorld(e: PointerEvent): Vec {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary || this.pausedValue) return
    e.preventDefault()
    this.opts.sound.unlock()
    const screen = this.pointerWorld(e)
    const phase = this.session.state.phase
    if (phase === "aiming" && !this.awaiting) {
      this.drag = { id: e.pointerId, start: screen, current: screen }
      try {
        this.canvas.setPointerCapture(e.pointerId)
      } catch {
        /* not supported: moves still arrive while over the canvas */
      }
    } else if (phase === "hopping") {
      this.handleTap(this.vp.toWorld(screen))
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return
    e.preventDefault()
    this.drag.current = this.pointerWorld(e)
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return
    e.preventDefault()
    this.drag.current = this.pointerWorld(e)
    const aim = this.currentAim()
    this.drag = null
    if (!aim) {
      this.cb.coach("Swipe upwards toward the square to throw")
      return
    }
    this.throwAt(aim)
  }

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.id) this.drag = null
  }

  private currentAim(): Vec | null {
    if (!this.drag) return null
    const d = this.vp.dragToWorld(this.drag.current.x - this.drag.start.x, this.drag.current.y - this.drag.start.y)
    return aimFromDrag(this.opts.board, d)
  }

  // ---------------------------------------------------------------- actions

  private throwAt(aim: Vec): void {
    const j = this.session.throwStone(aim, this.time)
    if (!j) return
    this.opts.sound.play("throw")
    const from = this.opts.board.throwOrigin
    const dist = Math.hypot(j.landing.x - from.x, j.landing.y - from.y)
    this.flight = { from, to: j.landing, start: this.time, dur: 0.42 + dist * 0.045 }
    this.cb.coach("")
  }

  private finishFlight(): void {
    this.flight = null
    const j = this.session.completeThrow()
    if (!j) return
    const at = this.vp.toScreen(j.landing)
    this.effects.dust(at, 16)
    this.opts.sound.play("land")
    if (j.ok) {
      this.opts.sound.play("success")
      const award = this.session.state.lastAwards[0]
      if (award) this.effects.text(`+${award.points} ${award.label}`, { x: at.x, y: at.y - 18 }, j.grade === "perfect" ? PALETTE.target : "#fff", 19)
      if (j.grade === "perfect") this.effects.confetti(at, reducedMotion ? 8 : 18)
      this.updateCoach()
    } else {
      this.handleFault()
    }
  }

  private handleTap(p: Vec): void {
    const before = this.session.state.position
    const out = this.session.tap(p)
    if (!out) return
    if (out.result === "ignored") {
      this.cb.coach(out.hint)
      this.opts.sound.play("tick")
      return
    }
    if (out.result === "fault") {
      this.pose = { body: out.landing, feet: [out.landing] }
      this.handleFault()
      return
    }
    const step = out.step
    const award = this.session.state.lastAwards[0]
    if (award) this.effects.text(`+${award.points}`, this.vp.toScreen({ x: out.landing.x, y: out.landing.y + 0.35 }), "#fff", 16)
    if (step.kind === "pickup") {
      this.hop = { from: this.pose, to: this.pose, start: this.time, dur: 0.38, pickup: true }
      this.opts.sound.play("pickup")
    } else {
      const to = this.restingPose(positionAfter(step, before), out.landing, step)
      this.hop = { from: this.pose, to, start: this.time, dur: 0.3, pickup: false }
      this.opts.sound.play("hop")
    }
  }

  private finishHop(): void {
    const hop = this.hop
    this.hop = null
    if (!hop) return
    const step = this.session.currentStep
    this.pose = hop.to
    if (!hop.pickup) {
      for (const f of hop.to.feet) this.effects.dust(this.vp.toScreen(f), 6)
    }
    if (step?.kind === "turn") this.facing = -1
    if (!this.session.completeMove()) return
    const phase = this.session.state.phase
    if (phase === "round-complete") this.handleRoundComplete()
    else this.updateCoach()
  }

  private handleFault(): void {
    const s = this.session.state
    const fault = s.lastFault
    if (!fault || this.awaiting) return
    this.awaiting = true
    this.drag = null
    this.opts.sound.play("miss")
    this.shake = reducedMotion ? 0 : 0.35
    this.hurt = 1
    try {
      navigator.vibrate?.(90)
    } catch {
      /* vibration not allowed in this frame */
    }
    const last = fault.lifeLost && s.lives === 0
    this.cb.banner({
      title: FAULT_MESSAGES[fault.reason],
      subtitle: !fault.lifeLost ? "No problem — try again" : last ? "No lives left" : `${s.lives} ${s.lives === 1 ? "life" : "lives"} left`,
      tone: "bad",
    })
    this.cb.coach("")
    this.after(FAULT_PAUSE, () => {
      this.awaiting = false
      this.cb.banner(null)
      const next = this.session.acknowledgeFault()
      if (next === "game-over") {
        this.opts.sound.play("gameover")
        this.cb.gameOver(this.session.state.score, this.session.level.level)
      } else if (next === "aiming") {
        this.resetForRound()
        this.updateCoach()
      }
    })
  }

  private handleRoundComplete(): void {
    if (this.awaiting) return
    this.awaiting = true
    const s = this.session.state
    this.opts.sound.play("round")
    const at = this.vp.toScreen(this.pose.body)
    this.effects.confetti(at, reducedMotion ? 12 : 46)
    const award = s.lastAwards[0]
    if (award) this.effects.text(`+${award.points} Course complete!`, { x: at.x, y: at.y - 30 }, PALETTE.target, 20)
    const lastRound = s.roundIndex === this.session.level.targets.length - 1
    this.cb.banner({
      title: lastRound ? "Level clear!" : "Round clear!",
      subtitle: s.cleanStreak > 1 ? `${s.cleanStreak} clean rounds in a row` : undefined,
      tone: "good",
    })
    this.cb.coach("")
    this.after(ROUND_PAUSE, () => {
      this.awaiting = false
      this.cb.banner(null)
      const next = this.session.continueAfterRound()
      if (next === "level-complete" && this.session.state.levelSummary) {
        this.opts.sound.play("level")
        this.cb.levelComplete(this.session.state.levelSummary)
      } else if (next === "aiming") {
        this.resetForRound()
        this.announceRound()
      }
    })
  }

  private resetForRound(): void {
    this.flight = null
    this.hop = null
    this.drag = null
    this.facing = 1
    this.pose = this.restingPose({ at: "start" })
  }

  private announceRound(): void {
    this.updateCoach()
    const level = this.session.level
    const s = this.session.state
    if (s.roundIndex === 0 && !this.opts.forgiving) {
      this.cb.banner({ title: `Level ${level.level}`, subtitle: level.name, tone: "info" })
      this.after(1.1, () => this.cb.banner(null))
    }
  }

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn })
  }

  // ---------------------------------------------------------------- coaching

  private updateCoach(): void {
    const s = this.session.state
    const level = this.session.level
    const tutorial = !!this.opts.forgiving
    if (s.phase === "aiming") {
      this.cb.coach(
        tutorial
          ? `Drag upwards from the bottom and let go to throw your stone into square ${this.session.target}. The dotted line shows where it will land.`
          : `Swipe up to throw into square ${this.session.target}`,
      )
      return
    }
    if (s.phase !== "hopping") return
    const step = this.session.currentStep
    if (!step) return
    this.cb.coach(coachForStep(step, s.path, s.stepIndex, level.hints || tutorial, tutorial))
  }

  // ---------------------------------------------------------------- poses

  private restingPose(pos: Position, landing?: Vec, step?: Step): WorldPose {
    const board = this.opts.board
    if (pos.at === "start") {
      const c = startCenter(board)
      return { body: c, feet: [{ x: c.x - 0.08, y: c.y }, { x: c.x + 0.08, y: c.y }] }
    }
    if (pos.at === "rest") {
      const c = landing ?? restCenter(board)
      return { body: c, feet: [{ x: c.x - 0.08, y: c.y }, { x: c.x + 0.08, y: c.y }] }
    }
    const centers = pos.cells.map((id) => cellCenter(getCell(board, id)))
    if (pos.feet === 2 && centers.length >= 2) {
      const mid = { x: (centers[0].x + centers[1].x) / 2, y: (centers[0].y + centers[1].y) / 2 }
      return { body: { x: mid.x, y: mid.y - 0.2 }, feet: centers.slice(0, 2).map((c) => ({ x: c.x + (mid.x - c.x) * 0.55, y: c.y - 0.2 })) }
    }
    const foot = landing && step?.kind === "hop" ? landing : centers[0]
    return { body: { x: foot.x + 0.04, y: foot.y }, feet: [foot] }
  }

  // ---------------------------------------------------------------- frame loop

  private frame = (now: number): void => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastFrame || now)) / 1000))
    this.lastFrame = now
    if (!this.pausedValue) this.update(dt)
    this.draw()
  }

  private update(dt: number): void {
    this.time += dt
    this.shake = Math.max(0, this.shake - dt)
    this.hurt = Math.max(0, this.hurt - dt * 1.5)
    this.effects.update(dt)

    const due = this.timers.filter((t) => t.at <= this.time)
    this.timers = this.timers.filter((t) => t.at > this.time)
    for (const t of due) t.fn()

    if (this.flight && this.time >= this.flight.start + this.flight.dur) this.finishFlight()
    if (this.hop && this.time >= this.hop.start + this.hop.dur) this.finishHop()

    const before = this.session.state.phase
    this.session.tick(dt)
    if (before === "hopping" && this.session.state.phase === "fault") this.handleFault()

    const s = this.session.state
    if (s.phase === "hopping" && s.balanceMax) {
      const tick = Math.ceil(s.balance)
      if (s.balance < 1.5 && tick !== this.lastTick) this.opts.sound.play("tick")
      this.lastTick = tick
    }
    this.pushHud()
  }

  private pushHud(): void {
    const s = this.session.state
    const level = this.session.level
    const balance = s.phase === "hopping" && s.balanceMax ? s.balance / s.balanceMax : null
    const hud: HudState = {
      level: level.level,
      levelName: level.name,
      round: s.roundIndex + 1,
      rounds: level.targets.length,
      score: s.score,
      lives: s.lives,
      maxLives: this.opts.lives,
      target: this.session.target,
      wind: s.wind,
      balance,
      streak: s.cleanStreak,
      forgiving: !!this.opts.forgiving,
    }
    const key = `${hud.level}|${hud.round}|${hud.score}|${hud.lives}|${hud.target}|${balance === null ? "-" : balance.toFixed(2)}|${hud.streak}|${hud.wind.x}`
    if (key === this.lastHudKey) return
    this.lastHudKey = key
    this.cb.hud(hud)
  }

  private draw(): void {
    const ctx = this.ctx
    const { width: w, height: h } = this.vp
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 12 * this.shake : 0
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 12 * this.shake : 0
    ctx.translate(sx, sy)
    if (this.staticLayer) ctx.drawImage(this.staticLayer, 0, 0, w, h)

    const s = this.session.state
    const board = this.opts.board
    const pulse = 0.5 + Math.sin(this.time * 5) * 0.5

    // Target square while aiming.
    if (s.phase === "aiming" || s.phase === "throwing") {
      const cell = getCell(board, this.session.target)
      this.fillCell(cell, `rgba(255, 210, 63, ${0.16 + pulse * 0.16})`, `rgba(255, 210, 63, ${0.7 + pulse * 0.3})`)
    }

    // Next move hint.
    if (s.phase === "hopping") {
      const step = this.session.currentStep
      const showHint = this.session.level.hints || this.opts.forgiving || step?.kind !== "hop"
      if (step && showHint) this.drawStepHint(step, pulse)
    }

    // Fault marker.
    if (s.phase === "fault" && s.lastFault?.at) {
      const p = this.vp.toScreen(s.lastFault.at)
      ctx.strokeStyle = PALETTE.fault
      ctx.lineWidth = 4
      const r = this.vp.scale * 0.16
      ctx.beginPath()
      ctx.moveTo(p.x - r, p.y - r)
      ctx.lineTo(p.x + r, p.y + r)
      ctx.moveTo(p.x + r, p.y - r)
      ctx.lineTo(p.x - r, p.y + r)
      ctx.stroke()
    }

    // The stone.
    const stoneR = MARKER_RADIUS * this.vp.scale
    if (this.flight) {
      const k = Math.min(1, (this.time - this.flight.start) / this.flight.dur)
      const e = k
      const p = { x: this.flight.from.x + (this.flight.to.x - this.flight.from.x) * e, y: this.flight.from.y + (this.flight.to.y - this.flight.from.y) * e }
      const lift = Math.sin(Math.PI * k)
      drawStone(ctx, this.vp.toScreen(p), stoneR, this.time * 14, lift)
    } else if (s.marker && !s.marker.picked) {
      drawStone(ctx, this.vp.toScreen(s.marker.pos), stoneR, 0.6, 0)
    } else if (s.phase === "aiming") {
      this.drawAimUi(stoneR, pulse)
    }

    this.drawPlayer()
    this.drawBalance()
    this.effects.draw(ctx)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  private fillCell(cell: { x: number; y: number; w: number; h: number }, fill: string, stroke?: string): void {
    const ctx = this.ctx
    const a = this.vp.toScreen({ x: cell.x, y: cell.y + cell.h })
    const inset = 3
    ctx.fillStyle = fill
    ctx.fillRect(a.x + inset, a.y + inset, cell.w * this.vp.scale - inset * 2, cell.h * this.vp.scale - inset * 2)
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = 3
      ctx.setLineDash([8, 6])
      ctx.lineDashOffset = -this.time * 20
      ctx.strokeRect(a.x + inset, a.y + inset, cell.w * this.vp.scale - inset * 2, cell.h * this.vp.scale - inset * 2)
      ctx.setLineDash([])
    }
  }

  private drawStepHint(step: Step, pulse: number): void {
    const ctx = this.ctx
    const board = this.opts.board
    const fill = `rgba(126, 224, 161, ${0.14 + pulse * 0.16})`
    const stroke = `rgba(126, 224, 161, ${0.6 + pulse * 0.4})`
    if (step.kind === "hop") {
      for (const id of step.cells) this.fillCell(getCell(board, id), fill, stroke)
    } else if (step.kind === "pickup") {
      const m = this.session.state.marker
      if (!m) return
      const p = this.vp.toScreen(m.pos)
      ctx.strokeStyle = stroke
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(p.x, p.y, this.vp.scale * (0.2 + pulse * 0.06), 0, Math.PI * 2)
      ctx.stroke()
    } else if (step.kind === "turn" && board.rest) {
      const c = this.vp.toScreen({ x: board.rest.cx, y: board.rest.cy })
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(c.x, c.y, board.rest.r * this.vp.scale - 4, Math.PI, Math.PI * 2)
      ctx.fill()
    } else if (step.kind === "exit") {
      this.fillCell({ ...board.start, h: board.start.h - 0.05 }, fill)
    }
  }

  private drawAimUi(stoneR: number, pulse: number): void {
    const ctx = this.ctx
    const board = this.opts.board
    const origin = this.vp.toScreen(board.throwOrigin)
    const aim = this.currentAim()
    if (!aim) {
      // Idle: the stone waits in front of the player with a "swipe up" chalk arrow.
      drawStone(ctx, origin, stoneR, 0.4, 0)
      if (!this.drag) {
        const y = origin.y - 20 - pulse * 18
        ctx.strokeStyle = `rgba(251, 246, 234, ${0.4 + pulse * 0.5})`
        ctx.lineWidth = 3
        ctx.lineCap = "round"
        ctx.beginPath()
        ctx.moveTo(origin.x, y + 14)
        ctx.lineTo(origin.x, y - 10)
        ctx.moveTo(origin.x - 8, y - 2)
        ctx.lineTo(origin.x, y - 10)
        ctx.lineTo(origin.x + 8, y - 2)
        ctx.stroke()
      }
      return
    }
    const level = this.session.level
    const predicted = { x: aim.x + swayOffset(level, this.time).x, y: aim.y + swayOffset(level, this.time).y }
    const end = this.vp.toScreen(predicted)
    const dist = Math.hypot(end.x - origin.x, end.y - origin.y)

    // Dotted flight arc.
    const arcH = Math.min(120, dist * 0.35)
    ctx.fillStyle = "rgba(251, 246, 234, 0.9)"
    const dots = Math.max(6, Math.round(dist / 16))
    for (let i = 1; i < dots; i++) {
      const k = i / dots
      const x = origin.x + (end.x - origin.x) * k
      const y = origin.y + (end.y - origin.y) * k - Math.sin(Math.PI * k) * arcH
      ctx.globalAlpha = 0.35 + 0.65 * (1 - Math.abs(k - 0.5))
      ctx.beginPath()
      ctx.arc(x, y, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // Landing reticle. With hints on it turns green over a valid landing (ignoring wind).
    let good = false
    if (level.hints) good = judgeThrow(board, predicted, this.session.target, this.opts.rules, level.lineBand).ok
    const ringR = (level.scatter + MARKER_RADIUS) * this.vp.scale
    ctx.strokeStyle = level.hints ? (good ? PALETTE.hint : "#ffb4a8") : "rgba(251, 246, 234, 0.95)"
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(end.x, end.y, Math.max(ringR, 8), 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(end.x - 5, end.y)
    ctx.lineTo(end.x + 5, end.y)
    ctx.moveTo(end.x, end.y - 5)
    ctx.lineTo(end.x, end.y + 5)
    ctx.stroke()

    // Stone held at the origin, and a power gauge beside it.
    drawStone(ctx, origin, stoneR, 0.4, 0.15)
    const max = board.bounds.y + board.bounds.h - board.throwOrigin.y
    const power = Math.min(1, Math.hypot(aim.x - board.throwOrigin.x, aim.y - board.throwOrigin.y) / max)
    const gx = origin.x + this.vp.scale * 0.9
    const gh = this.vp.scale * 1.1
    ctx.fillStyle = "rgba(43, 26, 18, 0.55)"
    roundRect(ctx, gx - 5, origin.y - gh / 2, 10, gh, 5)
    ctx.fill()
    ctx.fillStyle = power > 0.85 ? PALETTE.shirtAccent : PALETTE.target
    roundRect(ctx, gx - 5, origin.y + gh / 2 - gh * power, 10, gh * power, 5)
    ctx.fill()
  }

  private drawPlayer(): void {
    const s = this.session.state
    let body = this.pose.body
    let feet = this.pose.feet
    let lift = 0
    let bend = 0
    if (this.hop) {
      const k = Math.min(1, (this.time - this.hop.start) / this.hop.dur)
      if (this.hop.pickup) {
        bend = Math.sin(Math.PI * k)
      } else {
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
        body = { x: lerp(this.hop.from.body.x, this.hop.to.body.x, e), y: lerp(this.hop.from.body.y, this.hop.to.body.y, e) }
        lift = Math.sin(Math.PI * k)
        feet = k < 0.5 ? this.hop.from.feet : this.hop.to.feet
      }
    }
    const pose: CharacterPose = {
      body: this.vp.toScreen(body),
      feet: feet.map((f) => this.vp.toScreen(f)),
      facing: this.facing,
      lift,
      bend,
      carrying: !!s.marker?.picked,
      hurt: this.hurt,
      wobble: s.phase === "hopping" && this.pose.feet.length === 1 ? this.time * 6 : 0,
    }
    drawCharacter(this.ctx, pose, Math.min(this.vp.scale, 110) * 1.25)
  }

  private drawBalance(): void {
    const s = this.session.state
    if (s.phase !== "hopping" || !s.balanceMax || this.hop) return
    const k = s.balance / s.balanceMax
    const p = this.vp.toScreen({ x: this.pose.body.x + 0.42, y: this.pose.body.y + 0.6 })
    const r = this.vp.scale * 0.13
    const ctx = this.ctx
    ctx.lineWidth = 5
    ctx.strokeStyle = "rgba(43, 26, 18, 0.5)"
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = k > 0.5 ? PALETTE.hint : k > 0.25 ? PALETTE.target : PALETTE.fault
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k)
    ctx.stroke()
  }
}

function coachForStep(step: Step, path: Step[], index: number, detailed: boolean, tutorial: boolean): string {
  switch (step.kind) {
    case "pickup":
      return tutorial ? "Your stone is in the next square. Tap it to bend down and pick it up — don't step in!" : "Tap your stone to pick it up"
    case "turn":
      return tutorial ? "Hop into the REST area at the top and turn round." : "Hop into REST and turn round"
    case "exit":
      return tutorial ? "Last hop: tap behind the throw line to finish." : "Hop out behind the line"
    case "hop": {
      if (!detailed) return ""
      const prev = path[index - 1]
      const jumped = step.leg === "out" && (prev?.kind === "hop" ? step.row - prev.row > 1 : step.row > 0)
      const where = step.feet === 2 ? `Both feet: land in ${step.cells.join(" and ")}` : `One foot: hop to ${step.cells[0]}`
      const extra = jumped ? " (jump over the stone)" : ""
      return tutorial && index === 0 ? `Tap square ${step.cells[0]} to hop. Skip the square with your stone, and keep off the chalk lines!` : where + extra
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, Math.max(0, h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function preventDefault(e: Event): void {
  e.preventDefault()
}
