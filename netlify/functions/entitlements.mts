import type { Config } from "@netlify/functions"
import { handleEntitlements } from "../../server/http.ts"
import { netlifyDeps } from "../../server/netlify-deps.ts"

/** POST /api/entitlements { session } → what the verified player owns. */
export default (req: Request) => handleEntitlements(req, netlifyDeps())

export const config: Config = {
  path: "/api/entitlements",
  method: "POST",
  // Each call costs a Vatar API request (600/min per game); cap abuse per address.
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
