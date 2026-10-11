/**
 * Board layouts. Suwe is drawn differently from one compound or schoolyard to the next, so the
 * layout is pure data: a list of rows (nearest the thrower first), each holding one or more
 * numbered squares. The engine builds geometry from this and never hard-codes square numbers.
 */
export interface BoardLayout {
  id: string
  name: string
  /** Rows from the throw line outwards. Each entry lists the square numbers in that row, left to right. */
  rows: number[][]
  /** Square size in world units (the engine works in these, the renderer scales to pixels). */
  cellWidth: number
  cellHeight: number
  /** A semicircular "rest" area past the last row where the player turns around. */
  hasRestArea: boolean
}

/**
 * The layout most Lagos children will recognise: single squares broken up by side-by-side pairs,
 * finished with a rounded rest area at the top.
 *
 *            ( rest )
 *              [9]
 *            [7][8]
 *              [6]
 *            [4][5]
 *              [3]
 *              [2]
 *              [1]
 *        ---- throw line ----
 */
export const LAGOS_CLASSIC: BoardLayout = {
  id: "lagos-classic",
  name: "Lagos Classic",
  rows: [[1], [2], [3], [4, 5], [6], [7, 8], [9]],
  cellWidth: 1.25,
  cellHeight: 1,
  hasRestArea: true,
}

/** A compact alternative some schools use: alternating pairs. Included to show layouts are swappable. */
export const COMPOUND_LADDER: BoardLayout = {
  id: "compound-ladder",
  name: "Compound Ladder",
  rows: [[1], [2, 3], [4], [5, 6], [7], [8]],
  cellWidth: 1.25,
  cellHeight: 1,
  hasRestArea: true,
}

export const LAYOUTS: Record<string, BoardLayout> = {
  [LAGOS_CLASSIC.id]: LAGOS_CLASSIC,
  [COMPOUND_LADDER.id]: COMPOUND_LADDER,
}
