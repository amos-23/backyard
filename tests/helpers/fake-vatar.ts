import type { VatarPurchase } from "../../server/vatar-api.ts"

/**
 * A stand-in for Vatar's server implementing the documented contract
 * (https://lagoslife.app/developers/docs, "Your server: the API" and "Error codes"):
 * Bearer secret, POST /session/verify, GET /purchases/{id}, POST /purchases/{id}/deliver,
 * errors as { error, message } with the documented statuses.
 */
export function fakeVatar() {
  const SECRET = "vtr_test_fake_for_tests"
  const sessions = new Map<string, { playerId: string; name: string; mode: "test" | "live"; expired?: boolean }>()
  const purchases = new Map<string, VatarPurchase>()
  const calls: string[] = []
  let outage: number | null = null
  let deliverOutage = false
  const err = (status: number, error: string, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error, message: error }), { status, headers: { "Content-Type": "application/json", ...headers } })
  const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })

  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const path = u.pathname.replace("/api/games/v1", "")
    const method = init?.method ?? "GET"
    calls.push(`${method} ${path}`)
    if (outage) return err(outage, outage === 429 ? "rate_limited" : "error", outage === 429 ? { "Retry-After": "7" } : {})
    if (new Headers(init?.headers).get("Authorization") !== `Bearer ${SECRET}`) return err(401, "bad_secret")
    if (method === "POST" && path === "/session/verify") {
      const body = JSON.parse(String(init?.body ?? "{}"))
      const s = sessions.get(body.session)
      if (!s) return err(401, "invalid_token")
      if (s.expired) return err(401, "expired")
      return ok({ playerId: s.playerId, name: s.name, gameId: "game_1", exp: Date.now() + 900_000, mode: s.mode })
    }
    const m = path.match(/^\/purchases\/([^/]+)(\/deliver)?$/)
    if (m) {
      const p = purchases.get(decodeURIComponent(m[1]))
      if (!p) return err(404, "not_found")
      if (method === "GET" && !m[2]) return ok(p)
      if (method === "POST" && m[2]) {
        if (deliverOutage) return err(500, "error")
        if (p.status === "refunded") return err(409, "refunded")
        p.status = "delivered"
        return ok({ id: p.id, status: "delivered", deliveredAt: 1_800_000_000_000 })
      }
    }
    return err(404, "not_found")
  }

  return {
    SECRET,
    fetchImpl,
    calls,
    sessions,
    purchases,
    setOutage: (s: number | null) => (outage = s),
    setDeliverOutage: (v: boolean) => (deliverOutage = v),
    addPurchase(id: string, over: Partial<VatarPurchase> = {}) {
      purchases.set(id, { id, productId: "chalk_pack", playerId: "t_ada", amount: 100, currency: "NGN", status: "paid", createdAt: 1, mode: "test", ...over })
    },
  }
}

