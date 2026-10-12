import type { LevelSummary } from "../core/session"
import type { LeaderboardResult, Platform, PlatformStatus, PlayerInfo } from "../platform/platform"
import type { SubmissionStatus } from "../platform/score-queue"
import type { LocalScore } from "../storage/storage"
import { HERO_BOARD, HOWTO_ART } from "./art"
import { h, icon } from "./dom"

export const fmt = (n: number): string => Math.round(n).toLocaleString("en-NG")

// ------------------------------------------------------------------ shared bits

export function button(label: string, onClick: () => void, opts: { kind?: "primary" | "secondary" | "ghost"; iconName?: Parameters<typeof icon>[0]; id?: string } = {}): HTMLButtonElement {
  return h(
    "button",
    { class: `btn btn-${opts.kind ?? "secondary"}`, type: "button", onClick: () => onClick(), "data-testid": opts.id },
    opts.iconName ? icon(opts.iconName) : null,
    h("span", null, label),
  )
}

export function iconButton(name: Parameters<typeof icon>[0], label: string, onClick: () => void, id?: string): HTMLButtonElement {
  return h("button", { class: "icon-btn", type: "button", "aria-label": label, title: label, onClick: () => onClick(), "data-testid": id }, icon(name))
}

export function statusBadge(status: PlatformStatus): HTMLElement {
  const map: Record<string, [string, string]> = {
    connecting: ["Connecting…", "pending"],
    local: ["Local mode", "local"],
    unavailable: ["Offline", "warn"],
  }
  let [label, tone] = map[status.state] ?? ["", ""]
  if (status.state === "connected") [label, tone] = status.mode === "test" ? ["Vatar sandbox", "test"] : ["Lagos Life", "live"]
  return h("span", { class: `badge badge-${tone}`, title: status.message ?? label, "data-testid": "platform-badge" }, h("i", { class: "dot" }), label)
}

/** Describes a score submission honestly: local scores are never presented as posted. */
export function submissionText(s: SubmissionStatus, status: PlatformStatus): { text: string; tone: "ok" | "pending" | "warn" | "local" } {
  const sandbox = status.mode === "test" ? "Sandbox: " : ""
  switch (s.state) {
    case "idle":
      return status.state === "connected" ? { text: "", tone: "pending" } : { text: "Saved on this device only — not on the live leaderboard.", tone: "local" }
    case "waiting":
      return { text: "Connecting to Lagos Life to post your score…", tone: "pending" }
    case "queued":
      return { text: `${sandbox}Score ${fmt(s.score)} queued — the leaderboard takes one score every 20 seconds.`, tone: "pending" }
    case "sending":
      return { text: `${sandbox}Posting ${fmt(s.score)} to the leaderboard…`, tone: "pending" }
    case "sent":
      return s.accepted
        ? { text: `${sandbox}Posted ${fmt(s.score)} to the leaderboard. Your best there: ${fmt(s.best)}.`, tone: "ok" }
        : { text: `${sandbox}Score ${fmt(s.score)} received. It didn't beat your leaderboard best of ${fmt(s.best)}.`, tone: "ok" }
    case "failed":
      return { text: `Couldn't post your score (${s.code.replace("_", " ")}). It's saved on this device.`, tone: "warn" }
    case "local":
      return { text: "Local mode — saved on this device only, not on the live leaderboard.", tone: "local" }
  }
}

/** A live line of text that follows the platform's submission status until `cleanup` is called. */
export function submissionLine(platform: Platform, cleanups: (() => void)[]): HTMLElement {
  const el = h("p", { class: "submission", "data-testid": "submission-status" })
  const render = () => {
    const { text, tone } = submissionText(platform.submission, platform.status)
    el.textContent = text
    el.className = `submission submission-${tone}`
    el.hidden = !text
  }
  render()
  cleanups.push(platform.onSubmission(render), platform.onStatus(render))
  return el
}

// ------------------------------------------------------------------ home

export interface HomeProps {
  best: number
  bestLevel: number
  player: PlayerInfo | null
  status: PlatformStatus
  muted: boolean
  onPlay(): void
  onHowTo(): void
  onLeaderboard(): void
  onToggleMute(): void
}

