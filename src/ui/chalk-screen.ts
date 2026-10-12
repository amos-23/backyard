import { CHALK_PALETTES, type ChalkPalette, chalkColor } from "../config/chalk"
import { CHALK_PACK, type ShopState } from "../shop/chalk-shop"
import { boardPreviewSvg } from "./art"
import { h, icon } from "./dom"
import { button, iconButton } from "./screens"

export interface ChalkScreenProps {
  rows: number[][]
  /** The palette currently saved as the player's choice (may be premium and not owned). */
  selected: string
  onSelect(id: string): void
  onBuy(): void
  onRetry(): void
  onBack(): void
  onPlay(): void
}

/**
 * Chalk colours: a live board preview, the colour swatches and, until it's owned, the Colourful
 * Chalk Pack offer. Locked colours can be previewed (not used) so players see what they'd get.
 */
export function chalkScreen(props: ChalkScreenProps): { root: HTMLElement; render(state: ShopState): void } {
  let preview = props.selected
  let saved = props.selected
  const select = (id: string) => {
    saved = id
    props.onSelect(id)
  }
  const body = h("div", { class: "chalk-body" })
  const root = h(
    "section",
    { class: "screen chalk", "data-screen": "chalk" },
    h("header", { class: "topbar" }, iconButton("back", "Back", props.onBack, "back"), h("h2", null, "Chalk colours"), h("span", { class: "spacer" })),
    body,
    h("div", { class: "chalk-actions" }, button("Play", props.onPlay, { kind: "primary", iconName: "play", id: "chalk-play" })),
  )

  let last: ShopState | null = null
  function render(state: ShopState) {
    last = state
    const owned = state.ownership === "owned"
    const current = CHALK_PALETTES.find((p) => p.id === preview) ?? CHALK_PALETTES[0]
    const usable = (p: ChalkPalette) => !p.premium || owned
    // Just bought while previewing a pack colour: start using it.
    if (owned && state.flow.kind === "success" && preview !== saved) select(preview)
    body.replaceChildren(
      h("div", { class: "chalk-preview", "data-testid": "chalk-preview", "data-palette": current.id, html: boardPreviewSvg(props.rows, (r) => chalkColor(current, r)) }),
      h(
        "p",
        { class: "chalk-caption" },
        usable(current) ? (current.id === saved ? `Using ${current.name}` : current.name) : `Previewing ${current.name} — part of the Colourful Chalk Pack`,
      ),
      h(
        "div",
        { class: "swatches", role: "radiogroup", "aria-label": "Chalk colour" },
        ...CHALK_PALETTES.map((p) =>
          h(
            "button",
            {
              class: `swatch${p.id === preview ? " is-selected" : ""}${usable(p) ? "" : " is-locked"}`,
              type: "button",
              role: "radio",
              "aria-checked": String(p.id === preview),
              "aria-label": usable(p) ? p.name : `${p.name} (locked — preview only)`,
              "data-testid": `swatch-${p.id}`,
              onClick: () => {
                preview = p.id
                if (usable(p)) select(p.id)
                if (last) render(last)
              },
            },
            h("span", { class: "swatch-dots" }, ...p.colors.slice(0, 3).map((c) => h("i", { style: { background: `rgb(${c})` } }))),
            h("span", { class: "swatch-name" }, p.name),
            usable(p) ? null : icon("lock", "swatch-lock"),
          ),
        ),
      ),
      offerCard(state, props),
    )
  }
  return { root, render }
}

function offerCard(state: ShopState, props: ChalkScreenProps): HTMLElement {
  if (state.ownership === "owned") {
    return h(
      "div",
      { class: "offer offer-owned", "data-testid": "chalk-owned" },
      icon("check", "offer-check"),
      h("div", null, h("strong", null, `${CHALK_PACK.name} unlocked`), h("p", null, state.flow.kind === "success" ? "Thank you! Pick any colour above — it's used on the board straight away." : "Pick any colour above.")),
    )
  }

  const flow = state.flow
  const busy = flow.kind === "paying" || flow.kind === "verifying"
  let action: HTMLElement
  let note: HTMLElement | null = null
  if (state.ownership === "checking") {
    action = disabledButton("Checking your purchases…", true)
  } else if (state.ownership === "unavailable") {
    action = disabledButton(`Buy · ${CHALK_PACK.price}`)
    note = h("p", { class: "offer-note" }, state.message ?? "Purchases aren't available right now.")
  } else if (state.serviceDown) {
    action = button("Check again", props.onRetry, { iconName: "replay", id: "chalk-retry" })
    note = h("p", { class: "offer-note warn" }, "Purchases are paused: we can't reach Suwe's purchase service right now. The game works as normal.")
  } else if (flow.kind === "paying") {
    action = disabledButton("Waiting for payment…", true)
  } else if (flow.kind === "verifying") {
    action = disabledButton("Confirming your purchase…", true)
  } else if (flow.kind === "error" && flow.canRetry) {
    action = button("Try again", props.onRetry, { kind: "primary", iconName: "replay", id: "chalk-retry" })
    note = h("p", { class: "offer-note warn", role: "alert" }, flow.message)
  } else {
    action = button(`Buy · ${CHALK_PACK.price}`, props.onBuy, { kind: "primary", iconName: "palette", id: "chalk-buy" })
    if (flow.kind === "error") note = h("p", { class: "offer-note warn", role: "alert" }, flow.message)
    else if (flow.kind === "cancelled") note = h("p", { class: "offer-note" }, "Purchase cancelled. The pack is still locked.")
    else if (state.unconfirmed) note = h("p", { class: "offer-note warn" }, "A payment is waiting to be confirmed. It will unlock automatically.")
  }

  return h(
    "div",
    { class: `offer${busy ? " is-busy" : ""}`, "data-testid": "chalk-offer", "aria-busy": String(busy) },
    h("div", { class: "offer-head" }, h("strong", null, CHALK_PACK.name), h("span", { class: "price", "data-testid": "chalk-price" }, CHALK_PACK.price)),
    h("p", null, CHALK_PACK.description),
    h("p", { class: "offer-fine" }, "Cosmetic only: it doesn't change scoring, lives, difficulty or the leaderboard. One-off purchase."),
    note,
    action,
  )
}

function disabledButton(label: string, spinner = false): HTMLButtonElement {
  return h(
    "button",
    { class: "btn btn-primary", type: "button", disabled: true, "data-testid": "chalk-buy" },
    spinner ? h("span", { class: "btn-spinner", "aria-hidden": "true" }) : null,
    h("span", null, label),
  )
}
