import { vi } from "vitest"
import type { VatarPurchaseRef, VatarSdk } from "../../src/platform/vatar-types"

/** A stand-in for window.Vatar with the documented method shapes. */
export function fakeSdk(overrides: Partial<VatarSdk> = {}): VatarSdk & { pause: () => void; resume: () => void; purchased: (p: VatarPurchaseRef) => void } {
  let pause = () => {}
  let resume = () => {}
  let purchased: (p: VatarPurchaseRef) => void = () => {}
  return {
    version: "1",
    init: vi.fn(async () => ({ player: { id: "t_1", name: "Tolu", avatar: null }, session: "vtr1.x", mode: "test" as const })),
    submitScore: vi.fn(async (n: number) => ({ best: n, accepted: true })),
    leaderboard: vi.fn(async () => ({ top: [{ rank: 1, name: "Tolu", score: 900 }], me: { rank: 1, label: "#1", score: 900 } })),
    onPause: (fn) => ((pause = fn), () => {}),
    onResume: (fn) => ((resume = fn), () => {}),
    session: vi.fn(async () => ({ session: "vtr1.fresh", exp: Date.now() + 900_000 })),
    purchase: vi.fn(async (productId: string) => ({ purchaseId: "pur_1", productId })),
    purchases: vi.fn(async () => []),
    onPurchase: (fn) => ((purchased = fn), () => {}),
    pause: () => pause(),
    resume: () => resume(),
    purchased: (p) => purchased(p),
    ...overrides,
  }
}
