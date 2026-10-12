import "@fontsource/gochi-hand/latin-400.css"
import "@fontsource-variable/nunito/wght.css"
import "./styles.css"
import { App } from "./app"
import { Sound } from "./audio/sound"
import { loadVatarSdk } from "./platform/load-sdk"
import { Platform } from "./platform/platform"
import { httpShopApi } from "./shop/api"
import { ChalkShop } from "./shop/chalk-shop"
import { storage } from "./storage/storage"

const root = document.getElementById("app")
if (!root) throw new Error("Missing #app element")

// window.Vatar is set by the async SDK <script> in index.html. If that script cannot load (offline,
// blocked) the platform adapter runs in local mode; the game is playable either way.
const platform = new Platform(loadVatarSdk(), () => storage.getLocalScores())
const sound = new Sound(storage.getSettings().muted)
// Purchases are verified by Suwe's own server (/api/*, Netlify Functions), never in the browser.
const shop = new ChalkShop(platform, httpShopApi(), { get: (k) => storage.getCachedOwned(k), set: (k, v) => storage.setCachedOwned(k, v) })
const app = new App(root, platform, sound, storage, shop)
app.start()

// Stop pinch-zoom and double-tap zoom from fighting the game on iOS Safari.
document.addEventListener("gesturestart", (e) => e.preventDefault())
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false })