export function homeScreen(p: HomeProps): HTMLElement {
  return h(
    "section",
    { class: "screen home", "data-screen": "home" },
    h("header", { class: "topbar" }, statusBadge(p.status), iconButton(p.muted ? "soundOff" : "soundOn", p.muted ? "Unmute" : "Mute", p.onToggleMute, "mute")),
    h(
      "div",
      { class: "hero" },
      h("div", { class: "hero-board", html: HERO_BOARD }),
      h("h1", { class: "logo" }, "Suwe"),
      h("p", { class: "tagline" }, "Throw the stone. Hop the squares. Rule the yard."),
    ),
    h(
      "div",
      { class: "home-info" },
      p.player?.name
        ? h("p", { class: "greeting" }, p.player.avatar ? h("img", { src: p.player.avatar, alt: "", class: "avatar" }) : null, `Welcome, ${p.player.name}!`)
        : null,
      h(
        "p",
        { class: "best", "data-testid": "home-best" },
        ...(p.best > 0
          ? ["Personal best ", h("strong", null, fmt(p.best)), p.bestLevel > 0 ? ` · reached level ${p.bestLevel}` : ""]
          : ["No personal best yet — let's play!"]),
      ),
      p.status.message ? h("p", { class: "status-note" }, p.status.message) : null,
    ),
    h(
      "nav",
      { class: "home-actions" },
      button("Play", p.onPlay, { kind: "primary", iconName: "play", id: "play" }),
      h("div", { class: "row" }, button("How to play", p.onHowTo, { iconName: "help", id: "howto" }), button("Leaderboard", p.onLeaderboard, { iconName: "trophy", id: "leaderboard" })),
    ),
    h("footer", { class: "footer" }, "A Lagos Life game"),
  )
}

// ------------------------------------------------------------------ how to play

export function howToScreen(onTutorial: () => void, onBack: () => void): HTMLElement {
  const card = (art: string, title: string, text: string) =>
    h("li", { class: "howto-card" }, h("div", { class: "howto-art", html: art }), h("div", null, h("h3", null, title), h("p", null, text)))
  return h(
    "section",
    { class: "screen howto", "data-screen": "howto" },
    h("header", { class: "topbar" }, iconButton("back", "Back", onBack, "back"), h("h2", null, "How to play"), h("span", { class: "spacer" })),
    h(
      "ol",
      { class: "howto-list" },
      card(HOWTO_ART.throw, "Throw your stone", "Swipe or drag upwards and let go. Land the stone inside the glowing square — not on a line."),
      card(HOWTO_ART.hop, "Hop the squares", "Tap each square in order to hop. Skip the square with your stone. Side-by-side squares take both feet."),
      card(HOWTO_ART.pickup, "Turn and pick up", "Turn round in REST, hop back and tap your stone to pick it up, then hop out over the line."),
      card(HOWTO_ART.lines, "Stay sharp", "Touching a chalk line, the stone's square or running out of balance costs a life. You have 3."),
    ),
    h(
      "div",
      { class: "howto-actions" },
      button("Try the tutorial", onTutorial, { kind: "primary", iconName: "play", id: "start-tutorial" }),
      h("p", { class: "fine" }, "Ten levels. Wind and wobble get stronger, and your balance time gets shorter."),
    ),
  )
}

// ------------------------------------------------------------------ game shell

export interface GameShell {
  root: HTMLElement
  canvas: HTMLCanvasElement
  hud: {
    level: HTMLElement
    score: HTMLElement
    lives: HTMLElement
    target: HTMLElement
    wind: HTMLElement
    streak: HTMLElement
    balance: HTMLElement
    muteBtn: HTMLButtonElement
  }
  banner: HTMLElement
  coach: HTMLElement
  layer: HTMLElement
}

export function gameShell(opts: { muted: boolean; tutorial: boolean; onPause(): void; onToggleMute(): void; onSkip?(): void }): GameShell {
  const canvas = h("canvas", { class: "board-canvas", "aria-label": "Suwe board. Swipe up to throw, tap squares to hop.", role: "img", "data-testid": "board" })
  const level = h("div", { class: "hud-level", "data-testid": "hud-level" })
  const score = h("div", { class: "hud-score", "data-testid": "hud-score" }, "0")
  const lives = h("div", { class: "hud-lives", "data-testid": "hud-lives" })
  const target = h("span", { class: "chip chip-target", "data-testid": "hud-target" })
  const wind = h("span", { class: "chip chip-wind", hidden: true })
  const streak = h("span", { class: "chip chip-streak", hidden: true })
  const balance = h("div", { class: "hud-balance", hidden: true }, h("i"))
  const muteBtn = iconButton(opts.muted ? "soundOff" : "soundOn", opts.muted ? "Unmute" : "Mute", opts.onToggleMute, "game-mute")
  const banner = h("div", { class: "banner", hidden: true, "data-testid": "banner" })
  const coach = h("div", { class: "coach", "data-testid": "coach" })
  const layer = h("div", { class: "modal-layer" })
  const root = h(
    "section",
    { class: `screen game${opts.tutorial ? " is-tutorial" : ""}`, "data-screen": opts.tutorial ? "tutorial" : "game" },
    canvas,
    h(
      "header",
      { class: "hud" },
      h(
        "div",
        { class: "hud-row" },
        iconButton("pause", "Pause", opts.onPause, "pause"),
        h("div", { class: "hud-center" }, level, score),
        h("div", { class: "hud-right" }, lives, muteBtn),
      ),
      h("div", { class: "hud-row hud-chips" }, target, wind, streak, opts.tutorial && opts.onSkip ? h("button", { class: "chip chip-skip", type: "button", onClick: opts.onSkip, "data-testid": "skip-tutorial" }, "Skip tutorial") : null),
      balance,
    ),
    banner,
    coach,
    layer,
  )
  return { root, canvas, hud: { level, score, lives, target, wind, streak, balance, muteBtn }, banner, coach, layer }
}

