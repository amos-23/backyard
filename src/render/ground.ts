import type { Board, Vec } from "../core/board"
import { seededRng } from "../core/rng"
import { PALETTE } from "./palette"
import type { Viewport } from "./viewport"

/**
 * Draws the static scene once per resize: warm laterite ground with grit, pebbles and grass at the
 * edges, then the chalk-drawn Suwe board. Everything is procedural so nothing has to load.
 */
export function renderStaticLayer(board: Board, vp: Viewport, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(vp.width * dpr))
  canvas.height = Math.max(1, Math.round(vp.height * dpr))
  const ctx = canvas.getContext("2d")!
  ctx.scale(dpr, dpr)
  drawGround(ctx, vp)
  const chalk = renderChalk(board, vp, dpr)
  ctx.drawImage(chalk, 0, 0, vp.width, vp.height)
  return canvas
}

function drawGround(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const { width: w, height: h } = vp
  const rng = seededRng(42)
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h * 0.5, Math.max(w, h) * 0.8)
  g.addColorStop(0, PALETTE.earthLight)
  g.addColorStop(0.55, PALETTE.earth)
  g.addColorStop(1, PALETTE.earthDark)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // Soft blotches of damp and dry earth.
  for (let i = 0; i < 26; i++) {
    const x = rng() * w
    const y = rng() * h
    const r = 30 + rng() * 120
    const blot = ctx.createRadialGradient(x, y, 0, x, y, r)
    const dark = rng() < 0.5
    blot.addColorStop(0, dark ? "rgba(122, 63, 34, 0.18)" : "rgba(236, 170, 120, 0.16)")
    blot.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = blot
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // Fine grit.
  const grit = Math.round((w * h) / 90)
  for (let i = 0; i < grit; i++) {
    const x = rng() * w
    const y = rng() * h
    const light = rng() < 0.45
    ctx.fillStyle = light ? `rgba(255, 222, 190, ${0.12 + rng() * 0.2})` : `rgba(80, 36, 16, ${0.12 + rng() * 0.25})`
    const s = 0.6 + rng() * 1.4
    ctx.fillRect(x, y, s, s)
  }

  // Pebbles.
  for (let i = 0; i < Math.round((w * h) / 9000); i++) {
    const x = rng() * w
    const y = rng() * h
    const r = 1.5 + rng() * 3.5
    ctx.fillStyle = "rgba(60, 28, 12, 0.25)"
    ctx.beginPath()
    ctx.ellipse(x + 1, y + 1.2, r, r * 0.75, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = rng() < 0.5 ? "#b9865f" : "#a7704b"
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * 0.75, rng() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }

  // Cracks in the dry ground.
  ctx.strokeStyle = "rgba(90, 42, 20, 0.28)"
  ctx.lineWidth = 1
  for (let i = 0; i < 7; i++) {
    let x = rng() * w
    let y = rng() * h
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let k = 0; k < 6; k++) {
      x += (rng() - 0.5) * 30
      y += (rng() - 0.5) * 30
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // Grass tufts along the left and right edges.
  for (let i = 0; i < 18; i++) {
    const side = i % 2 === 0 ? rng() * w * 0.12 : w - rng() * w * 0.12
    const y = rng() * h
    drawTuft(ctx, side, y, 6 + rng() * 8, rng)
  }

  // Vignette.
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
  v.addColorStop(0, "rgba(0,0,0,0)")
  v.addColorStop(1, "rgba(40, 16, 6, 0.35)")
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
}

function drawTuft(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  ctx.lineCap = "round"
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * 1.6
    const len = size * (0.6 + rng() * 0.6)
    ctx.strokeStyle = rng() < 0.5 ? "rgba(92, 128, 46, 0.85)" : "rgba(128, 150, 60, 0.8)"
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rng() - 0.5) * 3, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
}

/** The chalk drawing on its own layer, so it can be roughened with "erase" specks like real chalk. */
function renderChalk(board: Board, vp: Viewport, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(vp.width * dpr))
  canvas.height = Math.max(1, Math.round(vp.height * dpr))
  const ctx = canvas.getContext("2d")!
  ctx.scale(dpr, dpr)
  const rng = seededRng(7)
  const lw = Math.max(2.2, vp.scale * 0.045)

  // Faint chalk smudge fill inside the squares.
  ctx.fillStyle = "rgba(251, 246, 234, 0.06)"
  for (const cell of board.cells.values()) {
    const a = vp.toScreen({ x: cell.x, y: cell.y + cell.h })
    ctx.fillRect(a.x, a.y, cell.w * vp.scale, cell.h * vp.scale)
  }

  for (const cell of board.cells.values()) {
    const corners: Vec[] = [
      { x: cell.x, y: cell.y },
      { x: cell.x + cell.w, y: cell.y },
      { x: cell.x + cell.w, y: cell.y + cell.h },
      { x: cell.x, y: cell.y + cell.h },
    ].map((p) => vp.toScreen(p))
    for (let i = 0; i < 4; i++) chalkLine(ctx, corners[i], corners[(i + 1) % 4], lw, rng)
  }

  if (board.rest) {
    const c = vp.toScreen({ x: board.rest.cx, y: board.rest.cy })
    const r = board.rest.r * vp.scale
    for (let pass = 0; pass < 3; pass++) {
      ctx.strokeStyle = `rgba(251, 246, 234, ${0.35 + rng() * 0.25})`
      ctx.lineWidth = lw * (0.7 + rng() * 0.5)
      ctx.beginPath()
      const steps = 40
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI + (i / steps) * Math.PI
        const jr = r + (rng() - 0.5) * lw * 0.6
        const x = c.x + Math.cos(a) * jr
        const y = c.y + Math.sin(a) * jr
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    const left = vp.toScreen({ x: board.rest.cx - board.rest.r, y: board.rest.cy })
    const right = vp.toScreen({ x: board.rest.cx + board.rest.r, y: board.rest.cy })
    chalkLine(ctx, left, right, lw, rng)
    chalkText(ctx, "REST", vp.toScreen({ x: board.rest.cx, y: board.rest.cy + board.rest.r * 0.42 }), vp.scale * 0.3, rng)
  }

  // Throw line across the front of the board.
  const half = board.bounds.w / 2 - 0.15
  chalkLine(ctx, vp.toScreen({ x: -half, y: 0 }), vp.toScreen({ x: half, y: 0 }), lw * 0.8, rng, true)

  for (const cell of board.cells.values()) {
    chalkText(ctx, String(cell.id), vp.toScreen({ x: cell.x + cell.w / 2, y: cell.y + cell.h / 2 }), vp.scale * 0.52, rng)
  }

  // Rough it up: knock tiny holes out of the chalk.
  ctx.globalCompositeOperation = "destination-out"
  const specks = Math.round((vp.width * vp.height) / 18)
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.25 + rng() * 0.6})`
    const s = 0.5 + rng() * 1.6
    ctx.fillRect(rng() * vp.width, rng() * vp.height, s, s)
  }
  ctx.globalCompositeOperation = "source-over"
  return canvas
}

function chalkLine(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, width: number, rng: () => number, dashed = false): void {
  ctx.lineCap = "round"
  if (dashed) ctx.setLineDash([width * 3, width * 2.2])
  for (let pass = 0; pass < 3; pass++) {
    ctx.strokeStyle = `rgba(251, 246, 234, ${0.3 + rng() * 0.3})`
    ctx.lineWidth = width * (0.55 + rng() * 0.6)
    const j = width * 0.35
    ctx.beginPath()
    ctx.moveTo(a.x + (rng() - 0.5) * j, a.y + (rng() - 0.5) * j)
    const mx = (a.x + b.x) / 2 + (rng() - 0.5) * j
    const my = (a.y + b.y) / 2 + (rng() - 0.5) * j
    ctx.quadraticCurveTo(mx, my, b.x + (rng() - 0.5) * j, b.y + (rng() - 0.5) * j)
    ctx.stroke()
  }
  ctx.setLineDash([])
}

function chalkText(ctx: CanvasRenderingContext2D, text: string, at: Vec, size: number, rng: () => number): void {
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.font = `400 ${Math.round(size * 1.12)}px "Gochi Hand", "Chalkboard SE", "Marker Felt", "Comic Sans MS", sans-serif`
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = `rgba(251, 246, 234, ${0.35 + rng() * 0.3})`
    ctx.fillText(text, at.x + (rng() - 0.5) * 1.6, at.y + (rng() - 0.5) * 1.6)
  }
}
