import type { PlatformStatus, PlayerInfo } from "../platform/platform"
import { type VatarPurchaseRef, errorCode } from "../platform/vatar-types"
import type { ShopApi } from "./api"

export const CHALK_PACK = {
  id: "chalk_pack",
  name: "Colourful Chalk Pack",
  /** Shown in the game; the pay sheet shows the authoritative price from Vatar's records. */
  price: "₦100",
  description: "Unlock colourful chalk colours for your Suwe board.",
} as const

/** The documented SDK calls the shop needs (provided by the Platform adapter). */
export interface ShopPlatform {
  connect(): Promise<PlatformStatus>
  readonly status: PlatformStatus
  readonly player: PlayerInfo | null
  sessionToken(): Promise<string>
  purchase(productId: string): Promise<VatarPurchaseRef>
  pendingPurchases(): Promise<VatarPurchaseRef[]>
  onPurchase(fn: (p: VatarPurchaseRef) => void): () => void
}

export interface OwnershipCache {
  get(key: string): string[]
  set(key: string, products: string[]): void
}

/**
 * - checking: asking our server what this player owns
 * - owned / not-owned: the server's answer (or, briefly, a cached earlier server answer)
 * - unavailable: outside Lagos Life, or the platform couldn't connect — purchases aren't possible
 */
export type Ownership = "checking" | "owned" | "not-owned" | "unavailable"

export type ShopFlow =
  | { kind: "idle" }
  | { kind: "paying" } // Vatar's pay sheet is open
  | { kind: "verifying" } // Vatar confirmed payment; our server is checking and delivering
  | { kind: "success" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string; canRetry: boolean }

export interface ShopState {
  ownership: Ownership
  flow: ShopFlow
  /** Our purchase server couldn't be reached; buying is paused so nobody pays for something we can't deliver. */
  serviceDown: boolean
  /** A paid purchase that our server hasn't been able to confirm yet. */
  unconfirmed: boolean
  message: string | null
}

export interface ShopOptions {
  sleep?: (ms: number) => Promise<void>
}

const VERIFY_ATTEMPTS = 3
const BACKOFF_MS = [1500, 4000]

const PURCHASE_ERRORS: Record<string, string> = {
  payment_failed: "The payment didn't go through, so the pack wasn't unlocked. You can try again.",
  busy: "A payment sheet is already open.",
  not_for_sale: "The Colourful Chalk Pack isn't on sale right now.",
  rate_limited: "Please wait a few seconds and try again.",
  signed_out: "Sign in to Lagos Life to buy the pack.",
  off: "Purchases are switched off for Suwe right now.",
  error: "Something went wrong with the purchase. Please try again.",
}

const CLAIM_ERRORS: Record<string, string> = {
  refunded: "This purchase was refunded, so the pack can't be unlocked with it.",
  not_your_purchase: "This purchase belongs to a different player, so it can't unlock the pack here.",
  wrong_product: "That purchase isn't for the Colourful Chalk Pack.",
  bad_request: "Something went wrong confirming the purchase.",
}

/**
 * The Colourful Chalk Pack purchase flow. The pack is unlocked only when OUR SERVER says the
 * purchase is verified and delivered (or that this player already owns it) — never because
 * Vatar.purchase() resolved or a button was pressed.
 */
