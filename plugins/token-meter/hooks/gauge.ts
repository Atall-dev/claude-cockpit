// The meter's drawing: pure, no JSX and no engine values, so node can render it for previews.

// Gauge scale: the next milestone above the total, so the pointer always moves.
export const GOALS = [1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7, 1e8, 2.5e8, 5e8, 1e9]
export const fmtGoal = (n: number) =>
  n >= 1e9 ? `${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : `${+(n / 1e3).toFixed(1)}K`

// The readout split into figure and unit, so the unit can be drawn smaller.
export const parts = (n: number): [string, string] =>
  // the unit is picked after rounding, so 999 995 reads 1.00M, not 1000K
  n >= 999_500 ? [(n / 1e6).toFixed(2), 'M'] : n >= 99_950 ? [(n / 1e3).toFixed(0), 'K'] : n >= 1e3 ? [(n / 1e3).toFixed(1), 'K'] : [String(n), '']

export const progress = (total: number) => {
  const goal = GOALS.find(g => g > total) ?? total
  return { goal, frac: goal === 0 ? 0 : Math.min(1, total / goal) }
}

// 1-bit, like the BUS pane: one ink on black, every tone between is a dither pattern, never a grey.
export const INK = '#ece8dc'
const BG = '#000000'
export const DIM = '#8f8b80' // terminal only, where no dither exists

// CSS pixels per cell, measured in the editor (a 62-cell band is ~595px) and rounded up: the surface caps an
// Svg without a width prop at its slot and scales it down, so a little too wide always fills the row.
const CELL_PX = 10.5
export const slotPx = (columns: number | undefined) => Math.round(Math.max(420, Math.min(2400, (columns || 80) * CELL_PX)))

const H = 48
const X0 = 168

// Dither tone in 2px dots: big enough to survive the slight downscale to the slot without moire.
const PATTERNS =
  `<pattern id="d50" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${INK}"/><rect x="2" y="2" width="2" height="2" fill="${INK}"/></pattern>`

// An empty cell is a ':' of two 2px dots on its centre. A pattern there beats against the cell pitch and
// leaves uneven gaps; dots placed per cell stay even at any width.
const colon = (x: number, w: number, y: number, gap: number) => {
  const cx = Math.round(x + w / 2 - 1)
  return `M${cx} ${y}h2v2h-2zM${cx} ${y + gap}h2v2h-2z`
}

// A still image: no slide, no fade. Every redraw is a new picture for the editor, so the only motion is the
// pointer blinking in two steps while a turn runs.
export const gaugeSvg = (total: number, goal: number, frac: number, isWorking: boolean, W: number) => {
  const X1 = W - 18
  const font = `font-family="Consolas,ui-monospace,SFMono-Regular,monospace"`
  const [num, unit] = parts(total)

  // brackets, then cells: solid where used, a half-dithered head, sparse dots for what is left
  const bx0 = X0 + 7
  const bx1 = X1 - 7
  const segs = Math.max(16, Math.floor((bx1 - bx0 + 2) / 8))
  const sw = (bx1 - bx0 + 2) / segs
  const lit = frac * segs
  const full = Math.min(segs - 1, Math.floor(lit))
  let solid = ''
  let rest = ''
  for (let i = 0; i < segs; i++) {
    const cell = `M${(bx0 + i * sw).toFixed(1)} 17h${(sw - 2).toFixed(1)}v10h${(2 - sw).toFixed(1)}z`
    if (i < full) solid += cell
    else if (i > full) rest += colon(bx0 + i * sw, sw - 2, 19, 4)
  }
  const hx = bx0 + full * sw
  const head = `<path d="M${hx.toFixed(1)} 17h${(sw - 2).toFixed(1)}v10h${(2 - sw).toFixed(1)}z" fill="url(#d50)"/>`

  // marks under the bar on round values: goals are 1, 2.5 or 5 x 10^k, so quarters of 1 and fifths of 2.5
  // and 5 (no 62.5K or 1.88M)
  let marks = ''
  const n = goal / 10 ** Math.floor(Math.log10(goal || 1)) === 1 ? 4 : 5
  const labels = Array.from({ length: n + 1 }, (_, i) => i / n)
    .map(f => {
      const x = bx0 + f * (bx1 - bx0)
      marks += `M${Math.round(x)} 31h2v3h-2z`
      const anchor = f === 0 ? 'start' : f === 1 ? 'end' : 'middle'
      return `<text x="${(f === 0 ? X0 : f === 1 ? X1 : x).toFixed(1)}" y="45" text-anchor="${anchor}" ${font} font-size="11" fill="${INK}">${f === 0 ? '0' : fmtGoal(goal * f)}</text>`
    })
    .join('')

  const blink = isWorking
    ? `<animate attributeName="opacity" values="1;0" dur="1.2s" calcMode="discrete" repeatCount="indefinite"/>`
    : ''
  const cx = hx + (sw - 2) / 2
  const pointer = `<path d="M${(cx - 4).toFixed(1)} 6h8l-4 7z" fill="${INK}">${blink}</path>`

  const bracket = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x + dx * 9} ${y} H${x} V${y + dy * 9}" fill="none" stroke="${INK}" stroke-width="1.5"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">
  <defs>${PATTERNS}</defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${bracket(1, 1, 1, 1)}${bracket(W - 1, 1, -1, 1)}${bracket(1, H - 1, 1, -1)}${bracket(W - 1, H - 1, -1, -1)}
  <text x="16" y="17" ${font} font-size="11" letter-spacing="2" fill="${INK}">TOKENS</text>
  <path d="M84 14h${X0 - 98}" stroke="${INK}" stroke-dasharray="2 3"/>
  <text x="16" y="40" ${font} font-size="22" font-weight="700" fill="${INK}">${num}<tspan font-size="12" dx="3">${unit}</tspan></text>
  <path d="M${X0 + 4} 15h-3.5v14h3.5M${X1 - 4} 15h3.5v14h-3.5" fill="none" stroke="${INK}" stroke-width="1.5"/>
  <path d="${solid}" fill="${INK}"/>${head}<path d="${rest}" fill="${INK}"/>
  <path d="${marks}" fill="${INK}"/>
  ${pointer}
  ${labels}
