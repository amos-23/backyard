import { getStore } from "@netlify/blobs"
import { blobEntitlementStore } from "./entitlements.ts"
import type { Deps } from "./purchases.ts"
import { createVatarApi } from "./vatar-api.ts"

/**
 * Wires the purchase endpoints to Netlify: the Vatar secret from the site's environment variables
 * (server-side only; never VITE_-prefixed, never in the client bundle) and Netlify Blobs for
 * entitlements. Without VATAR_SECRET the endpoints answer 503 not_configured.
 */
export function netlifyDeps(): Deps {
  const secret = process.env.VATAR_SECRET?.trim()
  const store = blobEntitlementStore(getStore({ name: "suwe-entitlements", consistency: "strong" }))
  return {
    api: secret ? createVatarApi(secret) : null,
    store,
    // Ids only; never the secret or session tokens.
    log: (msg) => console.log(`[suwe-purchases] ${msg}`),
  }
}
