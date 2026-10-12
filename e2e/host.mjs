// Framed-mode test: runs the built game inside a mock Vatar game player, using the real SDK script
// and its postMessage protocol, to check init, player identity, sandbox mode, rate-limited score
// submission, the leaderboard and pause/resume — without needing Vatar credentials.
//
//   npm run build && npm run e2e:host
//
// Playwright intercepts https://lagoslife.app/* (the mock host page) and https://suwe.test/* (the
// built game from dist/), so the SDK's origin checks behave exactly as they would in production.
// The SDK script is fetched live from lagoslife.app, or from VATAR_SDK_FILE if set (offline runs).
import { chromium } from "playwright"
import { readFileSync, existsSync } from "node:fs"
import { extname, join } from "node:path"
// The real server code (TypeScript, loaded via Node's type stripping) and the documented-contract
// stand-in for Vatar's HTTP API that the unit tests use.
import { handleClaim, handleEntitlements } from "../server/http.ts"
import { blobEntitlementStore, memoryBlobs } from "../server/entitlements.ts"
import { createVatarApi } from "../server/vatar-api.ts"
import { fakeVatar } from "../tests/helpers/fake-vatar.ts"

const DIST = new URL("../dist/", import.meta.url).pathname
const GAME = "https://suwe.test/"
const HOST = "https://lagoslife.app/developers/sandbox/mock"
const AIM_GAIN = 2.4
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" }

const hostPage = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#111}iframe{border:0;width:100%;height:100%}</style>
<iframe id="g" src="${GAME}?debug" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" allow="autoplay; gamepad"></iframe>
<script>
  const frame = document.getElementById("g")
  const log = (window.vatarLog = [])
  let lastScore = -Infinity, best = 0
  const board = [{ rank: 1, name: "Ada", score: 9000 }, { rank: 2, name: "Bayo", score: 4000 }]
  window.forceTooSoon = 0
  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.origin !== "https://suwe.test") return
    const m = e.data
    if (!m || m.ll !== 1) return
    log.push({ t: m.t, n: m.n, at: Date.now() })
    const reply = (ok, data, error) => frame.contentWindow.postMessage({ ll: 1, t: "reply", re: m.id, ok, data, error }, "https://suwe.test")
    if (m.t === "init") return reply(true, { player: { id: "t_abc", name: "Tolu", avatar: null }, session: "vtr1.test", mode: "test" })
    if (m.t === "score") {
      if (window.forceTooSoon > 0 || Date.now() - lastScore < 20000) { window.forceTooSoon--; return reply(false, null, "too_soon") }
      lastScore = Date.now(); const accepted = m.n > best; best = Math.max(best, m.n)
      return reply(true, { best, accepted })
    }
    if (m.t === "leaderboard") {
      const top = [...board, { rank: 0, name: "Tolu", score: best }].filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x, i) => ({ ...x, rank: i + 1 }))
      const me = best ? { rank: top.findIndex((x) => x.name === "Tolu") + 1, label: "#" + (top.findIndex((x) => x.name === "Tolu") + 1), score: best } : null
      return reply(true, { top, me })
    }
    if (m.t === "session") return reply(true, { session: "vtr1.test", exp: Date.now() + 900000 })
    if (m.t === "purchases") return window.vatarPending().then((list) => reply(true, list))
    if (m.t === "purchase") {
      // Like the real game player: the pay sheet pauses the game, then Pay (test) / Fail (test) / close.
      frame.contentWindow.postMessage({ ll: 1, t: "pause" }, "https://suwe.test")
      return setTimeout(async () => {
        frame.contentWindow.postMessage({ ll: 1, t: "resume" }, "https://suwe.test")
        if (window.purchaseMode === "cancel") return reply(false, null, "cancelled")
        if (window.purchaseMode === "fail") return reply(false, null, "payment_failed")
        reply(true, await window.vatarPay(m.productId))
      }, 400)
    }
    reply(false, null, "bad_request")
  })
  window.purchaseMode = "pay"
  window.hostPause = () => frame.contentWindow.postMessage({ ll: 1, t: "pause" }, "https://suwe.test")
  window.hostResume = () => frame.contentWindow.postMessage({ ll: 1, t: "resume" }, "https://suwe.test")