export function setMuteIcon(btn: HTMLButtonElement, muted: boolean): void {
  btn.replaceChildren(icon(muted ? "soundOff" : "soundOn"))
  btn.setAttribute("aria-label", muted ? "Unmute" : "Mute")
  btn.title = muted ? "Unmute" : "Mute"
}

export function renderLives(el: HTMLElement, lives: number, max: number, forgiving: boolean): void {
  if (forgiving) {
    el.replaceChildren(h("span", { class: "practice" }, "Practice"))
    return
  }
  const prev = Number(el.dataset.lives ?? max)
  el.replaceChildren(...Array.from({ length: max }, (_, i) => icon("heart", `heart${i < lives ? "" : " lost"}${i === lives && lives < prev ? " breaking" : ""}`)))
  el.dataset.lives = String(lives)
  el.setAttribute("aria-label", `${lives} of ${max} lives`)
}

// ------------------------------------------------------------------ modals

function modal(cls: string, ...children: (Node | null)[]): HTMLElement {
  return h("div", { class: "modal-backdrop" }, h("div", { class: `modal ${cls}`, role: "dialog", "aria-modal": "true" }, ...children))
}

function stars(n: number): HTMLElement {
  return h("div", { class: "stars", "aria-label": `${n} of 3 stars` }, ...[1, 2, 3].map((i) => icon("star", `star${i <= n ? " on" : ""}`)))
}

export function levelCompleteModal(p: {
  summary: LevelSummary
  score: number
  submission: HTMLElement
  onNext(): void
  onHome(): void
  onLeaderboard(): void
  onReplay(): void
}): HTMLElement {
  const s = p.summary
  const rows = h(
    "dl",
    { class: "breakdown" },
    h("dt", null, "Rounds"),
    h("dd", null, fmt(s.roundsScore)),
    h("dt", null, "Level bonus"),
    h("dd", null, `+${fmt(s.levelBonus)}`),
    s.flawlessBonus ? h("dt", null, "No lives lost") : null,
    s.flawlessBonus ? h("dd", null, `+${fmt(s.flawlessBonus)}`) : null,
    h("dt", null, "Throw accuracy"),
    h("dd", null, `${Math.round(s.averageAccuracy * 100)}%`),
  )
  if (s.campaignComplete) {
    return modal(
      "victory",
      h("p", { class: "eyebrow" }, "All 10 levels cleared"),
      h("h2", null, "You're the Suwe Oga!"),
      stars(s.stars),
      rows,
      h("p", { class: "total" }, "Final score ", h("strong", { "data-testid": "final-score" }, fmt(p.score))),
      p.submission,
      h("div", { class: "modal-actions" }, button("Play again", p.onReplay, { kind: "primary", iconName: "replay", id: "replay" }), button("Leaderboard", p.onLeaderboard, { iconName: "trophy" }), button("Home", p.onHome, { kind: "ghost", iconName: "home", id: "home" })),
    )
  }
  return modal(
    "level-complete",
    h("p", { class: "eyebrow" }, `Level ${s.level} complete`),
    h("h2", null, s.name),
    stars(s.stars),
    rows,
    h("p", { class: "total" }, "Score ", h("strong", { "data-testid": "total-score" }, fmt(p.score))),
    p.submission,
    h("div", { class: "modal-actions" }, button(`Level ${s.level + 1}`, p.onNext, { kind: "primary", iconName: "next", id: "next-level" }), button("Home", p.onHome, { kind: "ghost", iconName: "home", id: "home" })),
  )
}

export function gameOverModal(p: { score: number; best: number; newBest: boolean; level: number; submission: HTMLElement; onReplay(): void; onHome(): void; onLeaderboard(): void }): HTMLElement {
  return modal(
    "game-over",
    h("p", { class: "eyebrow" }, `Out of lives on level ${p.level}`),
    h("h2", null, "Game over"),
    p.newBest ? h("p", { class: "new-best", "data-testid": "new-best" }, "New personal best!") : null,
    h("p", { class: "total big" }, h("strong", { "data-testid": "final-score" }, fmt(p.score))),
    h("p", { class: "fine" }, `Personal best: ${fmt(p.best)}`),
    p.submission,
    h(
      "div",
      { class: "modal-actions" },
      button("Try again", p.onReplay, { kind: "primary", iconName: "replay", id: "replay" }),
      button("Leaderboard", p.onLeaderboard, { iconName: "trophy", id: "go-leaderboard" }),
      button("Home", p.onHome, { kind: "ghost", iconName: "home", id: "home" }),
    ),
  )
}

