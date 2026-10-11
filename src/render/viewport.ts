import type { Board, Vec } from "../core/board"

/** Maps board world units (y up, away from the thrower) to CSS pixels on the canvas (y down). */
export class Viewport {
  scale = 1
  offsetX = 0
  offsetY = 0
  width = 0
  height = 0

  /** Fit the board into the canvas, leaving room for HUD overlays at the top and bottom. */
  fit(board: Board, width: number, height: number, insetTop: number, insetBottom: number): void {
    this.width = width
    this.height = height
    const pad = 12
    const availW = Math.max(50, width - pad * 2)
    const availH = Math.max(50, height - insetTop - insetBottom)
    const b = board.bounds
    this.scale = Math.min(availW / b.w, availH / b.h, 130)
    this.offsetX = width / 2 - (b.x + b.w / 2) * this.scale
    // Place the board's top edge at the inset, centring any spare height.
    const spare = availH - b.h * this.scale
    this.offsetY = insetTop + spare / 2 + (b.y + b.h) * this.scale
  }

  toScreen(p: Vec): Vec {
    return { x: this.offsetX + p.x * this.scale, y: this.offsetY - p.y * this.scale }
  }

  toWorld(p: Vec): Vec {
    return { x: (p.x - this.offsetX) / this.scale, y: (this.offsetY - p.y) / this.scale }
  }

  /** Converts a screen-space drag vector into world units. */
  dragToWorld(dx: number, dy: number): Vec {
    return { x: dx / this.scale, y: -dy / this.scale }
  }
}
