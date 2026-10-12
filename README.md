# Suwe

A mobile-first Nigerian childhood hopscotch game for the **Lagos Life Games** platform, built on the
[Vatar Games SDK v1](https://lagoslife.app/developers/docs).

Throw your stone into the glowing square, then hop the chalk board: skip the stone's square, land
both feet in the side-by-side pairs, turn round in REST, pick the stone up on the way back and hop
out over the line. Three lives, ten levels, with wind, aim sway and a shrinking balance timer.

- **Stack:** Vite + TypeScript. There's no UI framework: the board is drawn on Canvas 2D and the
  menus are plain DOM.
- **Assets:** all artwork is procedural canvas or inline SVG, sound is synthesised with Web Audio,
  and the fonts are bundled from npm (`@fontsource`). Nothing is loaded from a remote host except
  the Vatar SDK.
- **Backend:** two small Netlify Functions that verify and deliver the one optional purchase, the
  cosmetic Colourful Chalk Pack. They hold the Vatar secret and store entitlements in Netlify
  Blobs. The game itself needs no server and stays fully playable without them.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (local mode, no Vatar host needed)
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (Vitest): rules, scoring, session flow, SDK adapter, persistence |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run preview` | Serve `dist/` on http://localhost:4173 |
| `npm run check` | Typecheck + lint + tests + build |
| `npm run e2e` | Browser smoke test: plays the game through real touch and mouse input (needs `npm run preview` running) |
| `npm run e2e:host` | Framed test: runs `dist/` inside a mock Vatar game player using the real SDK script |

The browser tests use Playwright. Run `npx playwright install chromium` once, or point
`CHROMIUM_PATH` at an existing Chromium. They save screenshots to `e2e/screenshots/`.

When the game is opened directly (not inside Lagos Life), it runs in **local mode**. A "Local mode"
badge shows on the home screen, scores and the personal best are stored in `localStorage`, and every
score screen says "saved on this device only, not on the live leaderboard".

## Project structure

```
index.html                  Loads the Vatar SDK (async) and the game
public/_headers             frame-ancestors + cache headers (Netlify / Cloudflare Pages)
vercel.json, netlify.toml   Hosting configuration
src/
  config/
    board.ts                Board layouts (rows of numbered squares)
    rules.ts                Regional rule variants (skip/pick-up/round trip/two-feet/lines)
    levels.ts               The ten levels + tutorial: targets, scatter, sway, wind, balance time
    chalk.ts                Chalk colour palettes (cosmetic); which ones the pack unlocks
  core/                     Pure game logic, no DOM, fully unit-tested
    board.ts                Geometry built from a layout; hit tests
    throw.ts                Drag→aim mapping, sway, landing resolution, throw judging
    movement.ts             Hop path builder (applies the rules) and tap validation
    scoring.ts              All score maths
    session.ts              Run state machine: aiming → throwing → hopping ⇄ moving → …
    rng.ts                  Seeded RNG for deterministic tests
  game/controller.ts        Input, animation, feedback and frame loop for one run
  render/                   Canvas art: ground & chalk layer, stone, character, particles
  platform/
    vatar-types.ts          Types for the documented SDK surface used
    load-sdk.ts             Waits for the async SDK script (with timeout)
    platform.ts             The adapter the rest of the game talks to
    score-queue.ts          Rate-limited, de-duplicating score submission
  shop/
    chalk-shop.ts           Colourful Chalk Pack flow: buy, verify, restore (unlocks only on server OK)
    api.ts                  Client for our /api/claim and /api/entitlements
  storage/storage.ts        localStorage persistence with safe fallbacks
  audio/sound.ts            Synthesised sound effects, mute, pause-aware
  ui/                       Screens, modals, HUD, SVG art
  app.ts                    Screen routing and glue
server/                     Server-only code (never bundled into the game)
  vatar-api.ts              Documented Vatar API: /session/verify, /purchases/{id}, /deliver
  purchases.ts              Claim + entitlement logic (verify, grant once, mark delivered)
  entitlements.ts           Entitlement store on Netlify Blobs (idempotent per purchase)
  http.ts                   Request/response handling for the endpoints
  netlify-deps.ts           Reads VATAR_SECRET; opens the Blobs store
netlify/functions/          claim.mts, entitlements.mts (POST /api/claim, /api/entitlements)
tests/                      Vitest unit tests
e2e/                        Playwright smoke + framed-host tests
```

### Changing the rules or board

Suwe varies from yard to yard, so the rules and the board are configuration:

- **Board:** add a `BoardLayout` in `src/config/board.ts`. For example,
  `rows: [[1], [2, 3], [4], [5, 6], [7], [8]]` gives a ladder of alternating pairs.
- **Rules:** toggle `skipMarkerSquare`, `roundTrip`, `pickUpOnReturn`,
  `landInMarkerSquareAfterPickup`, `pairsNeedBothFeet` and `linesAreFaults` in
  `src/config/rules.ts`.
- **Levels:** edit `src/config/levels.ts`. Each level lists target squares and difficulty dials.
  The session refuses any level that targets a square the board doesn't have.
- **Wiring:** pick the board and rule set at the top of `src/app.ts` (`BOARD`, `RULES`).

The hop path (`buildHopPath`) and tap validation (`judgeTap`) read the rules, so the engine,
renderer and UI need no changes. Both alternative configurations ship with tests.

## Gameplay and scoring

- **Throwing.** Swipe or drag upwards (touch, mouse or pen). A dotted arc and a landing ring
  preview the throw, and a gauge shows the power. From level 2 the aim point sways, so you time
  the release. From level 4 a visible wind arrow pushes the stone. A small random scatter is
  always added. The stone must come to rest inside the target square and clear of the chalk lines.
- **Hopping.** Tap the next square. Single squares take one foot. Pairs take both feet, unless
  the stone lies in one of them. The stone's square is jumped. On the way back you tap the stone
  to pick it up. Landing on a line, on the stone's square or in the wrong square is a fault, and
  so is running out the balance timer. Taps on empty ground are ignored with a hint rather than
  punished.
- **Points.**
  - A valid throw scores 50–150, depending on how close it lands to the centre.
  - Each hop scores 10–20, more for hopping quickly.
  - Finishing a course scores 100.
  - All of these are scaled by +10% per level, and by a clean-round streak bonus of up to ×2.
  - Clearing a level adds 200 × level, plus 150 × level if you lost no life on it.
- **Lives.** You get three per run. A fault costs one and replays the round. The tutorial never
  costs a life.

## Vatar integration

Everything the game uses is documented at https://lagoslife.app/developers/docs:

| Need | SDK call | Where |
| --- | --- | --- |
| Start up, player identity, sandbox vs live | `Vatar.init()` → `{ player: { name, avatar }, mode }` | `Platform.connect()` |
| Leaderboard score | `Vatar.submitScore(n)` → `{ best, accepted }` | `ScoreQueue` |
| Leaderboard | `Vatar.leaderboard()` → `{ top, me }` | `Platform.leaderboard()` |
| Backgrounding / pay sheet | `Vatar.onPause` / `Vatar.onResume` | `App` → pause overlay, timers frozen, sound suspended |
| Buy the Colourful Chalk Pack | `Vatar.purchase("chalk_pack")` → `{ purchaseId, productId }` | `ChalkShop.buy()` |
| Paid while away / after a crash | `Vatar.onPurchase(fn)`, `Vatar.purchases()` | `ChalkShop.start()` |
| Session token for our server | `Vatar.session()` → `{ session, exp }` | `ChalkShop` (fresh token per server call) |

Behaviour that follows the documentation:

- **Loading.** The SDK is loaded from `https://lagoslife.app/sdk/vatar-games-v1.js` (never
  copied), with `async` so the game renders immediately.
