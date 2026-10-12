/** Hand-drawn style SVG illustrations for the menus (no external images). */

/** A small chalk Suwe board with a stone, for the home screen. */
export const HERO_BOARD = `
<svg viewBox="0 0 200 240" class="hero-art" aria-hidden="true">
  <defs>
    <filter id="chalk" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="4" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.4 1.7" result="mask"/>
      <feComposite in="SourceGraphic" in2="mask" operator="in"/>
    </filter>
  </defs>
  <g filter="url(#chalk)" fill="none" stroke="#fbf6ea" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity=".95">
    <path d="M64 54a36 36 0 0 1 72 0z"/>
    <rect x="82" y="54" width="36" height="22"/>
    <rect x="64" y="76" width="36" height="22"/><rect x="100" y="76" width="36" height="22"/>
    <rect x="82" y="98" width="36" height="22"/>
    <rect x="64" y="120" width="36" height="22"/><rect x="100" y="120" width="36" height="22"/>
    <rect x="82" y="142" width="36" height="22"/>
    <rect x="82" y="164" width="36" height="22"/>
    <rect x="82" y="186" width="36" height="22"/>
    <path d="M44 224h112" stroke-dasharray="9 7"/>
  </g>
  <g filter="url(#chalk)" fill="#fbf6ea" font-family="Chalkboard SE, Marker Felt, Comic Sans MS, sans-serif" font-weight="700" font-size="15" text-anchor="middle" opacity=".92">
    <text x="100" y="203">1</text><text x="100" y="181">2</text><text x="100" y="159">3</text>
    <text x="82" y="137">4</text><text x="118" y="137">5</text>
    <text x="100" y="115">6</text>
    <text x="82" y="93">7</text><text x="118" y="93">8</text>
    <text x="100" y="71">9</text>
    <text x="100" y="44" font-size="9" letter-spacing="1">REST</text>
  </g>
  <g transform="translate(118 132) rotate(-12)">
    <ellipse cx="2" cy="4" rx="9" ry="6" fill="#3c1a0a" opacity=".35"/>
    <path d="M-9 1c-.6-4.6 3.4-8 9-8s9.6 2.8 9.2 7.2C8.8 4.4 4.6 6.6 0 6.6S-8.4 5.2-9 1z" fill="#8a8f96" stroke="#55595f" stroke-width="1.4"/>
    <path d="M-4.6 .6c2.6-1.2 5.6-1.4 8.4-.4" stroke="#fff" stroke-opacity=".55" stroke-width="1.2" fill="none"/>
  </g>
</svg>`

export const HOWTO_ART = {
  throw: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="20" y="8" width="24" height="18" fill="none" stroke="#fbf6ea" stroke-width="2.5" rx="1"/><rect x="20" y="26" width="24" height="18" fill="rgba(255,210,63,.35)" stroke="#ffd23f" stroke-width="2.5" rx="1"/><path d="M32 60c0-8-2-14 0-22" stroke="#fbf6ea" stroke-width="2.5" stroke-dasharray="3 4" fill="none"/><ellipse cx="32" cy="35" rx="5" ry="4" fill="#8a8f96" stroke="#55595f" stroke-width="1.4"/></svg>`,
  hop: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="22" y="40" width="20" height="16" fill="rgba(126,224,161,.35)" stroke="#7ee0a1" stroke-width="2.5"/><rect x="22" y="24" width="20" height="16" fill="none" stroke="#fbf6ea" stroke-width="2.5"/><rect x="12" y="8" width="20" height="16" fill="none" stroke="#fbf6ea" stroke-width="2.5"/><rect x="32" y="8" width="20" height="16" fill="none" stroke="#fbf6ea" stroke-width="2.5"/><ellipse cx="32" cy="32" rx="4.5" ry="3.5" fill="#8a8f96"/><path d="M27 50c2-6 8-6 10 0" stroke="#ffd23f" stroke-width="2.5" fill="none"/><path d="M18 22c4-6 24-6 28 0" stroke="#ffd23f" stroke-width="2.5" fill="none" stroke-dasharray="3 3"/></svg>`,
  pickup: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 28a20 20 0 0 1 40 0z" fill="none" stroke="#fbf6ea" stroke-width="2.5"/><rect x="22" y="28" width="20" height="16" fill="none" stroke="#fbf6ea" stroke-width="2.5"/><rect x="22" y="44" width="20" height="16" fill="none" stroke="#fbf6ea" stroke-width="2.5"/><ellipse cx="32" cy="52" rx="5" ry="4" fill="#8a8f96" stroke="#55595f" stroke-width="1.4"/><path d="M40 18c6 4 6 12 0 16" stroke="#ffd23f" stroke-width="2.5" fill="none"/><path d="M37 32l3 2.5 3.5-2" stroke="#ffd23f" stroke-width="2.5" fill="none"/></svg>`,
  lines: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="14" width="36" height="36" fill="none" stroke="#fbf6ea" stroke-width="3"/><ellipse cx="50" cy="32" rx="6" ry="9" fill="none" stroke="#ff4d4d" stroke-width="2.5"/><path d="M44 26l12 12M56 26 44 38" stroke="#ff4d4d" stroke-width="2.5"/><circle cx="28" cy="32" r="9" fill="none" stroke="#7ee0a1" stroke-width="2.5"/><path d="M24 32l3 3 5-6" stroke="#7ee0a1" stroke-width="2.5" fill="none"/></svg>`,
}

/**
 * A chalk board preview in any palette, drawn from the real board layout (rows from the throw line
 * up). Used to show the Colourful Chalk Pack colours before and after buying.
 */
export function boardPreviewSvg(rows: number[][], colors: (row: number) => string): string {
  const cw = 34
  const ch = 21
  const n = rows.length
  const top = 50
  const width = 200
  const parts: string[] = []
  const texts: string[] = []
  rows.forEach((ids, r) => {
    const y = top + (n - 1 - r) * ch
    const x0 = width / 2 - (ids.length * cw) / 2
    const c = `rgb(${colors(r)})`
    ids.forEach((id, i) => {
      parts.push(`<rect x="${x0 + i * cw}" y="${y}" width="${cw}" height="${ch}" stroke="${c}"/>`)
      texts.push(`<text x="${x0 + i * cw + cw / 2}" y="${y + 15.5}" fill="${c}">${id}</text>`)
    })
  })
  const rest = `rgb(${colors(n)})`
  const line = `rgb(${colors(-1)})`
  const bottom = top + n * ch
  return `<svg viewBox="0 0 ${width} ${bottom + 22}" aria-hidden="true">
  <g fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${width / 2 - 36} ${top}a36 36 0 0 1 72 0z" stroke="${rest}"/>
    ${parts.join("")}
    <path d="M44 ${bottom + 14}h112" stroke="${line}" stroke-dasharray="9 7"/>
  </g>
  <g font-family="Gochi Hand, Chalkboard SE, Comic Sans MS, sans-serif" font-size="15" text-anchor="middle">
    ${texts.join("")}
    <text x="${width / 2}" y="${top - 9}" font-size="9" letter-spacing="1" fill="${rest}">REST</text>
  </g>
</svg>`
}
