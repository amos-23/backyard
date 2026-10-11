/**
 * The ten-level campaign. Each level is a list of target squares (one round per target) plus the
 * difficulty dials. Distances are in board world units (one square is about 1 unit tall).
 */
export interface LevelConfig {
  level: number
  name: string
  /** Square numbers to throw at, in order. One round per entry. */
  targets: number[]
  /** Random spread added to every throw (radius, world units). */
  scatter: number
  /** Amplitude of the visible sway on the aim point that the player must time their release against. */
  sway: number
  /** Sway cycles per second. */
  swaySpeed: number
  /** Maximum sideways/forward wind drift per round (shown as an arrow). 0 = calm. */
  wind: number
  /** Seconds the player can balance before each hop. null = no time pressure. */
  hopTime: number | null
  /** Distance from a chalk line (world units) that counts as touching it. */
  lineBand: number
  /** Highlight the next square to hop to. */
  hints: boolean
}

export const LEVELS: LevelConfig[] = [
  { level: 1, name: "First Recess", targets: [1, 2, 3], scatter: 0.02, sway: 0, swaySpeed: 0, wind: 0, hopTime: 6, lineBand: 0.06, hints: true },
  { level: 2, name: "Sandals Off", targets: [4, 6, 5], scatter: 0.03, sway: 0.06, swaySpeed: 0.6, wind: 0, hopTime: 5, lineBand: 0.07, hints: true },
  { level: 3, name: "Compound Champ", targets: [7, 8, 9], scatter: 0.04, sway: 0.1, swaySpeed: 0.7, wind: 0, hopTime: 4.5, lineBand: 0.07, hints: false },
  { level: 4, name: "Harmattan Breeze", targets: [2, 5, 8, 9], scatter: 0.05, sway: 0.1, swaySpeed: 0.8, wind: 0.15, hopTime: 4, lineBand: 0.08, hints: false },
  { level: 5, name: "Market Day", targets: [3, 6, 9, 4], scatter: 0.05, sway: 0.13, swaySpeed: 0.9, wind: 0.2, hopTime: 3.6, lineBand: 0.08, hints: false },
  { level: 6, name: "Rainy Season", targets: [7, 4, 8, 5], scatter: 0.06, sway: 0.15, swaySpeed: 1.0, wind: 0.22, hopTime: 3.2, lineBand: 0.09, hints: false },
  { level: 7, name: "Street Legend", targets: [9, 8, 7, 6, 5], scatter: 0.07, sway: 0.17, swaySpeed: 1.1, wind: 0.26, hopTime: 2.9, lineBand: 0.09, hints: false },
  { level: 8, name: "Owambe Ready", targets: [1, 9, 2, 8, 5], scatter: 0.08, sway: 0.19, swaySpeed: 1.25, wind: 0.3, hopTime: 2.6, lineBand: 0.1, hints: false },
  { level: 9, name: "Area Favourite", targets: [6, 4, 9, 7, 3, 8], scatter: 0.09, sway: 0.21, swaySpeed: 1.4, wind: 0.33, hopTime: 2.3, lineBand: 0.1, hints: false },
  { level: 10, name: "Suwe Oga", targets: [9, 7, 8, 5, 4, 6], scatter: 0.1, sway: 0.24, swaySpeed: 1.6, wind: 0.36, hopTime: 2.0, lineBand: 0.11, hints: false },
]

/** A forgiving one-round level for the interactive tutorial. Faults never cost lives here. */
export const TUTORIAL_LEVEL: LevelConfig = {
  level: 0,
  name: "Tutorial",
  targets: [2],
  scatter: 0,
  sway: 0,
  swaySpeed: 0,
  wind: 0,
  hopTime: null,
  lineBand: 0.05,
  hints: true,
}

export const STARTING_LIVES = 3
