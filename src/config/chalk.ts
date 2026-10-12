/**
 * Chalk colours for the board. Purely cosmetic: they change how the chalk lines and numbers look,
 * never the board's geometry, hit areas, scoring or difficulty. The colours avoid the gameplay
 * signal colours (yellow target, mint hop hint, red fault) so every board stays equally readable.
 */
export interface ChalkPalette {
  id: string
  name: string
  /** Part of the Colourful Chalk Pack. */
  premium: boolean
  /** "r, g, b" triplets. Rows of the board cycle through them from the throw line up. */
  colors: string[]
}

export const CHALK_PALETTES: ChalkPalette[] = [
  { id: "classic", name: "Classic white", premium: false, colors: ["251, 246, 234"] },
  { id: "hibiscus", name: "Hibiscus pink", premium: true, colors: ["255, 158, 200"] },
  { id: "lagoon", name: "Lagoon blue", premium: true, colors: ["130, 205, 255"] },
  { id: "lilac", name: "Lilac", premium: true, colors: ["206, 178, 255"] },
  { id: "sunset", name: "Sunset orange", premium: true, colors: ["255, 176, 112"] },
  { id: "rainbow", name: "Rainbow", premium: true, colors: ["255, 158, 200", "255, 176, 112", "130, 205, 255", "206, 178, 255", "251, 246, 234"] },
]

export const DEFAULT_CHALK = "classic"

export function chalkPalette(id: string | undefined): ChalkPalette {
  return CHALK_PALETTES.find((p) => p.id === id) ?? CHALK_PALETTES[0]
}

/** The chalk colour for a board row (row -1 is the throw line, rows.length is the rest area). */
export function chalkColor(palette: ChalkPalette, row: number): string {
  const n = palette.colors.length
  return palette.colors[((row % n) + n) % n]
}

/**
 * The palette to draw with: a premium palette is used only when the pack is owned, so a stale or
 * tampered setting can never show paid colours.
 */
export function effectiveChalk(selectedId: string | undefined, packOwned: boolean): ChalkPalette {
  const p = chalkPalette(selectedId)
  return p.premium && !packOwned ? chalkPalette(DEFAULT_CHALK) : p
}
