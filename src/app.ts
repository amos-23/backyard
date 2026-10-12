import type { Sound } from "./audio/sound"
import { LAGOS_CLASSIC } from "./config/board"
import { effectiveChalk } from "./config/chalk"
import { LEVELS, STARTING_LIVES, TUTORIAL_LEVEL } from "./config/levels"
import { TRADITIONAL_RULES } from "./config/rules"
import { buildBoard } from "./core/board"
import type { LevelSummary } from "./core/session"
import { GameController, type HudState } from "./game/controller"
import type { Platform } from "./platform/platform"
import type { ChalkShop } from "./shop/chalk-shop"
import type { Storage } from "./storage/storage"
import { chalkScreen } from "./ui/chalk-screen"
import { h, icon } from "./ui/dom"
import {
  type GameShell,
  fmt,
  gameOverModal,
  gameShell,
  homeScreen,
  howToScreen,
  leaderboardContent,
  leaderboardLoading,
  leaderboardScreen,
  levelCompleteModal,
  pauseModal,
  renderLives,
  setMuteIcon,
  submissionLine,
  tutorialDoneModal,
} from "./ui/screens"

/** The board and rule set used by the campaign. Swap these to play a different regional variant. */
const BOARD = buildBoard(LAGOS_CLASSIC)
const RULES = TRADITIONAL_RULES

type Overlay = "none" | "pause" | "result"

/** Screen routing and the glue between the game, local storage and the Vatar platform. */
export class App {
  private viewCleanups: (() => void)[] = []
  private controller: GameController | null = null
  private shell: GameShell | null = null
  private overlay: Overlay = "none"
  private tutorial = false
  private run = { recorded: true, bestAtStart: 0 }
  private screen = "boot"
  private leaderboardToken = 0
  /** Between Vatar.onPause and Vatar.onResume (phone backgrounded, or a world sheet over the game). */
  private hostPaused = false

