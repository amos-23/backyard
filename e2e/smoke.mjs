// End-to-end smoke test: plays Suwe in a real Chromium through pointer and touch input.
//
//   npm run build && npx vite preview --port 4173 &
//   npm run e2e                    # or: BASE_URL=https://your-host/ npm run e2e
//
// Uses the ?debug hook only to *read* where squares are on screen; every action is a real
// pointer/touch event, so the game's own input handling and rule validation are exercised.
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL ?? "http://localhost:4173/"
const OUT = process.env.SHOTS ?? "e2e/screenshots"
const AIM_GAIN = 2.4
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []

async function newPage(viewport, touch = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && !/vatar-games|ERR_|net::/.test(m.text()) && errors.push(m.text()))
  return { ctx, page }
}

const info = (page) => page.evaluate(() => window.__suwe?.info())
const waitPhase = (page, phases, timeout = 8000) =>
  page.waitForFunction((p) => p.includes(window.__suwe?.info()?.phase), phases, { timeout })

async function canvasBox(page) {
  return page.locator("canvas.board-canvas").boundingBox()
}

/** Swipe from the stone toward the target square so the aim lands on its centre. */
async function throwAt(page, cellId, { touch = false, offset = { x: 0, y: 0 } } = {}) {
  const i = await info(page)
  const box = await canvasBox(page)
  const target = i.cells[cellId]
  const from = { x: box.x + i.origin.x, y: box.y + i.origin.y }
  const to = { x: from.x + (target.x + offset.x - i.origin.x) / AIM_GAIN, y: from.y + (target.y + offset.y - i.origin.y) / AIM_GAIN }
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    const pt = (p) => [{ x: p.x, y: p.y, id: 1 }]
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(from) })
    for (let k = 1; k <= 8; k++) {
      const p = { x: from.x + ((to.x - from.x) * k) / 8, y: from.y + ((to.y - from.y) * k) / 8 }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(p) })
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  } else {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
  }
}

/** Tap the correct spot for the current hop step until the round ends. Returns the phase reached. */
async function hopCourse(page, { touch = false } = {}) {
  for (let guard = 0; guard < 40; guard++) {
    const i = await info(page)
    if (i.phase !== "hopping") return i.phase
    const box = await canvasBox(page)
    const s = i.step
    let p
    if (s.kind === "hop") p = i.cells[s.cells[0]]
    else if (s.kind === "pickup") p = i.marker
    else if (s.kind === "turn") p = i.rest
    else p = i.start
    if (touch) await page.touchscreen.tap(box.x + p.x, box.y + p.y)
    else await page.mouse.click(box.x + p.x, box.y + p.y)
    await waitPhase(page, ["hopping", "round-complete", "fault", "aiming", "level-complete"])
  }
  return (await info(page)).phase
}

async function playRound(page, opts = {}) {
  await waitPhase(page, ["aiming"])
  await page.waitForTimeout(150)
  const target = (await info(page)).target
  await throwAt(page, target, opts)
  await waitPhase(page, ["hopping", "fault"])
  const after = await info(page)
  if (after.phase === "fault") return "fault"
  return hopCourse(page, opts)
}

