import { describe, expect, it } from "vitest"
import { blobEntitlementStore, memoryBlobs } from "../server/entitlements.ts"
import { handleClaim, handleEntitlements } from "../server/http.ts"
import type { Deps } from "../server/purchases.ts"
import { VATAR_API_BASE, createVatarApi } from "../server/vatar-api.ts"
import { fakeVatar } from "./helpers/fake-vatar"

function setup() {
  const vatar = fakeVatar()
  vatar.sessions.set("sess_ada", { playerId: "t_ada", name: "Ada", mode: "test" })
  vatar.sessions.set("sess_bayo", { playerId: "t_bayo", name: "Bayo", mode: "test" })
  vatar.sessions.set("sess_old", { playerId: "t_ada", name: "Ada", mode: "test", expired: true })
  const blobs = memoryBlobs()
  const store = blobEntitlementStore(blobs)
  const deps: Deps = { api: createVatarApi(vatar.SECRET, vatar.fetchImpl as unknown as typeof fetch), store, now: () => 42 }
  const post = (path: "claim" | "entitlements", body: unknown) =>
    (path === "claim" ? handleClaim : handleEntitlements)(
      new Request(`https://suwe.test/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      deps,
    ).then(async (r) => ({ status: r.status, body: await r.json(), headers: r.headers }))
  return { vatar, blobs, store, deps, post }
}

describe("POST /api/claim", () => {
  it("verifies session and purchase, grants once and marks it delivered", async () => {
    const { vatar, post } = setup()
    vatar.addPurchase("pur_1")
    const r = await post("claim", { session: "sess_ada", purchaseId: "pur_1" })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, productId: "chalk_pack", owned: true, delivered: true, alreadyClaimed: false })
    expect(vatar.calls).toEqual(["POST /session/verify", "GET /purchases/pur_1", "POST /purchases/pur_1/deliver"])
    expect(vatar.purchases.get("pur_1")?.status).toBe("delivered")
    expect(r.headers.get("Cache-Control")).toBe("no-store")
    expect((await post("entitlements", { session: "sess_ada" })).body).toEqual({ ok: true, owned: ["chalk_pack"] })
  })

  it("is idempotent: repeating a claim never grants twice and doesn't re-deliver", async () => {
    const { vatar, post, blobs } = setup()
    vatar.addPurchase("pur_1")
    await post("claim", { session: "sess_ada", purchaseId: "pur_1" })
    const before = JSON.stringify([...blobs.data])
    const again = await post("claim", { session: "sess_ada", purchaseId: "pur_1" })
    expect(again.body).toMatchObject({ ok: true, owned: true, delivered: true, alreadyClaimed: true })
    expect(vatar.calls.filter((c) => c.endsWith("/deliver"))).toHaveLength(1)
    expect(JSON.stringify([...blobs.data])).toBe(before)
  })

  it("concurrent claims for one purchase grant exactly once", async () => {
    const { vatar, post } = setup()
    vatar.addPurchase("pur_1")
    const results = await Promise.all([1, 2, 3].map(() => post("claim", { session: "sess_ada", purchaseId: "pur_1" })))
    expect(results.every((r) => r.body.ok)).toBe(true)
    expect(results.filter((r) => r.body.alreadyClaimed === false)).toHaveLength(1)
  })

  it("refuses another player's purchase", async () => {
    const { vatar, post } = setup()
    vatar.addPurchase("pur_1", { playerId: "t_ada" })
    const r = await post("claim", { session: "sess_bayo", purchaseId: "pur_1" })
    expect(r).toMatchObject({ status: 403, body: { ok: false, error: "not_your_purchase" } })
    expect((await post("entitlements", { session: "sess_bayo" })).body.owned).toEqual([])
    expect(vatar.calls).not.toContain("POST /purchases/pur_1/deliver")
  })

  it("refuses refunded, unknown/unpaid and other-product purchases without granting", async () => {
    const { vatar, post } = setup()
    vatar.addPurchase("pur_refunded", { status: "refunded" })
    vatar.addPurchase("pur_other", { productId: "something_else" })
    vatar.addPurchase("pur_live", { mode: "live" })
    expect(await post("claim", { session: "sess_ada", purchaseId: "pur_refunded" })).toMatchObject({ status: 409, body: { error: "refunded" } })
    expect(await post("claim", { session: "sess_ada", purchaseId: "pur_missing" })).toMatchObject({ status: 404, body: { error: "purchase_not_found", retryable: true } })
    expect(await post("claim", { session: "sess_ada", purchaseId: "pur_other" })).toMatchObject({ status: 422, body: { error: "wrong_product" } })
    expect(await post("claim", { session: "sess_ada", purchaseId: "pur_live" })).toMatchObject({ status: 403, body: { error: "not_your_purchase" } })
    expect((await post("entitlements", { session: "sess_ada" })).body.owned).toEqual([])
    expect(vatar.calls.some((c) => c.endsWith("/deliver"))).toBe(false)
  })

  it("rejects invalid and expired sessions", async () => {
    const { vatar, post } = setup()
    vatar.addPurchase("pur_1")
    expect(await post("claim", { session: "forged", purchaseId: "pur_1" })).toMatchObject({ status: 401, body: { error: "session_invalid", retryable: true } })
    expect(await post("claim", { session: "sess_old", purchaseId: "pur_1" })).toMatchObject({ status: 401, body: { error: "session_invalid" } })
    expect(vatar.calls.filter((c) => c.startsWith("GET"))).toHaveLength(0)
  })

  it("validates input before calling Vatar", async () => {
    const { vatar, post } = setup()
    for (const body of [{}, { session: "sess_ada" }, { session: "sess_ada", purchaseId: "../../x" }, { session: 5, purchaseId: "p" }, { session: "x".repeat(5000), purchaseId: "p" }]) {
      expect((await post("claim", body)).status).toBe(400)
    }
    expect(vatar.calls).toHaveLength(0)
  })

  it("rejects non-POST, non-JSON and oversized requests", async () => {
    const { deps } = setup()
    expect((await handleClaim(new Request("https://x/api/claim"), deps)).status).toBe(405)
    expect((await handleClaim(new Request("https://x/api/claim", { method: "POST", body: "a=b", headers: { "Content-Type": "text/plain" } }), deps)).status).toBe(415)
    const big = JSON.stringify({ session: "s", purchaseId: "p", pad: "x".repeat(9000) })
    expect((await handleClaim(new Request("https://x/api/claim", { method: "POST", body: big, headers: { "Content-Type": "application/json" } }), deps)).status).toBe(413)
    expect((await handleClaim(new Request("https://x/api/claim", { method: "POST", body: "{nope", headers: { "Content-Type": "application/json" } }), deps)).status).toBe(400)
  })

  it("reports Vatar outages and rate limits as retryable without granting", async () => {
    const { vatar, post } = setup()
    vatar.addPurchase("pur_1")
    vatar.setOutage(429)
    expect(await post("claim", { session: "sess_ada", purchaseId: "pur_1" })).toMatchObject({ status: 503, body: { error: "unavailable", retryable: true, retryAfter: 7 } })
    vatar.setOutage(500)
    expect(await post("claim", { session: "sess_ada", purchaseId: "pur_1" })).toMatchObject({ status: 503, body: { retryable: true } })
    vatar.setOutage(null)
    expect((await post("entitlements", { session: "sess_ada" })).body.owned).toEqual([])
  })

  it("still grants a verified purchase when marking delivered fails, and delivers on the retry", async () => {
    const { vatar, post } = setup()
    vatar.addPurchase("pur_1")
    vatar.setDeliverOutage(true)
    const first = await post("claim", { session: "sess_ada", purchaseId: "pur_1" })
    expect(first.body).toMatchObject({ ok: true, owned: true, delivered: false, alreadyClaimed: false })
    expect(vatar.purchases.get("pur_1")?.status).toBe("paid") // still listed by Vatar.purchases()
    vatar.setDeliverOutage(false)
    const retry = await post("claim", { session: "sess_ada", purchaseId: "pur_1" })
    expect(retry.body).toMatchObject({ ok: true, delivered: true, alreadyClaimed: true })
    expect(vatar.purchases.get("pur_1")?.status).toBe("delivered")
  })

  it("answers not_configured when the server has no Vatar secret", async () => {
    const { deps } = setup()
    const req = new Request("https://x/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session: "s", purchaseId: "p" }) })
    const r = await handleClaim(req, { ...deps, api: null })
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ error: "not_configured" })
  })

  it("answers not_configured for a wrong or rotated secret", async () => {
    const { vatar, deps } = setup()
    vatar.addPurchase("pur_1")
    const wrong = { ...deps, api: createVatarApi("vtr_test_wrong", vatar.fetchImpl as unknown as typeof fetch) }
    const req = new Request("https://x/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session: "sess_ada", purchaseId: "pur_1" }) })
    expect(await (await handleClaim(req, wrong)).json()).toMatchObject({ error: "not_configured" })
  })

  it("never puts the secret or player ids in responses", async () => {
    const { vatar, post } = setup()
    vatar.addPurchase("pur_1")
    const r = await post("claim", { session: "sess_ada", purchaseId: "pur_1" })
    const text = JSON.stringify(r.body)
    expect(text).not.toContain(vatar.SECRET)
    expect(text).not.toContain("t_ada")
    expect(text).not.toContain("amount")
  })

  it("calls the documented API base", () => {
    expect(VATAR_API_BASE).toBe("https://lagoslife.app/api/games/v1")
  })
})
