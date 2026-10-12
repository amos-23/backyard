/**
 * Server-side record of what each player owns. This, not the browser, is the proof of ownership:
 * once a purchase is delivered Vatar.purchases() no longer lists it, so a returning player on a new
 * device is recognised from here. Test (sandbox) and live data are kept apart, as Vatar keeps them.
 */
export type Mode = "live" | "test"

export interface GrantRecord {
  purchaseId: string
  playerId: string
  productId: string
  grantedAt: number
  deliveredAt: number | null
}

export interface EntitlementStore {
  /** Product ids this player owns. */
  owned(mode: Mode, playerId: string): Promise<string[]>
  /**
   * Record that a verified purchase was given to its player. Idempotent per purchase id: the first
   * call grants, later calls return the existing record with `alreadyGranted: true`.
   */
  grant(mode: Mode, record: Omit<GrantRecord, "deliveredAt">): Promise<{ alreadyGranted: boolean; record: GrantRecord }>
  markDelivered(mode: Mode, purchaseId: string, deliveredAt: number): Promise<void>
}

/** The subset of a Netlify Blobs store this module uses. */
export interface BlobStoreLike {
  get(key: string, options: { type: "json" }): Promise<unknown>
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<{ modified: boolean } | void>
}

const purchaseKey = (mode: Mode, purchaseId: string) => `${mode}/purchases/${purchaseId}`
const playerKey = (mode: Mode, playerId: string) => `${mode}/players/${playerId}`

interface PlayerRecord {
  products: Record<string, { purchaseId: string; grantedAt: number }>
}

function isPlayerRecord(v: unknown): v is PlayerRecord {
  return !!v && typeof v === "object" && !!(v as PlayerRecord).products && typeof (v as PlayerRecord).products === "object"
}

function isGrant(v: unknown): v is GrantRecord {
  return !!v && typeof v === "object" && typeof (v as GrantRecord).purchaseId === "string" && typeof (v as GrantRecord).playerId === "string"
}

export function blobEntitlementStore(blobs: BlobStoreLike): EntitlementStore {
  async function addToPlayer(mode: Mode, r: { playerId: string; productId: string; purchaseId: string; grantedAt: number }) {
    const existing = await blobs.get(playerKey(mode, r.playerId), { type: "json" })
    const player: PlayerRecord = isPlayerRecord(existing) ? existing : { products: {} }
    if (player.products[r.productId]) return
    player.products[r.productId] = { purchaseId: r.purchaseId, grantedAt: r.grantedAt }
    await blobs.setJSON(playerKey(mode, r.playerId), player)
  }

  return {
    async owned(mode, playerId) {
      const v = await blobs.get(playerKey(mode, playerId), { type: "json" })
      return isPlayerRecord(v) ? Object.keys(v.products) : []
    },

    async grant(mode, input) {
      const record: GrantRecord = { ...input, deliveredAt: null }
      // onlyIfNew makes "first grant wins" atomic even if two claims for one purchase race.
      const write = await blobs.setJSON(purchaseKey(mode, input.purchaseId), record, { onlyIfNew: true })
      const created = !write || write.modified
      const stored = created ? record : await blobs.get(purchaseKey(mode, input.purchaseId), { type: "json" })
      const effective = isGrant(stored) ? stored : record
      // Always (re)ensure the player's entitlement, so a crash between the two writes heals on retry.
      await addToPlayer(mode, effective)
      return { alreadyGranted: !created, record: effective }
    },

    async markDelivered(mode, purchaseId, deliveredAt) {
      const v = await blobs.get(purchaseKey(mode, purchaseId), { type: "json" })
      if (!isGrant(v) || v.deliveredAt) return
      await blobs.setJSON(purchaseKey(mode, purchaseId), { ...v, deliveredAt })
    },
  }
}

/** In-memory blob store with the same onlyIfNew semantics, for tests and local runs. */
export function memoryBlobs(): BlobStoreLike & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null
    },
    async setJSON(key, value, options) {
      if (options?.onlyIfNew && data.has(key)) return { modified: false }
      data.set(key, structuredClone(value))
      return { modified: true }
    },
  }
}
