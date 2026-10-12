import { describe, expect, it, vi } from "vitest"
import { blobEntitlementStore, memoryBlobs } from "../server/entitlements.ts"
import { handleClaim, handleEntitlements } from "../server/http.ts"
import type { Deps } from "../server/purchases.ts"
import { createVatarApi } from "../server/vatar-api.ts"
import { effectiveChalk } from "../src/config/chalk"
import { Platform } from "../src/platform/platform"
import type { VatarSdk } from "../src/platform/vatar-types"
import { httpShopApi } from "../src/shop/api"
import { CHALK_PACK, ChalkShop, type OwnershipCache } from "../src/shop/chalk-shop"
import { fakeVatar } from "./helpers/fake-vatar"
import { fakeSdk } from "./helpers/fake-sdk"

const sdkError = (code: string) => Object.assign(new Error(`Vatar: ${code}`), { code })

/**
 * The real client shop, talking to the real server handlers in-process. Only Vatar is faked: its
 * SDK (purchase/purchases/session) and its documented HTTP API share one set of purchase records.
 */
function world() {
  const vatar = fakeVatar()
  vatar.sessions.set("sess_ada", { playerId: "t_ada", name: "Ada", mode: "test" })
  const blobs = memoryBlobs()
  const deps: Deps = { api: createVatarApi(vatar.SECRET, vatar.fetchImpl as unknown as typeof fetch), store: blobEntitlementStore(blobs) }
  const server = { down: false, calls: [] as string[] }
  const apiFetch = (async (url: string, init?: RequestInit) => {
    server.calls.push(url)
    if (server.down) throw new TypeError("Failed to fetch")
    const req = new Request(`https://suwe.test${url}`, init)
    return url === "/api/claim" ? handleClaim(req, deps) : handleEntitlements(req, deps)
  }) as unknown as typeof fetch

  let n = 0
  function device(sdkOverrides: Partial<VatarSdk> = {}) {
    const sdk = fakeSdk({
      init: vi.fn(async () => ({ player: { id: "t_ada", name: "Ada", avatar: null }, session: "sess_ada", mode: "test" as const })),
      session: vi.fn(async () => ({ session: "sess_ada", exp: Date.now() + 900_000 })),
      purchase: vi.fn(async (productId: string) => {
        const id = `pur_${++n}`
        vatar.addPurchase(id, { productId })
        return { purchaseId: id, productId }
      }),
      purchases: vi.fn(async () =>
        [...vatar.purchases.values()].filter((p) => p.status === "paid" && p.playerId === "t_ada").map((p) => ({ purchaseId: p.id, productId: p.productId })),
      ),
      ...sdkOverrides,
    })
    const cacheData = new Map<string, string[]>()
    const cache: OwnershipCache = { get: (k) => cacheData.get(k) ?? [], set: (k, v) => void cacheData.set(k, v) }
    const shop = new ChalkShop(new Platform(sdk, () => []), httpShopApi("", apiFetch), cache, { sleep: async () => {} })
    return { sdk, shop, cacheData }
  }
  return { vatar, server, blobs, device }
}

const delivers = (vatar: ReturnType<typeof fakeVatar>) => vatar.calls.filter((c) => c.endsWith("/deliver")).length

