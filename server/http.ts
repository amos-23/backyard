import { type Deps, type Result, claimPurchase, listEntitlements } from "./purchases.ts"

/**
 * HTTP layer for the purchase endpoints: method and size checks, JSON in and out, no caching.
 * Same-origin only (the game calls its own site), so no CORS headers are sent.
 */
const MAX_BODY = 8 * 1024

function json(r: Result<unknown>): Response {
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  })
}

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } })
  const type = req.headers.get("content-type") ?? ""
  if (!type.includes("application/json")) return json({ status: 415, body: { ok: false, error: "bad_request", retryable: false } })
  const text = await req.text()
  if (text.length > MAX_BODY) return json({ status: 413, body: { ok: false, error: "bad_request", retryable: false } })
  try {
    const v: unknown = JSON.parse(text)
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    /* fall through */
  }
  return json({ status: 400, body: { ok: false, error: "bad_request", retryable: false } })
}

export async function handleClaim(req: Request, deps: Deps): Promise<Response> {
  const body = await readBody(req)
  if (body instanceof Response) return body
  return json(await claimPurchase(deps, { session: body.session, purchaseId: body.purchaseId }))
}

export async function handleEntitlements(req: Request, deps: Deps): Promise<Response> {
  const body = await readBody(req)
  if (body instanceof Response) return body
  return json(await listEntitlements(deps, { session: body.session }))
}