</script>`

const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 })
await context.route("https://lagoslife.app/sdk/vatar-games-v1.js", async (route) => {
  if (process.env.VATAR_SDK_FILE) return route.fulfill({ body: readFileSync(process.env.VATAR_SDK_FILE, "utf8"), contentType: "text/javascript" })
  return route.continue()
})
await context.route(HOST, (route) => route.fulfill({ body: hostPage, contentType: "text/html" }))
// Vatar's side of the purchase: purchases made on the mock pay sheet exist in the same records
// that the (mock) Vatar API answers GET /purchases/{id} and /deliver from.
const vatar = fakeVatar()
vatar.sessions.set("vtr1.test", { playerId: "t_abc", name: "Tolu", mode: "test" })
const serverDeps = { api: createVatarApi(vatar.SECRET, vatar.fetchImpl), store: blobEntitlementStore(memoryBlobs()) }
const api = { down: false, claims: 0 }
let purchaseSeq = 0
await context.exposeFunction("vatarPay", (productId) => {
  const id = `pur_e2e_${++purchaseSeq}`
  vatar.addPurchase(id, { productId, playerId: "t_abc" })
  return { purchaseId: id, productId }
})
await context.exposeFunction("vatarPending", () =>
  [...vatar.purchases.values()].filter((p) => p.status === "paid" && p.playerId === "t_abc").map((p) => ({ purchaseId: p.id, productId: p.productId })),
)

let frameHeaders = null
await context.route(`${GAME}**`, async (route) => {
  const path = new URL(route.request().url()).pathname
  if (path.startsWith("/api/")) {
    if (path === "/api/claim") api.claims++
    if (api.down) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unavailable", retryable: true }) })
    const r = route.request()
    const req = new Request(r.url(), { method: r.method(), headers: r.headers(), body: r.method() === "POST" ? r.postData() : undefined })
    const res = await (path === "/api/claim" ? handleClaim : handleEntitlements)(req, serverDeps)
    return route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() })
  }
  const file = join(DIST, path === "/" ? "index.html" : path)
  if (!existsSync(file)) return route.fulfill({ status: 404, body: "not found" })
  const headers = { "Content-Security-Policy": readFrameAncestors() }
  if (path === "/") frameHeaders = headers
  return route.fulfill({ body: readFileSync(file), contentType: types[extname(file)] ?? "application/octet-stream", headers })
})

/** Use the same frame-ancestors header the deployment config ships (public/_headers). */
function readFrameAncestors() {
  const line = readFileSync(join(DIST, "_headers"), "utf8").split("\n").find((l) => l.includes("frame-ancestors"))
  return line.split("Content-Security-Policy:")[1].trim()
}

const page = await context.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
await page.goto(HOST)
const game = page.frameLocator("#g")
const frame = () => page.frames().find((f) => f.url().startsWith(GAME))
await page.waitForFunction(() => document.querySelector("#g").contentWindow, null)
await game.locator('[data-screen="home"]').waitFor()
await game.locator('[data-testid="platform-badge"]', { hasText: "Vatar sandbox" }).waitFor({ timeout: 12000 })
check("connects to the host in sandbox (test) mode", true)
check("game is served with the documented frame-ancestors header", /frame-ancestors https:\/\/lagoslife\.app/.test(frameHeaders?.["Content-Security-Policy"] ?? ""))
const greeting = await game.locator(".greeting").textContent()
check("shows the Vatar player's display name", /Tolu/.test(greeting), greeting)
await page.screenshot({ path: `${process.env.SHOTS ?? "e2e/screenshots"}/20-framed-home.png` })

const soundPaused = () => frame().evaluate(() => window.__suwe.soundPaused())
const setHidden = (hidden) =>
  frame().evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h })
    document.dispatchEvent(new Event("visibilitychange"))
  }, hidden)

// Host pause on a menu: sound stays off until the host resumes, even if the page becomes visible.
await page.evaluate(() => window.hostPause())
await setHidden(false)
const heldOnMenu = await soundPaused()
await page.evaluate(() => window.hostResume())
await page.waitForTimeout(100)
check("menu sound pauses on onPause and only returns on onResume", heldOnMenu && !(await soundPaused()))

// Leaderboard before any score.
await game.locator('[data-testid="leaderboard"]').click()
await game.locator(".lb-list li").first().waitFor()
const lb1 = await game.locator('[data-testid="leaderboard-body"]').textContent()
check("platform leaderboard renders top players", /Ada/.test(lb1) && /9,000/.test(lb1))
await game.locator('[data-testid="back"]').click()

// Play level 1 (skip the tutorial).
await game.locator('[data-testid="play"]').click()
await game.locator('[data-testid="skip-tutorial"]').click()
const info = () => frame().evaluate(() => window.__suwe.info())
const waitPhase = (phases) => frame().waitForFunction((p) => p.includes(window.__suwe.info()?.phase), phases, { timeout: 10000 })
const iframeBox = await page.locator("#g").boundingBox()
async function canvasOffset() {
  const b = await game.locator("canvas").boundingBox()
  return { x: b.x, y: b.y }
}
for (let r = 0; r < 3; r++) {
  await waitPhase(["aiming"])
  await page.waitForTimeout(1200)
  let i = await info()
  const o = await canvasOffset()
  const from = { x: o.x + i.origin.x, y: o.y + i.origin.y }
  const t = i.cells[i.target]
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + (t.x - i.origin.x) / AIM_GAIN, from.y + (t.y - i.origin.y) / AIM_GAIN, { steps: 6 })
  await page.mouse.up()
  await waitPhase(["hopping", "fault"])
  if ((await info()).phase === "fault") {
    r--
    continue
  }
  for (let g = 0; g < 40; g++) {
    i = await info()
    if (i.phase !== "hopping") break
    const s = i.step
    const p = s.kind === "hop" ? i.cells[s.cells[0]] : s.kind === "pickup" ? i.marker : s.kind === "turn" ? i.rest : i.start
    await page.mouse.click(o.x + p.x, o.y + p.y)
    await waitPhase(["hopping", "round-complete", "fault", "aiming", "level-complete"])
  }
}
void iframeBox
await game.locator('[data-testid="next-level"]').waitFor({ timeout: 8000 })
await game.locator('[data-testid="submission-status"]', { hasText: "Sandbox: Posted" }).waitFor({ timeout: 8000 })
const sub = await game.locator('[data-testid="submission-status"]').textContent()
check("level-complete score is posted to the sandbox leaderboard", true, sub)
await page.screenshot({ path: `${process.env.SHOTS ?? "e2e/screenshots"}/21-framed-level-complete.png` })

// Host pause while the level-complete dialog is up must not leave sound stuck off afterwards.
await page.evaluate(() => window.hostPause())
await page.waitForTimeout(100)
const offDuringSheet = await soundPaused()
await page.evaluate(() => window.hostResume())
await page.waitForTimeout(100)
check("sound recovers after a host pause on the level-complete dialog", offDuringSheet && !(await soundPaused()))

// Host pause mid-hop: the balance timer and sound freeze until the player resumes.
await game.locator('[data-testid="next-level"]').click()
for (let attempt = 0; attempt < 5; attempt++) {
  await waitPhase(["aiming"])
  await page.waitForTimeout(400)
  const i = await info()
  const o = await canvasOffset()
  const from = { x: o.x + i.origin.x, y: o.y + i.origin.y }
  const t = i.cells[i.target]
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + (t.x - i.origin.x) / AIM_GAIN, from.y + (t.y - i.origin.y) / AIM_GAIN, { steps: 6 })
  await page.mouse.up()
  await waitPhase(["hopping", "fault"])
  if ((await info()).phase === "hopping") break
}
await page.evaluate(() => window.hostPause())
await game.locator('[data-testid="resume"]').waitFor({ timeout: 3000 })
const frozenAt = (await info()).balance
await page.waitForTimeout(1200)
const stillFrozen = (await info()).balance === frozenAt && (await info()).phase === "hopping"
const soundOff = await soundPaused()
await page.evaluate(() => window.hostResume())
await page.waitForTimeout(300)
const waitsForTap = (await info()).balance === frozenAt && (await soundPaused())
check("host onPause shows the pause menu and freezes the balance timer and sound", stillFrozen && soundOff, `balance ${frozenAt.toFixed(2)}`)
check("after onResume the run stays frozen until the player taps Resume", waitsForTap)
await game.locator('[data-testid="resume"]').click()
await page.waitForTimeout(500)
const after = await info()
check("tapping Resume restarts the timer and sound", (after.balance < frozenAt || after.phase !== "hopping") && !(await soundPaused()))

// Quitting soon after submits again, but only after the 20 s window, and only once.
await page.evaluate(() => (window.forceTooSoon = 0))
const before = await page.evaluate(() => window.vatarLog.filter((m) => m.t === "score").length)
await setHidden(true)
await game.locator('[data-testid="quit"]').click()
await page.waitForTimeout(1500)
await setHidden(false)
check("quitting to home from the pause menu doesn't leave sound stuck off", !(await soundPaused()))
const mid = await page.evaluate(() => window.vatarLog.filter((m) => m.t === "score"))
check("no second score inside the 20 s window", mid.length === before, `${mid.length} score messages`)

const log = await page.evaluate(() => window.vatarLog)
const scores = log.filter((m) => m.t === "score")
const gaps = scores.slice(1).map((m, k) => m.at - scores[k].at)
check("score submissions respect the 20 s limit", gaps.every((g) => g >= 20000), JSON.stringify(gaps))
const lbCalls = log.filter((m) => m.t === "leaderboard").length
check("leaderboard requests stay within limits", lbCalls <= 2, `${lbCalls} calls`)

// ---------------------------------------------------------------- Colourful Chalk Pack purchase
const SHOTS = process.env.SHOTS ?? "e2e/screenshots"
const delivered = () => vatar.calls.filter((c) => c.endsWith("/deliver")).length
const ownedCard = () => game.locator('[data-testid="chalk-owned"]').count()
const buy = () => game.locator('[data-testid="chalk-buy"]:not([disabled])').click()
await game.locator('[data-testid="chalk"]').click()
await game.locator('[data-testid="chalk-buy"]:not([disabled])').waitFor({ timeout: 8000 })
const offer = await game.locator('[data-testid="chalk-offer"]').textContent()
check("pack offer shows name, ₦100 price and that it's cosmetic", /Colourful Chalk Pack/.test(offer) && /₦100/.test(offer) && /Cosmetic only/.test(offer))
await game.locator('[data-testid="swatch-rainbow"]').click()
const previewing = (await game.locator('[data-testid="chalk-preview"]').getAttribute("data-palette")) === "rainbow"
check("locked colours can be previewed before buying", previewing && /Previewing/.test(await game.locator(".chalk-caption").textContent()))
await page.screenshot({ path: `${SHOTS}/30-chalk-offer.png` })

await page.evaluate(() => (window.purchaseMode = "cancel"))
let claimsBefore = api.claims
await buy()
await game.getByText("Purchase cancelled").waitFor({ timeout: 5000 })
check("cancelled payment: pack stays locked and nothing is claimed", api.claims === claimsBefore && (await ownedCard()) === 0)

await page.waitForTimeout(3100) // the SDK allows one purchase request every 3 s
await page.evaluate(() => (window.purchaseMode = "fail"))
await buy()
await game.getByText("didn't go through").waitFor({ timeout: 5000 })
check("failed payment: pack stays locked and nothing is claimed", api.claims === claimsBefore && (await ownedCard()) === 0)

await page.waitForTimeout(3100)
await page.evaluate(() => (window.purchaseMode = "pay"))
api.down = true
await buy()
await game.locator('[data-testid="chalk-buy"]', { hasText: "Confirming" }).waitFor({ timeout: 5000 })
const lockedWhileVerifying = (await ownedCard()) === 0
await game.locator('[data-testid="chalk-retry"]').waitFor({ timeout: 20000 })
check("paid but our server unreachable: still locked, Try again offered", lockedWhileVerifying && (await ownedCard()) === 0 && vatar.purchases.get("pur_e2e_1")?.status === "paid")
await page.screenshot({ path: `${SHOTS}/31-chalk-unverified.png` })
api.down = false
await game.locator('[data-testid="chalk-retry"]').click()
await game.locator('[data-testid="chalk-owned"]').waitFor({ timeout: 8000 })
const vatarCalls = vatar.calls.join(" | ")
check(
  "server verifies session + purchase, then marks it delivered; pack unlocks",
  /POST \/session\/verify/.test(vatarCalls) && /GET \/purchases\/pur_e2e_1/.test(vatarCalls) && vatar.purchases.get("pur_e2e_1")?.status === "delivered" && delivered() === 1,
)
const savedChalk = await frame().evaluate(() => JSON.parse(localStorage.getItem("suwe.v1.settings") ?? "{}").chalk)
check("the previewed colour is applied once the pack is verified", savedChalk === "rainbow", savedChalk)
await page.screenshot({ path: `${SHOTS}/32-chalk-owned.png` })

const replayReq = () => new Request(`${GAME}api/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session: "vtr1.test", purchaseId: "pur_e2e_1" }) })
const replay = await (await handleClaim(replayReq(), serverDeps)).json()
check("repeating the delivery request grants nothing new", replay.ok && replay.alreadyClaimed === true && delivered() === 1)