// ---------------------------------------------------------------- mobile run
{
  const { page } = await newPage({ width: 375, height: 812 }, true)
  await page.goto(BASE + "?debug")
  await page.waitForSelector('[data-screen="home"]')
  await page.waitForFunction(() => !document.querySelector('[data-testid="platform-badge"]')?.textContent?.includes("Connecting"), null, { timeout: 12000 })
  const badge = await page.textContent('[data-testid="platform-badge"]')
  check("home renders with local-mode badge outside the host", /Local mode/.test(badge), badge)
  await page.screenshot({ path: `${OUT}/01-home-mobile.png` })

  await page.click('[data-testid="howto"]')
  await page.waitForSelector('[data-screen="howto"]')
  await page.screenshot({ path: `${OUT}/02-howto.png` })
  await page.click('[data-testid="back"]')

  // First Play starts the tutorial.
  await page.click('[data-testid="play"]')
  await page.waitForSelector('[data-screen="tutorial"]')
  await waitPhase(page, ["aiming"])
  await page.screenshot({ path: `${OUT}/03-tutorial-aim.png` })

  // A deliberate miss in the tutorial costs no life.
  await throwAt(page, 6, { touch: true })
  await waitPhase(page, ["fault"])
  check("tutorial miss is a fault without losing a life", (await info(page)).lives === 3)
  await waitPhase(page, ["aiming"], 5000)

  const tutorialEnd = await playRound(page, { touch: true })
  check("tutorial round completes via touch swipe + taps", tutorialEnd === "round-complete" || tutorialEnd === "level-complete", tutorialEnd)
  await page.waitForSelector('[data-testid="start-level-1"]', { timeout: 6000 })
  await page.screenshot({ path: `${OUT}/04-tutorial-done.png` })
  await page.click('[data-testid="start-level-1"]')

  // Level 1: three rounds.
  await page.waitForSelector('[data-screen="game"]')
  let ok = true
  for (let r = 0; r < 3; r++) {
    const res = await playRound(page, { touch: true })
    if (r === 0) await page.screenshot({ path: `${OUT}/05-level1-round.png` })
    if (res === "fault") {
      await waitPhase(page, ["aiming"])
      r--
      continue
    }
    ok = ok && (res === "round-complete" || res === "level-complete")
  }
  await page.waitForSelector('[data-testid="next-level"]', { timeout: 6000 })
  const total = await page.textContent('[data-testid="total-score"]')
  const sub = await page.textContent('[data-testid="submission-status"]')
  check("level 1 completes with a score", ok && Number(total.replace(/\D/g, "")) > 0, `score ${total}`)
  check("level-complete screen says the score is local only", /device only/i.test(sub), sub)
  await page.screenshot({ path: `${OUT}/06-level-complete.png` })

  // Level 2, then lose all lives on purpose.
  await page.click('[data-testid="next-level"]')
  await waitPhase(page, ["aiming"])
  check("advanced to level 2", (await info(page)).level === 2)

  // A hop fault: tap the stone's square.
  await page.waitForTimeout(1200)
  const tgt = (await info(page)).target
  await throwAt(page, tgt, { touch: true })
  await waitPhase(page, ["hopping", "fault"])
  if ((await info(page)).phase === "hopping") {
    const i = await info(page)
    const box = await canvasBox(page)
    await page.touchscreen.tap(box.x + i.marker.x, box.y + i.marker.y)
    await waitPhase(page, ["fault"])
    check("stepping on the stone's square is a fault", true)
  }
  const lostLife = await page
    .waitForSelector('[data-testid="hud-lives"][aria-label="2 of 3 lives"]', { timeout: 3000 })
    .then(() => true)
    .catch(() => false)
  check("a fault costs a life", lostLife, await page.getAttribute('[data-testid="hud-lives"]', "aria-label"))

  // Pause via page visibility change freezes the run.
  await waitPhase(page, ["aiming"])
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.waitForSelector('[data-testid="resume"]')
  check("hiding the page pauses the game", true)
  await page.screenshot({ path: `${OUT}/07-paused.png` })
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.click('[data-testid="resume"]')

  // Two more wrong-square throws end the run.
  for (let k = 0; k < 2; k++) {
    await waitPhase(page, ["aiming"])
    await page.waitForTimeout(200)
    const t = (await info(page)).target
    const wrong = t === 1 ? 2 : 1
    await throwAt(page, wrong, { touch: true })
    await waitPhase(page, ["fault", "game-over"])
    if (k === 0) await page.screenshot({ path: `${OUT}/08-fault.png` })
  }
  await page.waitForSelector('[data-testid="replay"]', { timeout: 6000 })
  const final = Number((await page.textContent('[data-testid="final-score"]')).replace(/\D/g, ""))
  check("losing all three lives ends the run", true, `final ${final}`)
  await page.screenshot({ path: `${OUT}/09-game-over.png` })

  // Retry starts a fresh run with full lives.
  await page.click('[data-testid="replay"]')
  await waitPhase(page, ["aiming"])
  const fresh = await info(page)
  check("retry starts a fresh run", fresh.lives === 3 && fresh.score === 0 && fresh.level === 1)

  // Persistence across reloads.
  await page.reload()
  await page.waitForSelector('[data-screen="home"]')
  const best = await page.textContent('[data-testid="home-best"]')
  check("personal best persists across reload", best.replace(/\D/g, "").startsWith(String(final)) || Number(best.replace(/[^\d]/g, "").slice(0, String(final).length)) >= final, best)
  await page.screenshot({ path: `${OUT}/10-home-after.png` })

  await page.click('[data-testid="leaderboard"]')
  await page.waitForSelector(".lb-list li, .lb-state.empty", { timeout: 6000 })
  const lbText = await page.textContent('[data-testid="leaderboard-body"]')
  check("leaderboard shows local scores with a clear local-only notice", /this device/i.test(lbText) && lbText.includes(final.toLocaleString("en-NG")), lbText.slice(0, 120))
  await page.screenshot({ path: `${OUT}/11-leaderboard-local.png` })

  // Second play skips the tutorial.
  await page.click('[data-testid="back"]')
  await page.click('[data-testid="play"]')
  await page.waitForSelector('[data-screen="game"]')
  check("tutorial is skipped once completed", true)
}

// ---------------------------------------------------------------- desktop
{
  const { page } = await newPage({ width: 1366, height: 800 })
  await page.goto(BASE + "?debug")
  await page.waitForSelector('[data-screen="home"]')
  await page.screenshot({ path: `${OUT}/12-home-desktop.png` })
  await page.click('[data-testid="play"]')
  await page.click('[data-testid="skip-tutorial"]')
  await page.waitForSelector('[data-screen="game"]')
  const res = await playRound(page)
  check("desktop mouse round completes", res === "round-complete" || res === "level-complete", res)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/13-game-desktop.png` })
  const scroll = await page.evaluate(() => [document.documentElement.scrollWidth <= innerWidth, document.documentElement.scrollHeight <= innerHeight])
  check("no page scrollbars on desktop", scroll.every(Boolean))
}

// ---------------------------------------------------------------- small phone, mid-throw aim screenshot
{
  const { page } = await newPage({ width: 360, height: 640 }, true)
  await page.goto(BASE + "?debug")
  await page.click('[data-testid="play"]')
  await page.click('[data-testid="skip-tutorial"]')
  await waitPhase(page, ["aiming"])
  await page.waitForTimeout(1200)
  const i = await info(page)
  const box = await canvasBox(page)
  const from = { x: box.x + i.origin.x, y: box.y + i.origin.y }
  const t = i.cells[i.target]
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + (t.x - i.origin.x) / AIM_GAIN, from.y + (t.y - i.origin.y) / AIM_GAIN, { steps: 5 })
  await page.screenshot({ path: `${OUT}/14-aiming-small.png` })
  await page.mouse.up()
  const fits = await page.evaluate(() => {
    const hud = document.querySelector(".hud").getBoundingClientRect()
    return hud.bottom < innerHeight / 2
  })
  check("HUD fits on a 360×640 screen", fits)
}

check("no uncaught page errors", errors.length === 0, errors.join(" | "))
await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