  constructor(
    private readonly root: HTMLElement,
    private readonly platform: Platform,
    private readonly sound: Sound,
    private readonly storage: Storage,
    private readonly shop: ChalkShop,
  ) {
    platform.onPause(() => {
      this.hostPaused = true
      this.pauseGame()
    })
    platform.onResume(() => {
      // In a run, the pause overlay stays up until the player taps Resume, so timers stay frozen
      // and nothing is missed. Outside a run, sound simply comes back.
      this.hostPaused = false
      this.syncSound()
    })
    platform.onStatus(() => {
      if (this.screen === "home") this.showHome()
    })
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pauseGame()
      else this.syncSound()
    })
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.controller) {
        if (this.overlay === "pause") this.resumeGame()
        else this.pauseGame()
      } else if (e.key === "m" || e.key === "M") {
        this.toggleMute()
      }
    })
    // Sound may only start after the player's first tap.
    window.addEventListener("pointerdown", () => this.sound.unlock(), { capture: true })
    window.addEventListener("keydown", () => this.sound.unlock(), { capture: true })
  }

  start(): void {
    if (new URLSearchParams(location.search).has("debug")) {
      ;(window as unknown as { __suwe: unknown }).__suwe = {
        info: () => this.controller?.debugInfo() ?? null,
        screen: () => this.screen,
        soundPaused: () => this.sound.isPaused,
      }
    }
    void this.platform.connect()
    // Rechecks ownership with our server and restores interrupted purchases. Failures only affect
    // the cosmetic pack; the game itself never waits on it.
    void this.shop.start()
    this.showHome()
  }

  // ---------------------------------------------------------------- navigation

  private mount(el: HTMLElement, name: string): void {
    this.viewCleanups.forEach((fn) => fn())
    this.viewCleanups = []
    this.controller?.destroy()
    this.controller = null
    this.shell = null
    this.overlay = "none"
    this.screen = name
    this.root.replaceChildren(el)
    this.syncSound()
  }

  showHome(): void {
    const settings = this.storage.getSettings()
    this.mount(
      homeScreen({
        best: this.storage.getBest(),
        bestLevel: this.storage.getBestLevel(),
        player: this.platform.player,
        status: this.platform.status,
        muted: settings.muted,
        onPlay: () => this.play(),
        onHowTo: () => this.showHowTo(),
        onLeaderboard: () => this.showLeaderboard(),
        onChalk: () => this.showChalk(),
        onToggleMute: () => {
          this.toggleMute()
          this.showHome()
        },
      }),
      "home",
    )
  }

  private showChalk(): void {
    const screen = chalkScreen({
      rows: LAGOS_CLASSIC.rows,
      selected: this.storage.getSettings().chalk,
      onSelect: (id) => this.storage.updateSettings({ chalk: id }),
      onBuy: () => void this.shop.buy(),
      onRetry: () => void this.shop.retry(),
      onBack: () => {
        this.shop.dismiss()
        this.showHome()
      },
      onPlay: () => {
        this.shop.dismiss()
        this.play()
      },
    })
    this.mount(screen.root, "chalk")
    screen.render(this.shop.state)
    this.viewCleanups.push(this.shop.onChange((s) => screen.render(s)))
  }

  private showHowTo(): void {
    this.mount(
      howToScreen(
        () => this.startRun(true),
        () => this.showHome(),
      ),
      "howto",
    )
  }

  private play(): void {
    this.startRun(!this.storage.getSettings().tutorialDone)
  }

  private async showLeaderboard(): Promise<void> {
    const { root, body } = leaderboardScreen(
      () => this.showHome(),
      () => this.play(),
    )
    this.mount(root, "leaderboard")
    const token = ++this.leaderboardToken
    const load = async () => {
      body.replaceChildren(leaderboardLoading())
      const result = await this.platform.leaderboard()
      if (token !== this.leaderboardToken || this.screen !== "leaderboard") return // navigated away
      body.replaceChildren(leaderboardContent(result, () => void load(), this.platform.player?.name || undefined))
    }
    await load()
  }

  // ---------------------------------------------------------------- runs

  private startRun(tutorial: boolean): void {
    const settings = this.storage.getSettings()
    this.tutorial = tutorial
    this.run = { recorded: tutorial, bestAtStart: this.storage.getBest() }
    const shell = gameShell({
      muted: settings.muted,
      tutorial,
      onPause: () => this.pauseGame(),
      onToggleMute: () => this.toggleMute(),
      onSkip: () => {
        this.storage.updateSettings({ tutorialDone: true })
        this.startRun(false)
      },
    })
    this.mount(shell.root, tutorial ? "tutorial" : "game")
    this.shell = shell
    const hudHeight = shell.root.querySelector(".hud")?.getBoundingClientRect().height ?? 96
    this.controller = new GameController(
      shell.canvas,
      {
        board: BOARD,
        rules: RULES,
        levels: tutorial ? [TUTORIAL_LEVEL] : LEVELS,
        lives: STARTING_LIVES,
        rng: Math.random,
        sound: this.sound,
        forgiving: tutorial,
        // Cosmetic only. A pack colour is drawn only while the server-verified pack is owned.
        chalk: effectiveChalk(settings.chalk, this.shop.owned),
        insetTop: hudHeight + 10,
        insetBottom: 76,
      },
      {
        hud: (hud) => this.renderHud(hud),
        banner: (b) => {
          shell.banner.hidden = !b
          if (!b) return
          shell.banner.className = `banner banner-${b.tone}`
          shell.banner.replaceChildren(h("strong", null, b.title), b.subtitle ? h("span", null, b.subtitle) : "")
        },
        coach: (text) => {
          shell.coach.textContent = text
          shell.coach.classList.toggle("empty", !text)
        },
        levelComplete: (summary) => this.onLevelComplete(summary),
        gameOver: (score, level) => this.onGameOver(score, level),
      },
    )
  }

  private renderHud(hud: HudState): void {
    const s = this.shell
    if (!s) return
    s.hud.level.textContent = hud.forgiving ? "Tutorial" : `Level ${hud.level} · Round ${hud.round}/${hud.rounds}`
    s.hud.score.textContent = fmt(hud.score)
    renderLives(s.hud.lives, hud.lives, hud.maxLives, hud.forgiving)
    s.hud.target.replaceChildren(icon("stone", "chip-icon"), `Square ${hud.target}`)
    const windStrength = Math.hypot(hud.wind.x, hud.wind.y)
    s.hud.wind.hidden = windStrength < 0.01
    if (windStrength >= 0.01) {
      // Wind points where it pushes the stone. Screen y is flipped relative to the board.
      const angle = (Math.atan2(-hud.wind.y, hud.wind.x) * 180) / Math.PI
      const label = windStrength > 0.28 ? "Strong" : windStrength > 0.16 ? "Breezy" : "Light"
      s.hud.wind.replaceChildren(icon("wind", "chip-icon"), h("span", { class: "wind-arrow", style: { transform: `rotate(${angle}deg)` } }, "➜"), label)
    }
    s.hud.streak.hidden = hud.streak < 1
    s.hud.streak.textContent = `Streak ×${Math.min(2, 1 + hud.streak * 0.25).toFixed(2).replace(/0$/, "")}`
    s.hud.balance.hidden = hud.balance === null
    if (hud.balance !== null) {
      const bar = s.hud.balance.firstElementChild as HTMLElement
      bar.style.transform = `scaleX(${hud.balance})`
      s.hud.balance.dataset.level = hud.balance > 0.5 ? "ok" : hud.balance > 0.25 ? "low" : "danger"
    }
  }

  private showOverlay(el: HTMLElement, kind: Overlay): void {
    if (!this.shell) return
    this.overlay = kind
    this.shell.layer.replaceChildren(el)
    el.querySelector<HTMLButtonElement>(".btn-primary")?.focus({ preventScroll: true })
  }

  private clearOverlay(): void {
    this.overlay = "none"
    this.shell?.layer.replaceChildren()
  }

  private onLevelComplete(summary: LevelSummary): void {
    const controller = this.controller
    if (!controller) return
    if (this.tutorial) {
      this.storage.updateSettings({ tutorialDone: true })
      this.showOverlay(
        tutorialDoneModal(
          () => this.startRun(false),
          () => this.showHome(),
        ),
        "result",
      )
      return
    }
    const score = controller.session.state.score
    // Milestone: keep the personal best and the leaderboard up to date even if the run is abandoned later.
    this.storage.recordBest(score)
    this.storage.recordLevelReached(summary.level)
    if (summary.campaignComplete) this.recordRunEnd(score, summary.level)
    else this.platform.submitScore(score)
    this.showOverlay(
      levelCompleteModal({
        summary,
        score,
        submission: submissionLine(this.platform, this.viewCleanups),
        onNext: () => {
          this.clearOverlay()
          controller.nextLevel()
        },
        onHome: () => this.showHome(),
        onLeaderboard: () => this.showLeaderboard(),
        onReplay: () => this.startRun(false),
      }),
      "result",
    )
  }

  private onGameOver(score: number, level: number): void {
    if (this.tutorial) return
    const newBest = this.recordRunEnd(score, level)
    this.showOverlay(
      gameOverModal({
        score,
        best: this.storage.getBest(),
        newBest,
        level,
        submission: submissionLine(this.platform, this.viewCleanups),
        onReplay: () => this.startRun(false),
        onHome: () => this.showHome(),
        onLeaderboard: () => this.showLeaderboard(),
      }),
      "result",
    )
  }

  /** Records a finished (or abandoned) run exactly once. Returns true for a new personal best. */
  private recordRunEnd(score: number, level: number): boolean {
    if (this.run.recorded) return false
    this.run.recorded = true
    this.storage.recordBest(score)
    this.storage.recordLevelReached(level)
    this.storage.addLocalScore({ score: Math.floor(score), level, date: Date.now() })
    this.platform.submitScore(score)
    return score > this.run.bestAtStart && score > 0
  }

  // ---------------------------------------------------------------- pause & sound

  private pauseGame(): void {
    const c = this.controller
    if (!c || this.overlay !== "none") return this.syncSound()
    c.pause()
    this.showOverlay(
      pauseModal(
        () => this.resumeGame(),
        () => {
          if (!this.tutorial) {
            const s = c.session.state
            if (s.score > 0) this.recordRunEnd(s.score, c.session.level.level)
          }
          this.showHome()
        },
      ),
      "pause",
    )
    this.syncSound()
  }

  private resumeGame(): void {
    if (this.overlay !== "pause") return
    this.clearOverlay()
    this.controller?.resume()
    this.syncSound()
  }

  /**
   * Sound plays only while the host hasn't paused us, the page is visible and the pause menu is
   * closed. Every pause/resume path funnels through here, so sound can never stay stuck off (or
   * come back while the host still has the game paused).
   */
  private syncSound(): void {
    if (this.hostPaused || document.hidden || this.overlay === "pause") this.sound.pause()
    else this.sound.resume()
  }

  private toggleMute(): void {
    const muted = !this.sound.muted
    this.sound.setMuted(muted)
    this.storage.updateSettings({ muted })
    if (this.shell) setMuteIcon(this.shell.hud.muteBtn, muted)
  }
}
