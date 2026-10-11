/**
 * All score maths lives here so it can be tuned and tested in one place.
 *
 *  - A valid throw scores 50-150 depending on accuracy.
 *  - Each clean hop scores 10, plus up to 10 more for hopping before the balance meter runs low.
 *  - Finishing the course scores 100.
 *  - Every award is multiplied by the level multiplier (+10% per level) and the clean-round streak
 *    multiplier (+25% per consecutive fault-free round, capped at x2).
 *  - Finishing a level adds 200 x level, plus 150 x level if no life was lost on it.
 */
export const THROW_BASE = 50
export const THROW_ACCURACY_BONUS = 100
export const HOP_BASE = 10
export const HOP_QUICK_BONUS = 10
export const COURSE_BONUS = 100
export const LEVEL_BONUS_PER_LEVEL = 200
export const FLAWLESS_BONUS_PER_LEVEL = 150
export const STREAK_STEP = 0.25
export const STREAK_CAP = 2

export function levelMultiplier(level: number): number {
  return 1 + Math.max(0, level - 1) * 0.1
}

export function streakMultiplier(cleanStreak: number): number {
  return Math.min(STREAK_CAP, 1 + Math.max(0, cleanStreak) * STREAK_STEP)
}

function award(points: number, level: number, streak: number): number {
  return Math.round(points * levelMultiplier(level) * streakMultiplier(streak))
}

export function throwPoints(accuracy: number, level: number, streak: number): number {
  const a = Math.max(0, Math.min(1, accuracy))
  return award(THROW_BASE + THROW_ACCURACY_BONUS * a, level, streak)
}

/** @param balanceLeft fraction (0..1) of the balance meter remaining when the hop landed; 0 when untimed. */
export function hopPoints(balanceLeft: number, level: number, streak: number): number {
  const b = Math.max(0, Math.min(1, balanceLeft))
  return award(HOP_BASE + HOP_QUICK_BONUS * b, level, streak)
}

export function coursePoints(level: number, streak: number): number {
  return award(COURSE_BONUS, level, streak)
}

export function levelCompletePoints(level: number, livesLostThisLevel: number): { level: number; flawless: number } {
  return {
    level: LEVEL_BONUS_PER_LEVEL * level,
    flawless: livesLostThisLevel === 0 ? FLAWLESS_BONUS_PER_LEVEL * level : 0,
  }
}

/** 1-3 stars for the level-complete screen. */
export function starsFor(livesLostThisLevel: number, averageAccuracy: number): 1 | 2 | 3 {
  if (livesLostThisLevel === 0 && averageAccuracy >= 0.55) return 3
  if (livesLostThisLevel <= 1) return 2
  return 1
}
