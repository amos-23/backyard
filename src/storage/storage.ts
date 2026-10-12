/**
 * Local persistence. Inside the Vatar frame the game is a third-party site, and some browsers block
 * or partition its storage, so every access is guarded and falls back to memory for the session.
 */
const PREFIX = "suwe.v1."

export interface LocalScore {
  score: number
  level: number
  date: number
}

export interface Settings {
  muted: boolean
  tutorialDone: boolean
  /** Chosen chalk palette id. Premium palettes only render while the pack is verified as owned. */
  chalk: string
}

const memory = new Map<string, string>()

function read(key: string): string | null {
  try {
    const v = window.localStorage.getItem(PREFIX + key)
    if (v !== null) return v
  } catch {
    /* storage blocked */
  }
  return memory.get(key) ?? null
}

function write(key: string, value: string): void {
  memory.set(key, value)
  try {
    window.localStorage.setItem(PREFIX + key, value)
  } catch {
    /* storage blocked or full: the in-memory copy still works for this visit */
  }
}

function readJson<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  const raw = read(key)
  if (raw === null) return fallback
  try {
    const v: unknown = JSON.parse(raw)
    return valid(v) ? v : fallback
  } catch {
    return fallback
  }
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
const isScore = (v: unknown): v is LocalScore =>
  !!v && typeof v === "object" && isNumber((v as LocalScore).score) && isNumber((v as LocalScore).level) && isNumber((v as LocalScore).date)
const isScoreList = (v: unknown): v is LocalScore[] => Array.isArray(v) && v.every(isScore)
const isSettings = (v: unknown): v is Partial<Settings> & Pick<Settings, "muted" | "tutorialDone"> =>
  !!v && typeof v === "object" && typeof (v as Settings).muted === "boolean" && typeof (v as Settings).tutorialDone === "boolean"
const isOwnedMap = (v: unknown): v is Record<string, string[]> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => Array.isArray(x) && x.every((y) => typeof y === "string"))
const DEFAULT_SETTINGS: Settings = { muted: false, tutorialDone: false, chalk: "classic" }

export const MAX_LOCAL_SCORES = 10

export const storage = {
  getBest(): number {
    return readJson("best", 0, isNumber)
  },

  /** Saves the score if it beats the personal best. Returns true when it is a new best. */
  recordBest(score: number): boolean {
    const s = Math.floor(score)
    if (s <= this.getBest()) return false
    write("best", JSON.stringify(s))
    return true
  },

  getBestLevel(): number {
    return readJson("bestLevel", 0, isNumber)
  },

  recordLevelReached(level: number): void {
    if (level > this.getBestLevel()) write("bestLevel", JSON.stringify(level))
  },

  getLocalScores(): LocalScore[] {
    return readJson("scores", [], isScoreList)
  },

  addLocalScore(entry: LocalScore): void {
    if (entry.score <= 0) return
    const list = [...this.getLocalScores(), entry].sort((a, b) => b.score - a.score || a.date - b.date).slice(0, MAX_LOCAL_SCORES)
    write("scores", JSON.stringify(list))
  },

  getSettings(): Settings {
    const v = readJson("settings", DEFAULT_SETTINGS, isSettings)
    // Older saves have no chalk field.
    return { ...DEFAULT_SETTINGS, ...v, chalk: typeof v.chalk === "string" ? v.chalk : DEFAULT_SETTINGS.chalk }
  },

  /**
   * Last server-confirmed purchases per player ("mode:playerId"), so a known owner sees their
   * colours instantly while the server re-check runs. A display cache only: ownership itself is
   * decided by the server, and this is overwritten by every server answer.
   */
  getCachedOwned(key: string): string[] {
    return readJson("owned", {}, isOwnedMap)[key] ?? []
  },

  setCachedOwned(key: string, products: string[]): void {
    const map = readJson("owned", {}, isOwnedMap)
    map[key] = products
    write("owned", JSON.stringify(map))
  },

  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch }
    write("settings", JSON.stringify(next))
    return next
  },
}

export type Storage = typeof storage
