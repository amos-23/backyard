/**
 * Client for Suwe's own purchase endpoints (Netlify Functions). The browser never talks to the
 * Vatar API directly: it sends a short-lived session token and a purchase id, and our server does
 * the checking with the secret key.
 */
export interface ClaimData {
  productId: string
  owned: true
  delivered: boolean
  alreadyClaimed: boolean
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; retryable: boolean; retryAfter?: number }

export interface ShopApi {
  claim(session: string, purchaseId: string): Promise<ApiResult<ClaimData>>
  entitlements(session: string): Promise<ApiResult<{ owned: string[] }>>
}

const TIMEOUT_MS = 15_000

export function httpShopApi(base = "", fetchImpl: typeof fetch = (...a) => fetch(...a)): ShopApi {
  async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    let res: Response
    try {
      res = await fetchImpl(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      return { ok: false, status: 0, error: "network", retryable: true }
    }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      // Not our JSON: a rate limit or proxy error (worth retrying), or the dev server's HTML fallback.
      return { ok: false, status: res.status, error: "unavailable", retryable: res.status === 429 || res.status >= 500 }
    }
    const d = data as { ok?: unknown; error?: unknown; retryable?: unknown; retryAfter?: unknown }
    if (res.ok && d?.ok === true) return { ok: true, data: data as T }
    return {
      ok: false,
      status: res.status,
      error: typeof d?.error === "string" ? d.error : "unavailable",
      retryable: d?.retryable === true,
      retryAfter: typeof d?.retryAfter === "number" ? d.retryAfter : undefined,
    }
  }
  return {
    claim: (session, purchaseId) => post<ClaimData>("/api/claim", { session, purchaseId }),
    entitlements: (session) => post<{ owned: string[] }>("/api/entitlements", { session }),
  }
}
