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
    reply(false, null, "bad_request")
  })
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
let frameHeaders = null
await context.route(`${GAME}**`, (route) => {
  const path = new URL(route.request().url()).pathname
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

// Host pause: the game shows its pause overlay and freezes.
await game.locator('[data-testid="next-level"]').click()
await waitPhase(["aiming"])
await page.evaluate(() => window.hostPause())
await game.locator('[data-testid="resume"]').waitFor({ timeout: 3000 })
check("host onPause pauses the game", true)
await page.evaluate(() => window.hostResume())
await game.locator('[data-testid="resume"]').click()

// Quitting soon after submits again, but only after the 20 s window, and only once.
await page.evaluate(() => (window.forceTooSoon = 0))
const before = await page.evaluate(() => window.vatarLog.filter((m) => m.t === "score").length)
await frame().evaluate(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true })
  document.dispatchEvent(new Event("visibilitychange"))
})
await game.locator('[data-testid="quit"]').click()
await page.waitForTimeout(1500)
const mid = await page.evaluate(() => window.vatarLog.filter((m) => m.t === "score"))
check("no second score inside the 20 s window", mid.length === before, `${mid.length} score messages`)

const log = await page.evaluate(() => window.vatarLog)
const scores = log.filter((m) => m.t === "score")
const gaps = scores.slice(1).map((m, k) => m.at - scores[k].at)
check("score submissions respect the 20 s limit", gaps.every((g) => g >= 20000), JSON.stringify(gaps))
const lbCalls = log.filter((m) => m.t === "leaderboard").length
check("leaderboard requests stay within limits", lbCalls <= 2, `${lbCalls} calls`)
check("no page errors", errors.length === 0, errors.join(" | "))

await browser.close()
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
