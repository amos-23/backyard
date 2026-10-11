import type { Vec } from "../core/board"
import { PALETTE } from "./palette"

/** A flat, slightly irregular stone seen from above. `lift` (0..1) raises it off its shadow. */
export function drawStone(ctx: CanvasRenderingContext2D, at: Vec, radius: number, rotation: number, lift = 0): void {
  const shadowOffset = radius * (0.25 + lift * 1.6)
  ctx.save()
  ctx.fillStyle = `rgba(40, 16, 6, ${0.35 - lift * 0.15})`
  ctx.beginPath()
  ctx.ellipse(at.x + shadowOffset * 0.5, at.y + shadowOffset, radius * (1 - lift * 0.2), radius * 0.7 * (1 - lift * 0.2), 0, 0, Math.PI * 2)
  ctx.fill()

  const r = radius * (1 + lift * 0.45)
  ctx.translate(at.x, at.y)
  ctx.rotate(rotation)
  ctx.beginPath()
  const pts = [1, 0.86, 0.95, 0.82, 1.02, 0.9, 0.97, 0.84]
  pts.forEach((k, i) => {
    const a = (i / pts.length) * Math.PI * 2
    const x = Math.cos(a) * r * k
    const y = Math.sin(a) * r * k * 0.82
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r * 1.1)
  g.addColorStop(0, PALETTE.stoneLight)
  g.addColorStop(0.55, PALETTE.stone)
  g.addColorStop(1, PALETTE.stoneDark)
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = "rgba(30, 30, 34, 0.45)"
  ctx.lineWidth = Math.max(1, r * 0.08)
  ctx.stroke()
  // A little vein of quartz.
  ctx.strokeStyle = "rgba(255,255,255,0.35)"
  ctx.lineWidth = Math.max(0.8, r * 0.07)
  ctx.beginPath()
  ctx.moveTo(-r * 0.4, r * 0.2)
  ctx.quadraticCurveTo(0, -r * 0.05, r * 0.45, r * 0.12)
  ctx.stroke()
  ctx.restore()
}

export interface CharacterPose {
  /** Ground point the child stands over (screen px). */
  body: Vec
  /** Feet on the ground (screen px). One entry = balancing on one foot. */
  feet: Vec[]
  /** +1 hopping up the board (we see their back), -1 coming back (we see their face). */
  facing: 1 | -1
  /** 0..1 jump height, used during a hop. */
  lift: number
  /** 0..1 bend towards the stone during a pick-up. */
  bend: number
  carrying: boolean
  /** 0..1 red flash after a fault. */
  hurt: number
  /** Gentle side-to-side wobble while balancing. */
  wobble: number
}

/**
 * A schoolgirl in a green pinafore with afro puffs and blue rubber slippers, drawn upright over the
 * top-down board (the usual casual-game convention). Her legs reach the actual landing points, so a
 * two-footed straddle across a pair of squares and a one-footed hop both read at a glance.
 */
export function drawCharacter(ctx: CanvasRenderingContext2D, pose: CharacterPose, unit: number): void {
  const s = unit / 100 // proportions below are designed for a 100px square
  const g = pose.body
  const up = pose.lift * 30 * s
  const oneFoot = pose.feet.length === 1
  const bend = pose.bend
  const hipY = g.y - 30 * s - up + bend * 8 * s
  const shoulderY = hipY - 24 * s * (1 - bend * 0.25)
  const headY = shoulderY - 12 * s
  const front = pose.facing === -1

  ctx.save()
  // Shadow stays on the ground.
  ctx.fillStyle = `rgba(40, 16, 6, ${0.3 - pose.lift * 0.12})`
  ctx.beginPath()
  const spread = pose.feet.length > 1 ? Math.abs(pose.feet[0].x - pose.feet[1].x) / 2 : 0
  ctx.ellipse(g.x, g.y + 2 * s, (16 + spread / s) * s * (1 - pose.lift * 0.3), 6 * s * (1 - pose.lift * 0.3), 0, 0, Math.PI * 2)
  ctx.fill()

  // Balance wobble pivots around the standing foot.
  ctx.translate(g.x, g.y)
  ctx.rotate(Math.sin(pose.wobble) * 0.05)
  ctx.translate(-g.x, -g.y)

  const leg = (from: Vec, knee: Vec | null, to: Vec, raised = false) => {
    ctx.strokeStyle = PALETTE.skin
    ctx.lineWidth = 6.5 * s
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    if (knee) ctx.lineTo(knee.x, knee.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    // White ankle sock and blue slipper.
    ctx.strokeStyle = "#fbf6ea"
    ctx.lineWidth = 6.8 * s
    ctx.beginPath()
    ctx.moveTo(to.x, to.y - 4.5 * s)
    ctx.lineTo(to.x, to.y - 1.5 * s)
    ctx.stroke()
    ctx.fillStyle = raised ? "#2659b0" : PALETTE.sandal
    ctx.beginPath()
    ctx.ellipse(to.x, to.y, 6.5 * s, 3.2 * s, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  const hipL = { x: g.x - 4.5 * s, y: hipY }
  const hipR = { x: g.x + 4.5 * s, y: hipY }
  if (pose.lift > 0.05) {
    // Mid-hop: knees tucked.
    leg(hipL, { x: g.x - 8 * s, y: hipY + 12 * s }, { x: g.x - 5 * s, y: hipY + 22 * s })
    leg(hipR, { x: g.x + 8 * s, y: hipY + 12 * s }, { x: g.x + 5 * s, y: hipY + 22 * s })
  } else if (oneFoot) {
    const f = pose.feet[0]
    leg(hipR, { x: g.x + 10 * s, y: hipY + 13 * s }, { x: g.x + 7 * s, y: hipY + 21 * s }, true) // raised leg
    leg(hipL, null, { x: f.x, y: f.y })
  } else {
    const [a, b] = [...pose.feet].sort((p, q) => p.x - q.x)
    leg(hipL, null, a)
    leg(hipR, null, b ?? a)
  }

  // Arms: out wide for balance on one foot or mid-air, relaxed otherwise, one reaching down to pick up.
  const balancing = oneFoot || pose.lift > 0.05
  const arm = (side: -1 | 1) => {
    const sh = { x: g.x + side * 9 * s, y: shoulderY + 3 * s }
    let hand: Vec
    if (bend > 0.05 && side === 1) hand = { x: g.x + 12 * s, y: g.y - 6 * s + (1 - bend) * 20 * s }
    else if (balancing) hand = { x: g.x + side * 25 * s, y: shoulderY - 4 * s }
    else hand = { x: g.x + side * 13 * s, y: shoulderY + 21 * s }
    ctx.strokeStyle = PALETTE.skin
    ctx.lineWidth = 5.5 * s
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(sh.x, sh.y)
    ctx.lineTo(hand.x, hand.y)
    ctx.stroke()
    // Short white shirt sleeve.
    ctx.strokeStyle = "#fbf6ea"
    ctx.lineWidth = 7.5 * s
    ctx.beginPath()
    ctx.moveTo(sh.x, sh.y)
    ctx.lineTo(sh.x + (hand.x - sh.x) * 0.3, sh.y + (hand.y - sh.y) * 0.3)
    ctx.stroke()
    if (pose.carrying && side === 1) {
      ctx.fillStyle = PALETTE.stone
      ctx.strokeStyle = PALETTE.stoneDark
      ctx.lineWidth = 1.2 * s
      ctx.beginPath()
      ctx.ellipse(hand.x, hand.y + 2 * s, 4.5 * s, 3.4 * s, 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }
  arm(-1)
  arm(1)

  // Pinafore dress over a white shirt.
  const dress = pose.hurt > 0 ? mix(PALETTE.shirt, PALETTE.fault, pose.hurt) : PALETTE.shirt
  ctx.fillStyle = "#fbf6ea"
  roundedTrapezoid(ctx, g.x, shoulderY, 18 * s, 18 * s, 10 * s)
  ctx.fill()
  ctx.fillStyle = dress
  ctx.beginPath()
  ctx.moveTo(g.x - 8 * s, shoulderY + 2 * s)
  ctx.lineTo(g.x + 8 * s, shoulderY + 2 * s)
  ctx.lineTo(g.x + 15 * s, hipY + 7 * s)
  ctx.quadraticCurveTo(g.x, hipY + 10 * s, g.x - 15 * s, hipY + 7 * s)
  ctx.closePath()
  ctx.fill()
  // Gold belt and hem trim.
  ctx.strokeStyle = PALETTE.shirtStripe
  ctx.lineWidth = 2.4 * s
  ctx.beginPath()
  ctx.moveTo(g.x - 11 * s, hipY - 6 * s)
  ctx.lineTo(g.x + 11 * s, hipY - 6 * s)
  ctx.stroke()
  ctx.strokeStyle = "rgba(0,0,0,0.15)"
  ctx.lineWidth = 1.4 * s
  ctx.beginPath()
  ctx.moveTo(g.x - 5 * s, hipY - 4 * s)
  ctx.lineTo(g.x - 7 * s, hipY + 7 * s)
  ctx.moveTo(g.x + 5 * s, hipY - 4 * s)
  ctx.lineTo(g.x + 7 * s, hipY + 7 * s)
  ctx.stroke()

  // Neck and head.
  ctx.fillStyle = PALETTE.skinShade
  ctx.fillRect(g.x - 3 * s, headY + 8 * s, 6 * s, 6 * s)
  ctx.fillStyle = front ? PALETTE.skin : PALETTE.hair
  ctx.beginPath()
  ctx.arc(g.x, headY, 12 * s, 0, Math.PI * 2)
  ctx.fill()
  if (front) {
    // Hairline across the top of the face.
    ctx.fillStyle = PALETTE.hair
    ctx.beginPath()
    ctx.arc(g.x, headY, 12.3 * s, Math.PI * 1.02, Math.PI * 1.98)
    ctx.quadraticCurveTo(g.x, headY - 4 * s, g.x - 12.2 * s, headY - 1.5 * s)
    ctx.fill()
  }
  // Afro puffs with yellow ties.
  for (const side of [-1, 1]) {
    ctx.fillStyle = PALETTE.hair
    ctx.beginPath()
    ctx.arc(g.x + side * 10.5 * s, headY - 10 * s, 7 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = PALETTE.target
    ctx.beginPath()
    ctx.ellipse(g.x + side * 7.5 * s, headY - 6.5 * s, 2.6 * s, 1.8 * s, side * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  if (front) {
    const hurt = pose.hurt > 0.3
    ctx.fillStyle = PALETTE.ink
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = 1.5 * s
    for (const side of [-1, 1]) {
      const ex = g.x + side * 4.5 * s
      const ey = headY + 1.5 * s
      if (hurt) {
        ctx.beginPath()
        ctx.moveTo(ex - 2 * s, ey - 2 * s)
        ctx.lineTo(ex + 2 * s, ey + 2 * s)
        ctx.moveTo(ex + 2 * s, ey - 2 * s)
        ctx.lineTo(ex - 2 * s, ey + 2 * s)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(ex, ey, 1.9 * s, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.lineWidth = 1.6 * s
    ctx.beginPath()
    if (hurt) ctx.arc(g.x, headY + 9 * s, 3 * s, Math.PI * 1.15, Math.PI * 1.85)
    else ctx.arc(g.x, headY + 5 * s, 3.4 * s, Math.PI * 0.15, Math.PI * 0.85)
    ctx.stroke()
    ctx.fillStyle = "rgba(228, 87, 46, 0.35)"
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(g.x + side * 7.5 * s, headY + 5 * s, 2 * s, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    // Back of the head: a neat centre parting.
    ctx.strokeStyle = "rgba(255,255,255,0.12)"
    ctx.lineWidth = 1.2 * s
    ctx.beginPath()
    ctx.moveTo(g.x, headY - 11 * s)
    ctx.lineTo(g.x, headY + 6 * s)
    ctx.stroke()
  }
  ctx.restore()
}

function roundedTrapezoid(ctx: CanvasRenderingContext2D, cx: number, top: number, wTop: number, wBottom: number, h: number): void {
  ctx.beginPath()
  ctx.moveTo(cx - wTop / 2, top + h * 0.4)
  ctx.quadraticCurveTo(cx - wTop / 2, top, cx, top)
  ctx.quadraticCurveTo(cx + wTop / 2, top, cx + wTop / 2, top + h * 0.4)
  ctx.lineTo(cx + wBottom / 2, top + h)
  ctx.lineTo(cx - wBottom / 2, top + h)
  ctx.closePath()
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}