export class ChalkShop {
  private s: ShopState = { ownership: "checking", flow: { kind: "idle" }, serviceDown: false, unconfirmed: false, message: null }
  private listeners = new Set<(s: ShopState) => void>()
  private verifying = new Map<string, Promise<boolean>>()
  private unconfirmedIds = new Set<string>()
  private started: Promise<void> | null = null
  private key: string | null = null
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly platform: ShopPlatform,
    private readonly api: ShopApi,
    private readonly cache: OwnershipCache,
    opts: ShopOptions = {},
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)))
  }

  get state(): Readonly<ShopState> {
    return this.s
  }

  get owned(): boolean {
    return this.s.ownership === "owned"
  }

  onChange(fn: (s: ShopState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Recheck ownership and restore interrupted purchases. Safe to call more than once. */
  start(): Promise<void> {
    this.started ??= this.doStart()
    return this.started
  }

  private async doStart(): Promise<void> {
    const status = await this.platform.connect()
    const player = this.platform.player
    if (status.state !== "connected" || !player || !status.mode) {
      this.set({
        ownership: "unavailable",
        message: status.state === "local" ? "Purchases work when you play Suwe inside Lagos Life." : "Purchases aren't available right now.",
      })
      return
    }
    this.key = `${status.mode}:${player.id}`
    // A previous server answer shows a returning owner's colours immediately; the server re-check
    // below then confirms or corrects it.
    if (this.cache.get(this.key).includes(CHALK_PACK.id)) this.set({ ownership: "owned" })
    // Paid while no purchase() was waiting (e.g. after paying on the provider's page).
    this.platform.onPurchase((p) => {
      if (p.productId === CHALK_PACK.id) void this.verify(p.purchaseId, false)
    })
    await Promise.all([this.refreshOwnership(), this.restorePending()])
  }

  /** Ask our server what this player owns (works across devices; delivered purchases leave Vatar.purchases()). */
  async refreshOwnership(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let session: string
      try {
        session = await this.platform.sessionToken()
      } catch {
        break
      }
      const r = await this.api.entitlements(session)
      if (r.ok) {
        const owned = r.data.owned.includes(CHALK_PACK.id)
        if (this.key) this.cache.set(this.key, r.data.owned)
        // Never downgrade an ownership a claim just confirmed in this session.
        this.set({ ownership: owned || this.s.flow.kind === "success" ? "owned" : "not-owned", serviceDown: false })
        return
      }
      if (r.error !== "session_invalid") break
    }
    // Server unreachable: keep a cached "owned" (cosmetic), otherwise pause buying.
    this.set({ ownership: this.s.ownership === "owned" ? "owned" : "not-owned", serviceDown: true })
  }

  /** Claim paid purchases that were never delivered (crash, reload, verification outage). */
  async restorePending(): Promise<void> {
    let pending: VatarPurchaseRef[]
    try {
      pending = await this.platform.pendingPurchases()
    } catch {
      return
    }
    await Promise.all(pending.filter((p) => p.productId === CHALK_PACK.id).map((p) => this.verify(p.purchaseId, false)))
  }

  /** Open Vatar's pay sheet for the pack. */
  async buy(): Promise<void> {
    const busy = this.s.flow.kind === "paying" || this.s.flow.kind === "verifying"
    if (busy || this.s.ownership === "owned" || this.s.ownership === "unavailable" || this.s.ownership === "checking" || this.s.serviceDown) return
    this.set({ flow: { kind: "paying" } })
    let ref: VatarPurchaseRef
    try {
      ref = await this.platform.purchase(CHALK_PACK.id)
    } catch (e) {
      await this.handlePurchaseError(errorCode(e))
      return
    }
    if (ref.productId !== CHALK_PACK.id) {
      this.set({ flow: { kind: "error", message: PURCHASE_ERRORS.error, canRetry: false } })
      return
    }
    this.set({ flow: { kind: "verifying" } })
    await this.verify(ref.purchaseId, true)
  }

  /** "Try again" after a verification problem or a server outage. */
  async retry(): Promise<void> {
    if (this.s.flow.kind === "paying" || this.s.flow.kind === "verifying") return
    const ids = [...this.unconfirmedIds]
    if (ids.length) this.set({ flow: { kind: "verifying" } })
    else if (this.s.flow.kind === "error") this.set({ flow: { kind: "idle" } })
    await Promise.all([this.refreshOwnership(), this.restorePending(), ...ids.map((id) => this.verify(id, ids.length > 0))])
    if (this.flowKind() === "verifying") {
      this.set({ flow: this.owned ? { kind: "success" } : { kind: "error", message: this.unconfirmedMessage(), canRetry: true } })
    }
  }

  /** Current flow kind (a method, so TypeScript doesn't keep a narrowing across awaits). */
  private flowKind(): ShopFlow["kind"] {
    return this.s.flow.kind
  }

  dismiss(): void {
    if (this.s.flow.kind !== "paying" && this.s.flow.kind !== "verifying") this.set({ flow: { kind: "idle" } })
  }

  private async handlePurchaseError(code: string): Promise<void> {
    if (code === "cancelled") return this.set({ flow: { kind: "cancelled" } })
    if (code === "not_framed") return this.set({ flow: { kind: "idle" }, ownership: "unavailable", message: "Purchases work when you play Suwe inside Lagos Life." })
    if (code === "owned" || code === "timeout") {
      // owned: Vatar says this player already bought it — find and confirm it.
      // timeout: we don't know whether they paid — check for a paid, undelivered purchase.
      this.set({ flow: { kind: "verifying" } })
      await Promise.all([this.refreshOwnership(), this.restorePending()])
      if (this.owned) return this.set({ flow: { kind: "success" } })
      const message =
        code === "owned"
          ? "Lagos Life says you already own the pack, but we couldn't confirm it yet. Please try again in a moment."
          : "We didn't hear back from Lagos Life. If you paid, your colours will unlock automatically — or tap Try again."
      return this.set({ flow: { kind: "error", message, canRetry: true } })
    }
    this.set({ flow: { kind: "error", message: PURCHASE_ERRORS[code] ?? PURCHASE_ERRORS.error, canRetry: false } })
  }

  /**
   * Ask our server to verify and deliver one purchase. Concurrent calls for the same purchase share
   * one request. Returns true once the server confirms ownership.
   */
  private verify(purchaseId: string, userInitiated: boolean): Promise<boolean> {
    let p = this.verifying.get(purchaseId)
    if (!p) {
      p = this.doVerify(purchaseId).finally(() => this.verifying.delete(purchaseId))
      this.verifying.set(purchaseId, p)
    }
    return p.then((ok) => {
      if (userInitiated || this.s.flow.kind === "verifying") {
        if (ok) this.set({ flow: { kind: "success" } })
        else if (this.s.flow.kind !== "error") this.set({ flow: { kind: "error", message: this.lastClaimMessage ?? this.unconfirmedMessage(), canRetry: this.unconfirmedIds.has(purchaseId) } })
      }
      return ok
    })
  }

  private lastClaimMessage: string | null = null

  private async doVerify(purchaseId: string): Promise<boolean> {
    this.lastClaimMessage = null
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
      let session: string
      try {
        session = await this.platform.sessionToken()
      } catch {
        break
      }
      const r = await this.api.claim(session, purchaseId)
      if (r.ok) {
        this.unconfirmedIds.delete(purchaseId)
        this.grantConfirmed()
        return true
      }
      if (r.error === "session_invalid") continue // token expired between calls: get a fresh one
      if (Object.hasOwn(CLAIM_ERRORS, r.error)) {
        // Final answer from our server: this purchase can't unlock the pack.
        this.unconfirmedIds.delete(purchaseId)
        this.lastClaimMessage = CLAIM_ERRORS[r.error] ?? "We couldn't confirm this purchase. The pack is still locked."
        this.set({ unconfirmed: this.unconfirmedIds.size > 0 })
        return false
      }
      // Anything else (outage, rate limit, not configured, unexpected reply) leaves the purchase
      // paid-but-unconfirmed: never a final "no".
      if (!r.retryable) break
      if (attempt < VERIFY_ATTEMPTS - 1) await this.sleep(Math.max(BACKOFF_MS[attempt] ?? 4000, (r.retryAfter ?? 0) * 1000))
    }
    // Paid but not yet confirmed. It stays in Vatar.purchases() until delivered, so it is retried
    // automatically next start; the player can also tap Try again.
    this.unconfirmedIds.add(purchaseId)
    this.set({ unconfirmed: true })
    return false
  }

  private grantConfirmed(): void {
    if (this.key) {
      const owned = new Set(this.cache.get(this.key))
      owned.add(CHALK_PACK.id)
      this.cache.set(this.key, [...owned])
    }
    this.set({ ownership: "owned", unconfirmed: this.unconfirmedIds.size > 0, serviceDown: false })
  }

  private unconfirmedMessage(): string {
    return "Your payment went through, but we couldn't confirm it yet. Your colours will unlock automatically next time you open Suwe — or tap Try again."
  }

  private set(patch: Partial<ShopState>): void {
    this.s = { ...this.s, ...patch }
    for (const fn of this.listeners) fn(this.s)
  }
}
