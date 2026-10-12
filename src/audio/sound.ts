/**
 * Small synthesised sound effects (Web Audio, no files to download). The audio context is only
 * created on the player's first tap, as browsers and the Vatar review checklist require, and is
 * suspended whenever the game pauses.
 */
export type SoundName = "tap" | "throw" | "land" | "success" | "miss" | "hop" | "pickup" | "round" | "level" | "gameover" | "tick"

export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private mutedValue: boolean
  private paused = false

  constructor(muted: boolean) {
    this.mutedValue = muted
  }

  /** True while suspended by a pause (independent of mute). */
  get isPaused(): boolean {
    return this.paused
  }

  get muted(): boolean {
    return this.mutedValue
  }

  setMuted(m: boolean): void {
    this.mutedValue = m
    if (this.master) this.master.gain.value = m ? 0 : 0.55
  }

  /** Call from a user gesture handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !this.paused) void this.ctx.resume().catch(() => {})
      return
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.mutedValue ? 0 : 0.55
      this.master.connect(this.ctx.destination)
    } catch {
      this.ctx = null
    }
  }

  pause(): void {
    this.paused = true
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend().catch(() => {})
  }

  resume(): void {
    this.paused = false
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume().catch(() => {})
  }

  play(name: SoundName): void {
    const ctx = this.ctx
    if (!ctx || !this.master || this.mutedValue || this.paused || ctx.state !== "running") return
    const t = ctx.currentTime
    switch (name) {
      case "tap":
        this.tone(660, t, 0.06, "triangle", 0.25)
        break
      case "tick":
        this.tone(1200, t, 0.03, "square", 0.06)
        break
      case "throw":
        this.noise(t, 0.28, 900, 2600, 0.35)
        break
      case "land":
        this.tone(110, t, 0.12, "sine", 0.6, 60)
        this.noise(t, 0.1, 400, 300, 0.3)
        break
      case "hop":
        this.tone(240, t, 0.09, "sine", 0.4, 120)
        break
      case "pickup":
        this.tone(520, t, 0.08, "triangle", 0.3)
        this.tone(780, t + 0.07, 0.1, "triangle", 0.3)
        break
      case "success":
        ;[523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.07, 0.16, "triangle", 0.32))
        break
      case "round":
        ;[523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.08, 0.2, "triangle", 0.32))
        break
      case "level":
        ;[392, 523, 659, 784, 659, 1047].forEach((f, i) => this.tone(f, t + i * 0.1, 0.24, "triangle", 0.34))
        break
      case "miss":
        this.tone(220, t, 0.18, "sawtooth", 0.18, 150)
        this.tone(165, t + 0.12, 0.25, "sawtooth", 0.18, 110)
        break
      case "gameover":
        ;[392, 330, 262, 196].forEach((f, i) => this.tone(f, t + i * 0.16, 0.3, "triangle", 0.3))
        break
    }
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, endFreq?: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    osc.connect(gain).connect(this.master!)
    osc.start(at)
    osc.stop(at + dur + 0.02)
  }

  private noise(at: number, dur: number, fromHz: number, toHz: number, vol: number): void {
    const ctx = this.ctx!
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = "bandpass"
    filter.Q.value = 1.2
    filter.frequency.setValueAtTime(fromHz, at)
    filter.frequency.exponentialRampToValueAtTime(toHz, at + dur)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(vol, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(filter).connect(gain).connect(this.master!)
    src.start(at)
    src.stop(at + dur + 0.02)
  }
}