- **Score timing.** Scores are submitted only at milestones: each level complete and the end of a
  run, never per move or per frame. At most one is sent every 20 seconds. If several milestones
  land inside the window, only the highest unsent score goes. Repeats and lower scores are dropped.
  `too_soon`, `rate_limited`, `timeout` and `error` are retried in the background (up to 3 times)
  without interrupting play.
- **Leaderboard reads.** The leaderboard is cached for 30 seconds (the platform refreshes it no
  faster), and concurrent requests share one call. That keeps well under 12 calls a minute.
- **When the host isn't there.** `not_framed` (opened outside the host), a missing SDK or a load
  timeout puts the game in local mode. `signed_out` and `off` are shown as "unavailable", with
  scores kept on the device. A local score is never shown as posted.
- **Sound.** Sound starts only after the first tap. Sound and timers stop on pause.
- **Not used.** Matches, staking, webhooks (optional in the docs) and anything real-money beyond
  the one cosmetic product.

## Colourful Chalk Pack (in-game purchase)

| | |
| --- | --- |
| Product ID | `chalk_pack` |
| Name | Colourful Chalk Pack |
| Price | ₦100 (the pay sheet shows the price from Vatar's records) |
| Type | One-off |
| Description | Unlock colourful chalk colours for your Suwe board. |

It's cosmetic only: five extra chalk palettes (Hibiscus pink, Lagoon blue, Lilac, Sunset orange,
Rainbow). They change the colour of the chalk lines and numbers and nothing else: not the geometry,
hit areas, scoring, lives, difficulty or leaderboard. The palettes avoid the yellow target, mint
hint and red fault colours, so every board reads the same. Players find it under **Chalk colours**
on the home screen, and can preview locked colours before buying.

