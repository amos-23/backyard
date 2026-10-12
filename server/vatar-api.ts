/**
 * Server-side client for the Vatar Games API, exactly as documented at
 * https://lagoslife.app/developers/docs ("Your server: the API"). Runs only on the server: it needs
 * the game's secret key, which must never reach the browser.
 */
export const VATAR_API_BASE = "https://lagoslife.app/api/games/v1"

/** POST /session/verify → { playerId, name, gameId, exp, mode } */
export interface VerifiedSession {
  playerId: string
  name: string
  gameId: string
  exp: number
  mode: "live" | "test"
}

/** GET /purchases/{id} → { id, productId, playerId, amount, currency, status, createdAt, mode } */
export interface VatarPurchase {
  id: string
  productId: string
  playerId: string
  amount: number
  currency: string
  status: "paid" | "delivered" | "refunded"
  createdAt: number
  mode: "live" | "test"
}

/** POST /purchases/{id}/deliver → { id, status: "delivered", deliveredAt } */
export interface DeliveryResult {
  id: string
  status: "delivered"
  deliveredAt: number
}

/** An API refusal ({ error, message } with an HTTP status), or a network failure (status 0). */
export class VatarApiError extends Error {
  readonly status: number
  readonly code: string
  /** Seconds, from the Retry-After header on a 429. */
  readonly retryAfter: number | null

  constructor(status: number, code: string, retryAfter: number | null = null) {
    super(`Vatar API ${status} ${code}`)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }

  /** 429 rate_limited, 5xx and network failures are worth retrying later; everything else is final. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

export interface VatarApi {
  verifySession(session: string): Promise<VerifiedSession>
  getPurchase(id: string): Promise<VatarPurchase>
  deliver(id: string): Promise<DeliveryResult>
}

const TIMEOUT_MS = 6000

export function createVatarApi(secret: string, fetchImpl: typeof fetch = fetch, base: string = VATAR_API_BASE): VatarApi {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new VatarApiError(0, "network")
    }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const code = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "error"
      const retryAfter = Number(res.headers.get("Retry-After"))
      throw new VatarApiError(res.status, code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null)
    }
    return data as T
  }

  return {
    verifySession: (session) => call<VerifiedSession>("POST", "/session/verify", { session }),
    getPurchase: (id) => call<VatarPurchase>("GET", `/purchases/${encodeURIComponent(id)}`),
    // The docs' own server sample posts an empty JSON object; no fields are defined for this call.
    deliver: (id) => call<DeliveryResult>("POST", `/purchases/${encodeURIComponent(id)}/deliver`, {}),
  }
}