await game.locator('[data-testid="chalk-play"]').click()
const skip = game.locator('[data-testid="skip-tutorial"]')
if (await skip.count()) await skip.click()
await waitPhase(["aiming"])
check("the game board is drawn in the owned colours", (await info()).chalk === "rainbow")
await page.waitForTimeout(1300)
await page.screenshot({ path: `${SHOTS}/33-game-rainbow-mobile.png` })

// A returning owner on a fresh device: no local data, and Vatar.purchases() is empty (delivered).
await frame().evaluate(() => localStorage.clear())
await page.reload()
await game.locator('[data-screen="home"]').waitFor()
await game.locator('[data-testid="chalk"]').click()
await game.locator('[data-testid="chalk-owned"]').waitFor({ timeout: 8000 })
check("returning owner is restored from the server with empty local storage", (await page.evaluate(() => window.vatarPending())).length === 0)

for (const [name, size] of [["34-chalk-small", { width: 360, height: 640 }], ["35-chalk-desktop", { width: 1366, height: 800 }]]) {
  await page.setViewportSize(size)
  await page.waitForTimeout(300)
  const fits = await frame().evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  check(`chalk screen fits ${size.width}×${size.height} without sideways scrolling`, fits)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

check("no page errors", errors.length === 0, errors.join(" | "))

await browser.close()
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