### Flow

1. The player taps **Buy · ₦100**. `Vatar.purchase("chalk_pack")` opens Vatar's pay sheet, which
   pauses the game.
2. The promise resolves once Vatar has confirmed payment. The pack is **still locked** at this
   point.
3. The game gets a fresh token with `Vatar.session()` and sends `POST /api/claim { session,
   purchaseId }` to our server.
4. Our server:
   - verifies the player with `POST /session/verify`;
   - fetches the purchase with `GET /purchases/{id}` and checks that it is `paid` (or already
     `delivered`), belongs to this `playerId`, matches the session's mode and is for `chalk_pack`;
   - records the entitlement, once per `purchaseId` (an `onlyIfNew` write in Netlify Blobs);
   - calls `POST /purchases/{id}/deliver`.
5. Only when the server answers OK does the game unlock the colours. It caches that answer locally
   for instant display next time.
6. **At every start**, the game re-checks ownership with `POST /api/entitlements` (which works on any
   device, because delivered purchases no longer appear in `Vatar.purchases()`). It also claims
   anything still in `Vatar.purchases()` and listens to `Vatar.onPurchase`.

### Outcomes

- **Cancelled** (`cancelled`) or **failed** (`payment_failed`): the pack stays locked, with a
  message.
- **`busy`, `not_for_sale`, `rate_limited`, `signed_out`, `off`:** an explanatory message; the pack
  stays locked.
- **`owned`:** the game re-checks with our server and restores the purchase. It never asks an owner
  to pay again, and the Buy button is hidden once the pack is owned.
- **`timeout`:** the game checks for a paid, undelivered purchase and claims it.
- **Paid, but our server is unreachable:** the pack stays locked and **Try again** is shown. The
  purchase stays in `Vatar.purchases()`, so it is also claimed automatically next start.
