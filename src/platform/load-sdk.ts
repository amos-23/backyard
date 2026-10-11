import type { VatarSdk } from "./vatar-types"

/**
 * Resolves with window.Vatar once the async SDK <script id="vatar-sdk"> in index.html has run, or
 * with undefined if it fails to load or takes too long (offline, blocked). Never rejects.
 */
export function loadVatarSdk(timeoutMs = 8000): Promise<VatarSdk | undefined> {
  if (window.Vatar) return Promise.resolve(window.Vatar)
  const script = document.getElementById("vatar-sdk") as HTMLScriptElement | null
  if (!script) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      script.removeEventListener("load", done)
      script.removeEventListener("error", done)
      resolve(window.Vatar)
    }
    const timer = setTimeout(done, timeoutMs)
    script.addEventListener("load", done)
    script.addEventListener("error", done)
  })
}
