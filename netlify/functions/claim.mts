import type { Config } from "@netlify/functions"
import { handleClaim } from "../../server/http.ts"
import { netlifyDeps } from "../../server/netlify-deps.ts"

/** POST /api/claim { session, purchaseId } → verify with Vatar, grant once, mark delivered. */
export default (req: Request) => handleClaim(req, netlifyDeps())

export const config: Config = {
  path: "/api/claim",
  method: "POST",
  // Each call costs a Vatar API request (600/min per game); cap abuse per address.
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
