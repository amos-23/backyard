import type { EntitlementStore } from "./entitlements.ts"
import { type VatarApi, VatarApiError } from "./vatar-api.ts"

/**
 * Products this server will deliver. Price, name and whether it's for sale come from Vatar's
 * records (set in the developer dashboard), never from here or from the game.
 */
export const PRODUCTS: Record<string, { name: string; oneOff: boolean }> = {
  chalk_pack: { name: "Colourful Chalk Pack", oneOff: true },
}

/** What the browser is told. Deliberately small: no amounts, player ids or Vatar internals. */
export type ClaimBody =
  | { ok: true; productId: string; owned: true; delivered: boolean; alreadyClaimed: boolean }
  | { ok: false; error: ClaimError; retryable: boolean; retryAfter?: number }

export type ClaimError =
  | "bad_request"
  | "session_invalid"
  | "purchase_not_found"
  | "not_your_purchase"
  | "wrong_product"
  | "refunded"
  | "not_configured"
  | "unavailable"

export interface Result<B> {
  status: number
  body: B
}

export interface Deps {
  api: VatarApi | null
  store: EntitlementStore
  now?: () => number
  log?: (msg: string) => void
}

// Sizes are generous: Vatar documents neither format, only examples.
const SESSION_MAX = 4096
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isValidSession(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= SESSION_MAX
}

export function isValidPurchaseId(v: unknown): v is string {
  return typeof v === "string" && ID_PATTERN.test(v)
}

const fail = (status: number, error: ClaimError, retryable = false, retryAfter?: number): Result<ClaimBody> => ({
  status,
  body: retryAfter ? { ok: false, error, retryable, retryAfter } : { ok: false, error, retryable },
})

/** Map a Vatar API refusal on the session check to our response. */
function sessionFailure(e: unknown): Result<ClaimBody> {
  if (e instanceof VatarApiError) {
    if (e.retryable) return fail(503, "unavailable", true, e.retryAfter ?? undefined)
    if (e.status === 401 && (e.code === "invalid_token" || e.code === "expired")) return fail(401, "session_invalid", true)
    if (e.code === "bad_secret") return fail(503, "not_configured")
    // wrong_game / wrong_mode / game_off and anything else: the token isn't valid for this server.
    return fail(403, "session_invalid")
  }
  return fail(503, "unavailable", true)
}

/**
 * POST /api/claim: check and deliver one purchase, following the documented lifecycle:
 *   1. POST /session/verify — who is asking
 *   2. GET  /purchases/{id} — is it real, paid, theirs, and for a product we sell
 *   3. give the item once per purchase id (our entitlement store)
 *   4. POST /purchases/{id}/deliver — mark it delivered (safe to repeat)
 */
export async function claimPurchase(deps: Deps, input: { session: unknown; purchaseId: unknown }): Promise<Result<ClaimBody>> {
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  if (!isValidSession(input.session) || !isValidPurchaseId(input.purchaseId)) return fail(400, "bad_request")
  if (!deps.api) return fail(503, "not_configured")
  const api = deps.api
  const purchaseId = input.purchaseId

  let me
  try {
    me = await api.verifySession(input.session)
  } catch (e) {
    return sessionFailure(e)
  }

  let purchase
  try {
    purchase = await api.getPurchase(purchaseId)
  } catch (e) {
    if (e instanceof VatarApiError) {
      if (e.retryable) return fail(503, "unavailable", true, e.retryAfter ?? undefined)
      // 404: unpaid, unknown, or another game's purchase. Not (yet) something we can deliver.
      if (e.status === 404) return fail(404, "purchase_not_found", true)
      if (e.code === "bad_secret") return fail(503, "not_configured")
      return fail(403, "not_your_purchase")
    }
    return fail(503, "unavailable", true)
  }

  if (purchase.id !== purchaseId || purchase.playerId !== me.playerId || purchase.mode !== me.mode) {
    log(`claim refused: purchase ${purchaseId} does not belong to the requesting player`)
    return fail(403, "not_your_purchase")
  }
  if (!Object.hasOwn(PRODUCTS, purchase.productId)) return fail(422, "wrong_product")
  if (purchase.status === "refunded") return fail(409, "refunded")
  if (purchase.status !== "paid" && purchase.status !== "delivered") return fail(404, "purchase_not_found", true)

  let grant
  try {
    grant = await deps.store.grant(me.mode, { purchaseId, playerId: me.playerId, productId: purchase.productId, grantedAt: now() })
  } catch {
    log(`claim: entitlement store unavailable for purchase ${purchaseId}`)
    return fail(503, "unavailable", true)
  }

  // Mark delivered. Safe to repeat; skipped when Vatar already shows it delivered. If it fails, the
  // item is still granted (it was verified as paid) and the purchase stays in Vatar.purchases(), so
  // the game claims it again next start and this step is retried.
  let delivered = purchase.status === "delivered"
  if (!delivered) {
    try {
      const d = await api.deliver(purchaseId)
      delivered = d.status === "delivered"
      if (delivered) await deps.store.markDelivered(me.mode, purchaseId, d.deliveredAt ?? now()).catch(() => {})
    } catch (e) {
      log(`claim: deliver failed for purchase ${purchaseId} (${e instanceof VatarApiError ? e.code : "error"}); will retry on next claim`)
    }
  }

  log(`claim ok: purchase ${purchaseId} ${grant.alreadyGranted ? "already granted" : "granted"}, delivered=${delivered}`)
  return { status: 200, body: { ok: true, productId: purchase.productId, owned: true, delivered, alreadyClaimed: grant.alreadyGranted } }
}

export type EntitlementsBody = { ok: true; owned: string[] } | { ok: false; error: ClaimError; retryable: boolean; retryAfter?: number }

/** POST /api/entitlements: what the verified player already owns (restores ownership on any device). */
export async function listEntitlements(deps: Deps, input: { session: unknown }): Promise<Result<EntitlementsBody>> {
  if (!isValidSession(input.session)) return { status: 400, body: { ok: false, error: "bad_request", retryable: false } }
  if (!deps.api) return { status: 503, body: { ok: false, error: "not_configured", retryable: false } }
  let me
  try {
    me = await deps.api.verifySession(input.session)
  } catch (e) {
    return sessionFailure(e) as Result<EntitlementsBody>
  }
  try {
    const owned = (await deps.store.owned(me.mode, me.playerId)).filter((id) => Object.hasOwn(PRODUCTS, id))
    return { status: 200, body: { ok: true, owned } }
  } catch {
    return { status: 503, body: { ok: false, error: "unavailable", retryable: true } }
  }
}
