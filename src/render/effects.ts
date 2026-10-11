import type { Vec } from "../core/board"

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  gravity: number
  spin: number
  rot: number
  shape: "dot" | "rect"
}

interface FloatingText {
  text: string
  x: number
  y: number
  life: number
  max: number
  color: string
  size: number
}

const CONFETTI = ["#ffd23f", "#1f8a5b", "#e4572e", "#2f6fd6", "#fbf6ea", "#ff8fab"]

/** Screen-space particles (chalk dust, confetti) and rising score text. Times are in seconds. */
export class Effects {
  private particles: Particle[] = []
  private texts: FloatingText[] = []

  dust(at: Vec, amount = 14, color = "rgba(251, 236, 210, 0.8)"): void {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 20 + Math.random() * 60
      this.particles.push({ x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, life: 0, max: 0.4 + Math.random() * 0.35, size: 1.5 + Math.random() * 3, color, gravity: 0, spin: 0, rot: 0, shape: "dot" })
    }
  }

  confetti(at: Vec, amount = 40): void {
    for (let i = 0; i < amount; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
      const sp = 140 + Math.random() * 220
      this.particles.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 1 + Math.random() * 0.8,
        size: 4 + Math.random() * 4,
        color: CONFETTI[i % CONFETTI.length],
        gravity: 420,
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * Math.PI,
        shape: "rect",
      })
    }
  }

  text(text: string, at: Vec, color = "#fff", size = 20): void {
    this.texts.push({ text, x: at.x, y: at.y, life: 0, max: 1.15, color, size })
  }

  clear(): void {
    this.particles = []
    this.texts = []
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.life += dt
      p.vy += p.gravity * dt
      p.vx *= 1 - dt * 1.5
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.spin * dt
    }
    this.particles = this.particles.filter((p) => p.life < p.max)
    for (const t of this.texts) {
      t.life += dt
      t.y -= 38 * dt
    }
    this.texts = this.texts.filter((t) => t.life < t.max)
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max)
      ctx.fillStyle = p.color
      if (p.shape === "dot") {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    for (const t of this.texts) {
      const k = t.life / t.max
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
      const pop = k < 0.12 ? 0.7 + (k / 0.12) * 0.3 : 1
      ctx.font = `800 ${Math.round(t.size * pop)}px "Nunito Variable", ui-rounded, system-ui, sans-serif`
      ctx.lineWidth = 4
      ctx.strokeStyle = "rgba(43, 26, 18, 0.85)"
      ctx.strokeText(t.text, t.x, t.y)
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.globalAlpha = 1
  }
}