</svg>`
}

// ---------- the phosphor tube: one hue at different strengths, amber or firefly ----------
// The BUS pane draws the same two palettes (bus/hooks/styles.ts); each plugin installs alone, so each
// keeps its copy.

export type Tube = { bg: string; edge: string; lab: string; num: string; unit: string; fill: string; rest: string; restTerm: string; ptr: string }

export const AMBER: Tube = {
  bg: '#140d05',
  edge: '#4a3212',
  lab: '#b08035',
  num: '#ffc46b',
  unit: '#e8962a',
  fill: '#ff9d1c',
  rest: '#3b2a12',
  restTerm: '#5a3f17',
  ptr: '#ffd27a',
}

// a summer night in the grass: deep moss, acid lime light
export const FIREFLY: Tube = {
  bg: '#0a110b',
  edge: '#2b4224',
  lab: '#8fb05f',
  num: '#d9ff5c',
  unit: '#a6d838',
  fill: '#b8f23a',
  rest: '#1f3219',
  restTerm: '#33502a',
  ptr: '#eaff9a',
}

// The configured look: 1-bit draws its own gauge, anything else is a tube palette (amber by default).
export const tubeFor = (style: unknown): Tube | null => (style === '1bit' ? null : style === 'firefly' ? FIREFLY : AMBER)

// The pointer eases once from where it was last drawn (a transition, not a loop: it ends and holds), and
// pulses in held steps while a turn runs.
export const tubeGaugeSvg = (total: number, goal: number, from: number, to: number, isWorking: boolean, W: number, P: Tube = AMBER) => {
  const X1 = W - 18
  const span = X1 - X0
  // One tick per ~10px, a multiple of 20 so quarter and fifth marks both land on ticks.
  const TICKS = Math.max(20, Math.round(span / 200) * 20)
  const p0 = (X0 + from * span).toFixed(1)
  const p1 = (X0 + to * span).toFixed(1)
  const font = `font-family="Consolas,ui-monospace,SFMono-Regular,monospace"`
  const ease = `dur="0.9s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"`
  const [num, unit] = parts(total)
  // round marks, as the 1-bit gauge: quarters of 1 x 10^k, fifths of 2.5 and 5 x 10^k
  const n = goal / 10 ** Math.floor(Math.log10(goal || 1)) === 1 ? 4 : 5

  let ticks = ''
  for (let i = 0; i <= TICKS; i++) {
    const x = X0 + (i * span) / TICKS
    const major = i % (TICKS / n) === 0
    const lit = x <= X0 + to * span
    ticks += `<line x1="${x.toFixed(1)}" y1="${major ? 22 : 27}" x2="${x.toFixed(1)}" y2="31" stroke="${lit ? P.fill : P.rest}"/>`
  }
  const labels = Array.from({ length: n + 1 }, (_, i) => i / n)
    .map(f => {
      const anchor = f === 0 ? 'start' : f === 1 ? 'end' : 'middle'
      return `<text x="${(X0 + f * span).toFixed(1)}" y="44" text-anchor="${anchor}" ${font} font-size="11" fill="${P.lab}">${f === 0 ? '0' : fmtGoal(goal * f)}</text>`
    })
    .join('')
  const pulse = isWorking
    ? `<animate attributeName="opacity" values="1;0.6;0.35;0.6" dur="0.9s" calcMode="discrete" repeatCount="indefinite"/>`
    : ''
  const slide = from === to ? '' : `<animateTransform attributeName="transform" type="translate" from="${p0} 0" to="${p1} 0" ${ease}/>`
  const grow = from === to ? '' : `<animate attributeName="x2" from="${p0}" to="${p1}" ${ease}/>`
  const bracket = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x + dx * 8} ${y} H${x} V${y + dy * 8}" fill="none" stroke="${P.lab}" stroke-width="1.5"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${P.bg}"/>
  ${bracket(1, 1, 1, 1)}${bracket(W - 1, 1, -1, 1)}${bracket(1, H - 1, 1, -1)}${bracket(W - 1, H - 1, -1, -1)}
  <text x="16" y="17" ${font} font-size="11" letter-spacing="2" fill="${P.lab}">TOKENS</text>
  <text x="16" y="40" ${font} font-size="22" font-weight="700" fill="${P.num}">${num}<tspan font-size="12" fill="${P.unit}" dx="3">${unit}</tspan></text>
  <line x1="${X0}" y1="31" x2="${X1}" y2="31" stroke="${P.rest}"/>
  <line x1="${X0}" y1="31" x2="${p1}" y2="31" stroke="${P.fill}" stroke-width="2.5">${grow}</line>
  ${ticks}
  <g transform="translate(${p1} 0)">${slide}
    <path d="M0 21 l-5 -9 h10 z" fill="${P.ptr}">${pulse}</path>
  </g>
  ${labels}
</svg>`
}
