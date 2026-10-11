import "@fontsource/gochi-hand/latin-400.css"
import "@fontsource-variable/nunito/wght.css"
import "./styles.css"
import { App } from "./app"
import { Sound } from "./audio/sound"
import { loadVatarSdk } from "./platform/load-sdk"
import { Platform } from "./platform/platform"
import { storage } from "./storage/storage"

const root = document.getElementById("app")
if (!root) throw new Error("Missing #app element")

// window.Vatar is set by the async SDK <script> in index.html. If that script cannot load (offline,
// blocked) the platform adapter runs in local mode; the game is playable either way.
const platform = new Platform(loadVatarSdk(), () => storage.getLocalScores())
const sound = new Sound(storage.getSettings().muted)
const app = new App(root, platform, sound, storage)
app.start()

// Stop pinch-zoom and double-tap zoom from fighting the game on iOS Safari.
document.addEventListener("gesturestart", (e) => e.preventDefault())
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false })