export function pauseModal(onResume: () => void, onHome: () => void): HTMLElement {
  return modal(
    "pause",
    h("h2", null, "Paused"),
    h("p", { class: "fine" }, "Your balance timer is frozen."),
    h("div", { class: "modal-actions" }, button("Resume", onResume, { kind: "primary", iconName: "play", id: "resume" }), button("Quit to home", onHome, { kind: "ghost", iconName: "home", id: "quit" })),
  )
}

export function tutorialDoneModal(onPlay: () => void, onHome: () => void): HTMLElement {
  return modal(
    "tutorial-done",
    h("p", { class: "eyebrow" }, "Tutorial complete"),
    h("h2", null, "You've got it!"),
    h("p", null, "Now for real: three lives, ten levels. Watch the wind arrow and your balance ring."),
    h("div", { class: "modal-actions" }, button("Start level 1", onPlay, { kind: "primary", iconName: "play", id: "start-level-1" }), button("Home", onHome, { kind: "ghost", iconName: "home", id: "home" })),
  )
}

// ------------------------------------------------------------------ leaderboard

export function leaderboardScreen(onBack: () => void, onPlay: () => void): { root: HTMLElement; body: HTMLElement } {
  const body = h("div", { class: "lb-body", "data-testid": "leaderboard-body" })
  const root = h(
    "section",
    { class: "screen leaderboard", "data-screen": "leaderboard" },
    h("header", { class: "topbar" }, iconButton("back", "Back", onBack, "back"), h("h2", null, "Leaderboard"), h("span", { class: "spacer" })),
    body,
    h("div", { class: "lb-actions" }, button("Play", onPlay, { kind: "primary", iconName: "play" })),
  )
  return { root, body }
}

export function leaderboardLoading(): HTMLElement {
  return h("div", { class: "lb-state" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("p", null, "Loading the yard's best…"))
}

function localList(scores: LocalScore[]): HTMLElement {
  if (scores.length === 0) return h("div", { class: "lb-state empty" }, icon("stone", "empty-icon"), h("p", null, "No scores yet. Finish a run to see it here."))
  return h(
    "ol",
    { class: "lb-list" },
    ...scores.map((s, i) =>
      h(
        "li",
        null,
        h("span", { class: "rank" }, `${i + 1}`),
        h("span", { class: "name" }, new Date(s.date).toLocaleDateString(undefined, { day: "numeric", month: "short" }), h("small", null, ` · level ${s.level}`)),
        h("span", { class: "score" }, fmt(s.score)),
      ),
    ),
  )
}

export function leaderboardContent(r: LeaderboardResult, onRetry: () => void, playerName?: string): HTMLElement {
  if (r.source === "local") {
    return h(
      "div",
      null,
      h("div", { class: "notice notice-local" }, icon("cloudOff"), h("p", null, r.reason)),
      h("h3", { class: "lb-heading" }, "Your scores on this device"),
      localList(r.scores),
    )
  }
  if (r.source === "error") {
    return h(
      "div",
      null,
      h("div", { class: "notice notice-warn" }, icon("cloudOff"), h("p", null, `Couldn't load the leaderboard. ${r.message}`)),
      h("div", { class: "lb-retry" }, button("Try again", onRetry, { iconName: "replay", id: "retry" })),
      h("h3", { class: "lb-heading" }, "Your scores on this device"),
      localList(r.scores),
    )
  }
  const { top, me } = r.board
  return h(
    "div",
    null,
    r.stale ? h("div", { class: "notice notice-warn" }, h("p", null, "Showing the last leaderboard we loaded — couldn't refresh it just now.")) : null,
    me
      ? h("div", { class: "me-card", "data-testid": "my-rank" }, h("span", null, playerName ? `${playerName} · your place` : "Your place"), h("strong", null, me.label), h("span", { class: "score" }, fmt(me.score)))
      : h("div", { class: "me-card muted" }, h("span", null, "Finish a level to get on the board")),
    top.length === 0
      ? h("div", { class: "lb-state empty" }, icon("trophy", "empty-icon"), h("p", null, "No scores yet. Be the first on the board!"))
      : h(
          "ol",
          { class: "lb-list" },
          ...top.map((e) =>
            h("li", { class: e.rank <= 3 ? `top top-${e.rank}` : "" }, h("span", { class: "rank" }, String(e.rank)), h("span", { class: "name" }, e.name), h("span", { class: "score" }, fmt(e.score))),
          ),
        ),
    h("p", { class: "fine" }, "Top 50 · best score per player · refreshes every 30 seconds"),
  )
}
