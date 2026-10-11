/**
 * Types for the parts of the Vatar Games SDK v1 this game uses, as documented at
 * https://lagoslife.app/developers/docs and loaded from https://lagoslife.app/sdk/vatar-games-v1.js.
 * Purchases and matches exist in the SDK but are deliberately not used in this MVP.
 */
export interface VatarPlayer {
  /** Per-game pseudonym: p_… (live) or t_… (test). */
  id: string
  name: string
  /** Small PNG data URL, or null. */
  avatar: string | null
}

export interface VatarInitResult {
  player: VatarPlayer
  session: string
  mode: "live" | "test"
}

export interface VatarScoreResult {
  best: number
  accepted: boolean
}

export interface VatarLeaderboard {
  top: { rank: number; name: string; score: number }[]
  me: { rank: number | null; label: string; score: number } | null
}

export interface VatarSdk {
  version: string
  init(): Promise<VatarInitResult>
  submitScore(n: number): Promise<VatarScoreResult>
  leaderboard(): Promise<VatarLeaderboard>
  onPause(fn: () => void): () => void
  onResume(fn: () => void): () => void
}

/** SDK errors are Error objects with a `.code` from the documented list. */
export type VatarErrorCode =
  | "not_framed"
  | "timeout"
  | "rate_limited"
  | "off"
  | "signed_out"
  | "too_soon"
  | "bad_request"
  | "error"
  | (string & {})

export function errorCode(e: unknown): VatarErrorCode {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") return (e as { code: string }).code
  return "error"
}

declare global {
  interface Window {
    Vatar?: VatarSdk
  }
}
