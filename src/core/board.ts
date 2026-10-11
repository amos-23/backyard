import type { BoardLayout } from "../config/board"

export interface Vec {
  x: number
  y: number
}

/** Axis-aligned rectangle in world units. x/y is the bottom-left corner; y grows away from the thrower. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Cell extends Rect {
  id: number
  row: number
}

export interface Row {
  index: number
  cellIds: number[]
  rect: Rect
}

export interface Board {
  layout: BoardLayout
  cells: Map<number, Cell>
  rows: Row[]
  /** Rest area semicircle (centre on the top edge of the last row). null when the layout has none. */
  rest: { cx: number; cy: number; r: number } | null
  /** Zone behind the throw line where the player starts and finishes. */
  start: Rect
  /** Where the stone is thrown from. */
  throwOrigin: Vec
  /** Total drawable extent, including rest area and start zone. */
  bounds: Rect
}

/** Build world-space geometry from a layout. Throws if the layout is malformed. */
export function buildBoard(layout: BoardLayout): Board {
  if (layout.rows.length === 0) throw new Error("Board layout needs at least one row")
  const seen = new Set<number>()
  const cells = new Map<number, Cell>()
  const rows: Row[] = []
  const { cellWidth: cw, cellHeight: ch } = layout
  let maxWidth = 0

  layout.rows.forEach((ids, rowIndex) => {
    if (ids.length === 0) throw new Error(`Row ${rowIndex} is empty`)
    const rowWidth = ids.length * cw
    maxWidth = Math.max(maxWidth, rowWidth)
    const x0 = -rowWidth / 2
    const y = rowIndex * ch
    ids.forEach((id, i) => {
      if (seen.has(id)) throw new Error(`Square ${id} appears twice`)
      seen.add(id)
      cells.set(id, { id, row: rowIndex, x: x0 + i * cw, y, w: cw, h: ch })
    })
    rows.push({ index: rowIndex, cellIds: [...ids], rect: { x: x0, y, w: rowWidth, h: ch } })
  })

  const top = layout.rows.length * ch
  const restR = Math.max(maxWidth / 2, cw * 0.8)
  const rest = layout.hasRestArea ? { cx: 0, cy: top, r: restR } : null
  const startDepth = ch * 1.4
  const start: Rect = { x: -maxWidth / 2 - cw * 0.35, y: -startDepth, w: maxWidth + cw * 0.7, h: startDepth }
  const throwOrigin: Vec = { x: 0, y: -ch * 0.7 }
  const topExtent = rest ? top + restR : top
  const halfW = Math.max(maxWidth / 2, restR) + cw * 0.4
  const bounds: Rect = { x: -halfW, y: start.y, w: halfW * 2, h: topExtent - start.y + ch * 0.2 }

  return { layout, cells, rows, rest, start, throwOrigin, bounds }
}

export function inRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** Shortest distance from an inside point to the rectangle's edges (0 on the edge). */
export function distanceToEdge(p: Vec, r: Rect): number {
  return Math.min(p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y)
}

export function cellAt(board: Board, p: Vec): Cell | null {
  for (const cell of board.cells.values()) if (inRect(p, cell)) return cell
  return null
}

export function inRest(board: Board, p: Vec): boolean {
  const r = board.rest
  if (!r || p.y < r.cy) return false
  return Math.hypot(p.x - r.cx, p.y - r.cy) <= r.r
}

export function inStart(board: Board, p: Vec): boolean {
  return inRect(p, board.start) && p.y < 0
}

export function cellCenter(cell: Rect): Vec {
  return { x: cell.x + cell.w / 2, y: cell.y + cell.h / 2 }
}

export function restCenter(board: Board): Vec {
  const r = board.rest
  if (!r) return { x: 0, y: board.rows.length * board.layout.cellHeight }
  return { x: r.cx, y: r.cy + r.r * 0.42 }
}

export function startCenter(board: Board): Vec {
  return { x: 0, y: -board.layout.cellHeight * 0.55 }
}

export function getCell(board: Board, id: number): Cell {
  const cell = board.cells.get(id)
  if (!cell) throw new Error(`Square ${id} is not on this board`)
  return cell
}