describe("Colourful Chalk Pack purchase flow", () => {
  it("unlocks only after the server verifies and delivers a successful purchase", async () => {
    const w = world()
    const { shop, sdk, cacheData } = w.device()
    await shop.start()
    expect(shop.state.ownership).toBe("not-owned")
    const seen: string[] = []
    shop.onChange((s) => seen.push(`${s.flow.kind}:${s.ownership}`))
    await shop.buy()
    expect(sdk.purchase).toHaveBeenCalledWith("chalk_pack")
    expect(shop.state).toMatchObject({ ownership: "owned", flow: { kind: "success" } })
    // While paying and verifying, the pack was still locked.
    expect(seen).toContain("paying:not-owned")
    expect(seen).toContain("verifying:not-owned")
    expect(w.vatar.purchases.get("pur_1")?.status).toBe("delivered")
    expect(w.vatar.calls).toContain("GET /purchases/pur_1")
    expect(cacheData.get("test:t_ada")).toEqual(["chalk_pack"])
  })

  it("a cancelled payment unlocks nothing and calls no server", async () => {
    const w = world()
    const { shop } = w.device({ purchase: vi.fn().mockRejectedValue(sdkError("cancelled")) })
    await shop.start()
    const before = w.server.calls.length
    await shop.buy()
    expect(shop.state).toMatchObject({ ownership: "not-owned", flow: { kind: "cancelled" } })
    expect(w.server.calls.length).toBe(before)
  })

  it("a failed payment unlocks nothing", async () => {
    const w = world()
    const { shop } = w.device({ purchase: vi.fn().mockRejectedValue(sdkError("payment_failed")) })
    await shop.start()
    await shop.buy()
    expect(shop.state.ownership).toBe("not-owned")
    expect(shop.state.flow).toMatchObject({ kind: "error", message: expect.stringMatching(/didn't go through/) })
  })

  it("does not unlock when the server can't verify, then unlocks on retry", async () => {
    const w = world()
    const { shop } = w.device()
    await shop.start()
    w.server.down = true
    await shop.buy()
    expect(shop.state).toMatchObject({ ownership: "not-owned", unconfirmed: true, flow: { kind: "error", canRetry: true } })
    expect(w.vatar.purchases.get("pur_1")?.status).toBe("paid")
    w.server.down = false
    await shop.retry()
    expect(shop.state).toMatchObject({ ownership: "owned", unconfirmed: false, flow: { kind: "success" } })
    expect(w.vatar.purchases.get("pur_1")?.status).toBe("delivered")
  })

  it("refuses to unlock with a purchase the server rejects (refunded)", async () => {
    const w = world()
    const { shop } = w.device({
      purchase: vi.fn(async () => {
        w.vatar.addPurchase("pur_r", { status: "refunded" })
        return { purchaseId: "pur_r", productId: "chalk_pack" }
      }),
    })
    await shop.start()
    await shop.buy()
    expect(shop.state.ownership).toBe("not-owned")
    expect(shop.state.flow).toMatchObject({ kind: "error", message: expect.stringMatching(/refunded/) })
  })

  it("restores ownership for a returning owner on a new device (purchase already delivered)", async () => {
    const w = world()
    const first = w.device()
    await first.shop.start()
    await first.shop.buy()
    const second = w.device() // empty local cache, empty Vatar.purchases()
    await second.shop.start()
    expect(await second.sdk.purchases()).toEqual([])
    expect(second.shop.state.ownership).toBe("owned")
    expect(delivers(w.vatar)).toBe(1)
  })

  it("restores a paid purchase interrupted before delivery (crash or reload)", async () => {
    const w = world()
    w.vatar.addPurchase("pur_crash")
    const { shop } = w.device()
    await shop.start()
    expect(shop.state.ownership).toBe("owned")
    expect(w.vatar.purchases.get("pur_crash")?.status).toBe("delivered")
  })

  it("claims a purchase announced by onPurchase (paid on the provider's page)", async () => {
    const w = world()
    const { shop, sdk } = w.device()
    await shop.start()
    w.vatar.addPurchase("pur_away")
    sdk.purchased({ purchaseId: "pur_away", productId: "chalk_pack" })
    await vi.waitFor(() => expect(shop.state.ownership).toBe("owned"))
    expect(w.vatar.purchases.get("pur_away")?.status).toBe("delivered")
  })

  it("repeated notifications for one purchase deliver once and grant once", async () => {
    const w = world()
    w.vatar.addPurchase("pur_dup")
    const { shop, sdk } = w.device()
    const started = shop.start()
    sdk.purchased({ purchaseId: "pur_dup", productId: "chalk_pack" })
    sdk.purchased({ purchaseId: "pur_dup", productId: "chalk_pack" })
    await started
    await vi.waitFor(() => expect(shop.state.ownership).toBe("owned"))
    expect(delivers(w.vatar)).toBe(1)
    const grants = [...w.blobs.data.keys()].filter((k) => k.startsWith("test/purchases/"))
    expect(grants).toEqual(["test/purchases/pur_dup"])
  })

  it("never offers the pay sheet to an owner, and recovers from the SDK's 'owned' answer", async () => {
    const w = world()
    w.vatar.addPurchase("pur_old")
    const owner = w.device()
    await owner.shop.start()
    await owner.shop.buy()
    expect(owner.sdk.purchase).not.toHaveBeenCalled()

    // A device whose server check failed at start, then Vatar answers "owned" to the purchase.
    const other = w.device({ purchase: vi.fn().mockRejectedValue(sdkError("owned")) })
    w.server.down = true
    await other.shop.start()
    expect(other.shop.state.serviceDown).toBe(true)
    w.server.down = false
    await other.shop.retry()
    expect(other.shop.state.ownership).toBe("owned")
  })

  it("pauses buying while the purchase server is unreachable", async () => {
    const w = world()
    w.server.down = true
    const { shop, sdk } = w.device()
    await shop.start()
    expect(shop.state).toMatchObject({ ownership: "not-owned", serviceDown: true })
    await shop.buy()
    expect(sdk.purchase).not.toHaveBeenCalled()
  })

  it("corrects a tampered local cache from the server's answer", async () => {
    const w = world()
    const d = w.device()
    d.cacheData.set("test:t_ada", ["chalk_pack"])
    await d.shop.start()
    expect(d.shop.state.ownership).toBe("not-owned")
    expect(effectiveChalk("rainbow", d.shop.owned).id).toBe("classic")
  })

  it("is unavailable outside Lagos Life and never opens a pay sheet", async () => {
    const w = world()
    const { shop, sdk } = w.device({ init: vi.fn().mockRejectedValue(sdkError("not_framed")) })
    await shop.start()
    expect(shop.state.ownership).toBe("unavailable")
    await shop.buy()
    expect(sdk.purchase).not.toHaveBeenCalled()
  })

  it("uses the agreed product details", () => {
    expect(CHALK_PACK).toMatchObject({ id: "chalk_pack", name: "Colourful Chalk Pack", price: "₦100", description: "Unlock colourful chalk colours for your Suwe board." })
  })
})

describe("chalk palettes", () => {
  it("only render premium colours when the pack is owned", () => {
    expect(effectiveChalk("lagoon", false).id).toBe("classic")
    expect(effectiveChalk("lagoon", true).id).toBe("lagoon")
    expect(effectiveChalk("classic", false).id).toBe("classic")
    expect(effectiveChalk("nonsense", true).id).toBe("classic")
  })
})

describe("purchase verification resilience", () => {
  it("keeps a paid purchase pending (not rejected) when the endpoint returns a non-JSON rate limit", async () => {
    const vatar = fakeVatar()
    vatar.sessions.set("sess_ada", { playerId: "t_ada", name: "Ada", mode: "test" })
    const deps: Deps = { api: createVatarApi(vatar.SECRET, vatar.fetchImpl as unknown as typeof fetch), store: blobEntitlementStore(memoryBlobs()) }
    let limited = true
    const apiFetch = (async (url: string, init?: RequestInit) => {
      if (limited && url === "/api/claim") return new Response("Too Many Requests", { status: 429, headers: { "Content-Type": "text/plain" } })
      const req = new Request(`https://suwe.test${url}`, init)
      return url === "/api/claim" ? handleClaim(req, deps) : handleEntitlements(req, deps)
    }) as unknown as typeof fetch
    const sdk = fakeSdk({
      init: vi.fn(async () => ({ player: { id: "t_ada", name: "Ada", avatar: null }, session: "sess_ada", mode: "test" as const })),
      session: vi.fn(async () => ({ session: "sess_ada", exp: 0 })),
      purchase: vi.fn(async () => {
        vatar.addPurchase("pur_rl")
        return { purchaseId: "pur_rl", productId: "chalk_pack" }
      }),
    })
    const cache: OwnershipCache = { get: () => [], set: () => {} }
    const shop = new ChalkShop(new Platform(sdk, () => []), httpShopApi("", apiFetch), cache, { sleep: async () => {} })
    await shop.start()
    await shop.buy()
    expect(shop.state).toMatchObject({ ownership: "not-owned", unconfirmed: true, flow: { kind: "error", canRetry: true } })
    limited = false
    await shop.retry()
    expect(shop.state.ownership).toBe("owned")
  })
})