- **Server rejects the purchase** (refunded, another player's, wrong product): the pack stays
  locked.
- **Repeated or concurrent claims:** granted once and delivered once. Later claims answer
  `alreadyClaimed: true`.
- **Purchase service down at start:** buying is paused, so nobody pays for something we can't
  deliver. The game plays normally.
- **Outside Lagos Life:** colours can be previewed, but buying is unavailable.

### Server endpoints

| Endpoint | Body | Success | Errors |
| --- | --- | --- | --- |
| `POST /api/claim` | `{ session, purchaseId }` | `200 { ok, productId, owned, delivered, alreadyClaimed }` | `400 bad_request`, `401 session_invalid`, `403 not_your_purchase`, `404 purchase_not_found`, `409 refunded`, `422 wrong_product`, `503 unavailable` / `not_configured` |
| `POST /api/entitlements` | `{ session }` | `200 { ok, owned: ["chalk_pack"] }` | `400`, `401`, `503` |

- Responses never include amounts, player ids or anything secret, and are sent with
  `Cache-Control: no-store`.
- Each function is rate-limited to 120 requests a minute per IP, because every call costs a Vatar
  API request (600 a minute per game).
- Logs contain purchase ids and outcomes only, never the secret or session tokens.

## Deployment

The game is a static site and can be hosted on any HTTPS host.

```bash
npm ci
npm run build        # outputs dist/
```

- **Netlify:** connect the repo. `netlify.toml` sets the build, and `public/_headers` sets the
  headers.
- **Cloudflare Pages:** set the build command to `npm run build` and the output to `dist`.
  `_headers` is picked up automatically. Use your own domain or `*.pages.dev`, not `*.workers.dev`.
- **Vercel:** import the repo. `vercel.json` sets the build and the headers.
- **Anything else:** serve `dist/` and send this header on every response:

  ```
  Content-Security-Policy: frame-ancestors https://lagoslife.app https://www.lagoslife.app https://naijalife.app https://www.naijalife.app https://lagoslife.eliysites.com
  ```

  Do **not** send `X-Frame-Options: DENY` or `SAMEORIGIN`. They stop the Vatar game player from
  embedding the game.

`vite.config.ts` uses `base: "./"`, so the build also works from a sub-path.

### Environment variables

| Name | Where | Value |
| --- | --- | --- |
| `VATAR_SECRET` | Netlify → Site configuration → Environment variables, scope **Functions** | `vtr_test_…` while testing in the sandbox; `vtr_live_…` once Vatar approves the game |

- This is the name the Vatar docs use. Without it, the purchase endpoints answer
  `503 not_configured`, and buying is paused while the rest of the game works.
- **Never** give it a `VITE_` prefix, put it in `netlify.toml` or commit it. Vite only exposes
  `VITE_` variables to the browser, and the server code reads it from `process.env` at run time.
- Not needed: `VATAR_WEBHOOK_SECRET` (webhooks are optional and not implemented) and
  `VATAR_RESULTS_SECRET` (multiplayer only).

### Storage

Entitlements live in **Netlify Blobs**, in the store `suwe-entitlements`, using strong
consistency. Keys are kept separate for test and live:

- `test|live/players/{playerId}`
- `test|live/purchases/{purchaseId}`

Blobs works automatically for functions deployed on Netlify, so there's nothing to provision. To
inspect it, go to Netlify → Blobs, or run `netlify blobs:list suwe-entitlements`.

## Vatar sandbox testing

1. **Deploy** `dist/` to an HTTPS address with the headers above. Check that the address serves
   Suwe (the page title is "Suwe") and sends the header, with
   `curl -sI https://your-domain/ | grep -i frame-ancestors`.
2. **Register.** Go to https://lagoslife.app/developers and choose *Get your keys*. Enter the
   studio, contact email, game name "Suwe", the HTTPS address and a one-line description.
3. **Secret.** Put the test secret in Netlify as `VATAR_SECRET` (Functions scope), then redeploy.
   Check it took effect: `curl -s -X POST -H 'Content-Type: application/json' -d '{"session":"x"}'
   https://your-domain/api/entitlements` should return `401 session_invalid`, meaning Vatar
   accepted the secret and rejected the dummy session. `503 not_configured` means the secret is
   missing, wrong or rotated.
4. **Product.** In the Vatar dashboard, add the product: id `chalk_pack`, name "Colourful Chalk
   Pack", price ₦100, one-off.
5. **Play in the sandbox.** Open your sandbox player at `/developers/sandbox/<draft>`. Check that:
   - the home badge says **Vatar sandbox** and the greeting shows your Lagos Life display name;
   - finishing level 1 says *"Sandbox: Posted … to the leaderboard"*, and the Leaderboard screen
     shows the test board with your place;
   - backgrounding the phone, or anything that pauses the game, shows the pause overlay, with the
     balance timer frozen and the sound stopped.
6. **Test the purchase.** Go to Home → **Chalk colours**:
   - **Fail (test):** "didn't go through", and the pack stays locked.
   - **Close the sheet:** "Purchase cancelled", and the pack stays locked.
   - **Pay (test):** "Confirming your purchase…", then "Colourful Chalk Pack unlocked". The
     dashboard checklist should tick *test purchase made*, *purchase verified by your server* and
     *marked delivered*. Netlify's function logs show `claim ok: purchase … granted,
     delivered=true`.
   - **Reload, or open it on another device:** it stays unlocked, and Buy is not offered again.
   - **Start a run:** the board uses the chosen colour.
7. **Review checklist.** Test at 375 × 812 in portrait by touch. Sound must start only after the
   first tap. There are no outside links, logins or payments.
8. **Submit.** Add the listing in the dashboard (512 px PNG/JPEG/WebP icon, 3–5 screenshots, a short
   description of up to 120 characters), agree to the Developer Agreement and submit for review.

### Still needs credentials or approval

These steps can't be done from this repo:

- **Integration checklist.** The purchase items can only tick from a real sandbox purchase
  (steps 3–6 above), so they need the deployed functions, `VATAR_SECRET` and the `chalk_pack`
  product.
- **Refunds.** A purchase refunded *after* it was delivered keeps its entitlement. Revoking it would
  need the optional webhook, or a periodic re-check.
- **Real-host tests.** The real sandbox session, the live leaderboard and the real `onPause`
  events from the host need a deployed HTTPS address and a sandbox draft. `npm run e2e:host`
  simulates the host's documented message protocol with the real SDK script, but it isn't a
  substitute for the sandbox.
- **Going live.** Live release needs Vatar's review and approval. Nothing here uses live
  credentials.
- **Listing assets.** The icon and screenshots for the listing still have to be produced and
  uploaded. `public/favicon.svg` is SVG, which the listing doesn't accept, so export a PNG.

## Testing notes

- **Unit tests (80):**
  - geometry and layouts;
  - throw judging (in, wrong square, line, rest area, off-board, accidental taps, range clamp);
  - hop paths for each rule variant;
  - tap validation (stone's square, wrong square, lines, the middle line of a two-footed pair,
    ignored taps);
  - scoring;
  - the session state machine (full rounds, life loss, balance timeout, game over, no
    double-scoring from repeated calls, level progression, tutorial);
  - a deterministic play-through of all ten levels;
  - the rate-limited score queue and the SDK adapter (local fallback, async SDK load, caching,
    errors, pause/resume);
  - storage, including corrupted data;
  - score-status wording, which only says "posted" once the SDK confirms an accepted score;
  - the purchase server, run against a stand-in for Vatar's documented HTTP contract:
    - session and purchase verification, delivery, and idempotent and concurrent claims;
    - another player's, refunded, unpaid, wrong-product and other-mode purchases;
    - outages and rate limits, missing or wrong secrets, input validation, and no leaks;
  - the client purchase flow wired to the real server handlers:
    - unlocking only after verification, cancellation, failure and server outage with retry;
    - restoring on a new device, after a crash and via `onPurchase`;
    - duplicate notifications, the SDK's `owned` answer, and a tampered cache.
- **`e2e/smoke.mjs`:** plays the tutorial by touch swipes and taps, clears level 1, forces faults
  until game over, then tests retry, pausing on page hide, the personal best across reloads, the
  local leaderboard and skipping the tutorial. It also runs a desktop mouse round with
  no-scroll checks and a 360 × 640 layout check.
- **`e2e/host.mjs`:** runs the game inside a mock game player at `https://lagoslife.app/…` with the
  real SDK. It checks sandbox mode, the player name, the leaderboard, score posting, the 20 s
  submission spacing and the `frame-ancestors` header. For `onPause`/`onResume` it checks that the
  balance timer and sound freeze, that the run waits for a Resume tap, and that sound never stays
  stuck off after a pause on a menu or dialog. For purchases, it uses the real server code:
  - cancel, fail, and pay while the server is down;
  - then verify and deliver, and check that a repeat claim grants nothing new;
  - the coloured board in-game, restore on a fresh device, and 360/375/1366 px layouts.
- **Debug hook:** adding `?debug` to the URL exposes a read-only `window.__suwe.info()` (screen
  positions of squares, the current phase) so the browser tests can aim. It can't change game
  state.
