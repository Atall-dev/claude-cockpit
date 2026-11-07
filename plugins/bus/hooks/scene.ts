// The living picture under the card: its own Svg, so the card stays a still image and only this small
// one is redrawn frame by frame. One calm loop that never changes with the phase (the card says what
// Claude is doing); only the handoff alarm recolors it.
//   amber:   embers rising from a bed of coals
//   firefly: fireflies drifting and blinking over the grass
//   1bit:    the night sky, dust rising through the window between the clouds, a few stars blinking
//
// Every animation is timed from the wall clock: an element's `begin` is minus how far into its loop
// the clock already is. A redraw with a new source (the alarm, a resize, the sky's clouds moving with
// context) therefore shows every spark exactly where the last image had it; nothing jumps back.
// A loop's length is rounded once, and that one value goes into both `dur` and `begin`: a `begin`
// computed from an unrounded length drifts from the written loop by minutes later.
// An animated attribute is also written statically at its value for that moment, so the first paint,
// before the animations are sampled, is a frame of the running loop and not a dark one.

import { AGENT_SLOTS, bitmapPath, fieldStars, skyLayers, SH, STAR, SW } from './sky'
import type { SkyState } from './sky'
import { BLACK, INK, TUBE } from './styles'
import type { Palette, Style } from './styles'

const PAD = 14
const TUBE_H = 124
// the grass of the firefly scene: dense olive behind, sparse lit blades in front
const GRASS = '#4f6b1f'
const GRASS_FRONT = '#7d9b3a'
// the 1-bit strip: a dot is at most this many CSS pixels; wider panes get more columns, not bigger dots
const DOT_MAX = 3

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const n1 = (v: number) => v.toFixed(1)
const n2 = (v: number) => v.toFixed(2)
// a loop length in tenths of a second: what is written is what is timed
const secs = (v: number) => Math.round(v * 10) / 10
// spreads phases over a loop: no two neighbours in step
const spread = (i: number) => (i * 0.6180339887) % 1

// `begin` for a loop of `dur` seconds with phase `phase` (seconds) at clock `t` (seconds).
export const beginAt = (t: number, dur: number, phase: number) => {
  const into = (((t + phase) % dur) + dur) % dur
  return `${(-into).toFixed(2)}s`
}

// A loop at clock `t`: its `begin`, and how far into it (0..1) the clock is.
const loop = (t: number, dur: number, phase: number) => {
  const into = (((t + phase) % dur) + dur) % dur
  return { begin: `${(-into).toFixed(2)}s`, frac: into / dur }
}

// The value of a `values`/`keyTimes` track at `frac` of its loop: stepped for discrete, else linear
// (close enough to the splines for a first paint). Default keyTimes per SMIL: n - 1 even spans for a
// linear track, n even spans (0, 1/n, 2/n...) for a discrete one.
export const trackAt = (values: number[], keyTimes: number[] | null, frac: number, discrete = false) => {
  const n = values.length
  const kt = keyTimes ?? values.map((_, i) => (discrete ? i / n : i / (n - 1)))
  let i = 0
  while (i < n - 1 && kt[i + 1]! <= frac) i++
  if (discrete || i >= n - 1) return values[i]!
  const span = kt[i + 1]! - kt[i]!
  const u = span > 0 ? (frac - kt[i]!) / span : 0
  return values[i]! + (values[i + 1]! - values[i]!) * u
}

const bracket = (x: number, y: number, dx: number, dy: number, color: string) =>
  `<path d="M${x + dx * 9} ${y} H${x} V${y + dy * 9}" fill="none" stroke="${color}" stroke-width="1.5"/>`

// The bottom two corners of the pane's frame, in the same tone as the switcher row's top ones.
const doc = (W: number, H: number, bg: string, edge: string, body: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"${extra}>` +
  `<rect width="${W}" height="${H}" fill="${bg}"/>${body}` +
  bracket(1, H - 1, 1, -1, edge) + bracket(W - 1, H - 1, -1, -1, edge) +
  `</svg>`

// An opacity loop: the static value for this moment, then the animate element.
const fade = (t: number, dur: number, phase: number, values: number[], keyTimes: number[] | null, spline: string | null) => {
  const { begin, frac } = loop(t, dur, phase)
  const now = trackAt(values, keyTimes, frac)
  const timing = `dur="${n1(dur)}s" begin="${begin}" repeatCount="indefinite"`
  const kt = keyTimes ? ` keyTimes="${keyTimes.join(';')}"` : ''
  const cm = spline ? ` calcMode="spline" keySplines="${spline}"` : ''
  return { now: n2(now), timing, begin, anim: `<animate attributeName="opacity" values="${values.join(';')}"${kt}${cm} ${timing}/>` }
}

// ---------- amber: embers ----------

function embers(P: Palette, W: number, alarm: boolean, t: number) {
  const X = PAD
  const Y = 10
  const w = W - PAD * 2
  const h = TUBE_H
  const bottom = Y + h - 6
  const hot = alarm ? P.hot : P.fill
  const core = alarm ? P.hot : P.ptr
  // the alarm burns brighter: the bed's glow and every halo
  const glow = alarm ? 1.4 : 1
  const r = rng(7)
  const out: string[] = []
  out.push(
    `<defs>` +
      `<radialGradient id="halo"><stop offset="0" stop-color="${hot}" stop-opacity="${n1(Math.min(1, 0.7 * glow))}"/><stop offset="0.35" stop-color="${hot}" stop-opacity="${n1(0.25 * glow)}"/><stop offset="1" stop-color="${hot}" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="bed" cx="0.5" cy="1" r="0.8"><stop offset="0" stop-color="${hot}" stop-opacity="${n1(Math.min(1, 0.45 * glow))}"/><stop offset="0.5" stop-color="${hot}" stop-opacity="${n1(0.1 * glow)}"/><stop offset="1" stop-color="${hot}" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hot}" stop-opacity="0"/><stop offset="1" stop-color="${hot}" stop-opacity="${n1(Math.min(1, 0.55 * glow))}"/></linearGradient>` +
      `<clipPath id="win"><rect x="${X}" y="${Y}" width="${w}" height="${h}"/></clipPath>` +
      `</defs>`,
  )
  out.push(`<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="${P.screen}"/>`)
  const g: string[] = []
  // the coals' glow, breathing slowly
  {
    const f = fade(t, 7, 0, [0.7, 1, 0.7], null, '0.45 0 0.55 1;0.45 0 0.55 1')
    g.push(`<rect x="${X}" y="${Y + h * 0.35}" width="${w}" height="${h * 0.65}" fill="url(#bed)" opacity="${f.now}">${f.anim}</rect>`)
  }
  // a band of light along the bed, where the coals touch the floor
  g.push(`<rect x="${X}" y="${bottom - 10}" width="${w}" height="${Y + h - bottom + 10}" fill="url(#band)"/>`)
  // the bed itself: a row of small embers lying still and dim, brighter toward the middle
  let bed = ''
  for (let x = X + 6; x < X + w - 6; x += 3 + r() * 5) {
    const mid = 1 - Math.abs((x - X) / w - 0.5) * 2
    if (r() < 0.25 + mid * 0.6) bed += `M${n1(x)} ${n1(bottom - r() * 2)}h${n1(1 + r())}v1h${n1(-1 - r())}z`
  }
  g.push(`<path d="${bed}" fill="${hot}" opacity="0.45"/>`)
  // the big coals: a few lumps spread along the bed, each glowing in its own slow breath; the one
  // thing in the bed that is big, so the eye has somewhere to rest
  // Laid at uneven gaps and in uneven sizes: an even row of equal lumps reads as a strip of LEDs.
  const C = Math.max(4, Math.min(6, Math.round(w / 60)))
  const lumps = [0.05, 0.19, 0.3, 0.52, 0.63, 0.86]
  for (let i = 0; i < C; i++) {
    const cx = X + w * (lumps[i]! + 0.06 + r() * 0.04)
    const cw = 10 + r() * 8
    const ch = 5 + r() * 3
    const dur = secs(5 + r() * 3)
    const f = fade(t, dur, spread(i) * dur, [0.6, 1, 0.6], null, '0.45 0 0.55 1;0.45 0 0.55 1')
    g.push(
      `<g>` +
        `<ellipse cx="${n1(cx)}" cy="${n1(bottom - 1)}" rx="${n1(cw * 1.5)}" ry="${n1(cw * 0.8)}" fill="url(#halo)"/>` +
        `<rect x="${n1(cx - cw / 2)}" y="${n1(bottom + 1 - ch)}" width="${n1(cw)}" height="${n1(ch)}" rx="${n1(ch * 0.4)}" fill="${core}" opacity="${f.now}">${f.anim}</rect>` +
        `</g>`,
    )
  }
  // ash far behind: small, dim and slow, drifting the same way, so the sparks have depth
  const A = Math.max(5, Math.round(w / 45))
  for (let i = 0; i < A; i++) {
    const x0 = X + w * (0.08 + 0.84 * ((i + r()) / A))
    const sway = (r() - 0.5) * 24
    const dur = secs(10 + r() * 4)
    const f = fade(t, dur, spread(i + 3) * dur, [0, 0.4, 0.3, 0], [0, 0.15, 0.6, 1], null)
    g.push(
      `<circle r="0.8" fill="${hot}" opacity="${f.now}">` +
        `<animateMotion path="M${n1(x0)} ${bottom} C${n1(x0 + sway)} ${n1(bottom - 50)} ${n1(x0 - sway)} ${n1(Y + 50)} ${n1(x0 + sway * 0.4)} ${Y + 8}" ${f.timing}/>` +
        `${f.anim}</circle>`,
    )
  }
  // the sparks: each rises on its own swaying curve, slows near the top and fades out. The first few
  // are twice the size of the rest, with a tail trailing their motion; the small ones stay dim.
  const N = Math.max(9, Math.round(w / 24))
  const BIG = Math.max(2, Math.min(3, Math.round(w / 110)))
  for (let i = 0; i < N; i++) {
    const big = i < BIG
    // the big ones are born across the width (a fifth, half, four fifths), the small ones anywhere
    const x0 = X + w * (big ? [0.2, 0.55, 0.8][i]! + (r() - 0.5) * 0.06 : 0.12 + 0.76 * ((i + r() * 0.8) / N))
    const sway = (r() - 0.5) * 34
    const top = Y + 14 + r() * 26
    const dur = secs(big ? 6.5 + r() * 1.5 : 4.2 + r() * 2.2)
    const size = big ? 2.6 + r() * 0.6 : 1 + r() * 0.5
    const peak = big ? 1 : 0.6
    const f = fade(t, dur, spread(i) * dur, [0, peak, peak * 0.9, 0], [0, 0.1, 0.55, 1], null)
    const path = `M${n1(x0)} ${bottom} C${n1(x0 + sway)} ${n1(bottom - 40)} ${n1(x0 - sway * 0.8)} ${n1(top + 40)} ${n1(x0 + sway * 0.5)} ${n1(top)}`
    const tail = 9 + r() * 2
    g.push(
      `<g opacity="${f.now}">` +
        `<animateMotion path="${path}" ${f.timing}${big ? ' rotate="auto"' : ''} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.2 0.5 0.5 1"/>` +
        f.anim +
        `<circle r="${n1(size * 4.5)}" fill="url(#halo)"/>` +
        (big ? `<path d="M0 0h-${n1(tail)}" stroke="${hot}" stroke-width="1.4" stroke-linecap="round" opacity="0.55"/>` : '') +
        `<circle r="${n1(size)}" fill="${i % 3 ? hot : core}"><animate attributeName="r" values="${n1(size)};${n1(size * 0.5)}" ${f.timing}/></circle>` +
        `</g>`,
    )
  }
  out.push(`<g clip-path="url(#win)">${g.join('')}</g>`)
  return doc(W, Y + h + 14, P.bg, P.lab, out.join(''))
}

// ---------- firefly: fireflies over the grass ----------

function fireflies(P: Palette, W: number, alarm: boolean, t: number) {
  const X = PAD
  const Y = 10
  const w = W - PAD * 2
  const h = TUBE_H
  const ground = Y + h
  const lit = alarm ? P.hot : P.fill
  const core = alarm ? P.hot : P.ptr
  const r = rng(13)
  const out: string[] = []
  out.push(
    `<defs>` +
      `<radialGradient id="halo"><stop offset="0" stop-color="${lit}" stop-opacity="0.8"/><stop offset="0.35" stop-color="${lit}" stop-opacity="0.24"/><stop offset="1" stop-color="${lit}" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.rest}" stop-opacity="0"/><stop offset="1" stop-color="${P.rest}" stop-opacity="0.5"/></linearGradient>` +
      `<clipPath id="win"><rect x="${X}" y="${Y}" width="${w}" height="${h}"/></clipPath>` +
      `</defs>`,
  )
  out.push(`<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="${P.screen}"/>`)
  const g: string[] = []
  g.push(`<rect x="${X}" y="${Y + h * 0.45}" width="${w}" height="${h * 0.55}" fill="url(#haze)"/>`)
  // far stars over the field, still and faint
  let stars = ''
  const q = rng(3)
  for (let i = 0; i < Math.round(w / 22); i++) stars += `M${n1(X + 4 + q() * (w - 8))} ${n1(Y + 4 + q() * h * 0.35)}h1v1h-1z`
  g.push(`<path d="${stars}" fill="${P.lab}" opacity="0.45"/>`)
  // grass in two layers: a dense stand of tall olive blades behind, a few short lit blades in front;
  // blades are thin curved spikes
  const blades = (seed: number, minH: number, maxH: number, step: number, width: number, fill: string) => {
    const q = rng(seed)
    let d = ''
    for (let x = X - 2; x < X + w + 2; x += step * (0.5 + q())) {
      const bh = minH + q() * (maxH - minH)
      const lean = (q() - 0.5) * bh * 0.7
      const bw = width + q() * width
      d += `M${n1(x)} ${ground}Q${n1(x + lean * 0.3)} ${n1(ground - bh * 0.6)} ${n1(x + lean)} ${n1(ground - bh)}Q${n1(x + bw + lean * 0.3)} ${n1(ground - bh * 0.5)} ${n1(x + bw)} ${ground}Z`
    }
    return `<path d="${d}" fill="${fill}"/>`
  }
  g.push(blades(21, 20, 44, 1.5, 2.2, GRASS))
  // fireflies sit between the two layers: the front blades pass in front of the low ones. Each has its
  // own patch of the field, spread over the whole sky and never closer than `apart` to another, its
  // own pace and its own blink phase.
  const N = Math.max(7, Math.round(w / 32))
  const x0 = X + w * 0.08
  const x1 = X + w * 0.92
  const y0 = Y + 12
  const y1 = ground - 24
  const apart = Math.sqrt(((x1 - x0) * (y1 - y0)) / N) * 0.75
  const homes: [number, number][] = []
  for (let i = 0; i < N; i++) {
    let best: [number, number] = [x0, y0]
    let bestD = -1
    for (let k = 0; k < 40; k++) {
      const c: [number, number] = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)]
      const d = Math.min(Infinity, ...homes.map(([hx, hy]) => Math.hypot(hx - c[0], hy - c[1])))
      if (d >= apart) { best = c; break }
      if (d > bestD) { best = c; bestD = d }
    }
    homes.push(best)
  }
  const flies: string[] = []
  homes.forEach(([cx, cy], i) => {
    const rx = 7 + r() * 8
    const ry = 4 + r() * 5
    const dir = r() < 0.5 ? 1 : -1
    // a lazy figure-eight-ish loop around (cx, cy)
    const path =
      `M${n1(cx)} ${n1(cy)}` +
      `C${n1(cx + rx * dir)} ${n1(cy - ry)} ${n1(cx + rx * 1.4 * dir)} ${n1(cy + ry)} ${n1(cx)} ${n1(cy + ry * 0.4)}` +
      `C${n1(cx - rx * dir)} ${n1(cy - ry * 0.2)} ${n1(cx - rx * 1.2 * dir)} ${n1(cy - ry * 1.3)} ${n1(cx)} ${n1(cy)}Z`
    const move = secs(11 + r() * 8)
    const blink = secs(3.2 + r() * 2.8)
    const f = fade(t, blink, spread(i) * blink, [0.1, 0.1, 1, 0.85, 0.1], [0, 0.4, 0.55, 0.72, 1], '0 0 1 1;0.3 0 0.4 1;0.4 0 0.6 1;0.4 0 0.6 1')
    flies.push(
      `<g>` +
        `<animateMotion path="${path}" dur="${n1(move)}s" begin="${beginAt(t, move, spread(i + 5) * move)}" repeatCount="indefinite"/>` +
        `<g opacity="${f.now}">${f.anim}` +
        `<circle r="11" fill="url(#halo)"/><circle r="1.7" fill="${core}"/></g>` +
        `</g>`,
    )
  })
  g.push(...flies)
  g.push(blades(34, 5, 12, 6, 1, GRASS_FRONT))
  out.push(`<g clip-path="url(#win)">${g.join('')}</g>`)
  return doc(W, Y + h + 14, P.bg, P.lab, out.join(''))
}

// ---------- 1-bit: the sky ----------

// The strip's dot size and column count for a pane: square dots, never stretched. Up to the base width
// the SW columns fill the pane; wider, the dots stop growing and columns are added instead.
export const skyGrid = (W: number) => {
  const w = W - PAD * 2
  const dot = Math.min(w / SW, DOT_MAX)
  const cols = dot < DOT_MAX ? SW : Math.round(w / DOT_MAX)
  return { dot, cols, w: cols * dot, h: SH * dot }
}

function sky(s: SkyState, W: number, t: number) {
  const top = 4
  const { dot, cols, w, h } = skyGrid(W)
  const L = PAD + (W - PAD * 2 - w) / 2
  const { px, near } = skyLayers(s, cols)
  const cx = Math.floor(cols / 2)
  // clear sky: no cloud here nor within CLEAR dots, so a blinking dot never lands on one
  const clear = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < SH && !near[y * cols + x]
  const r = rng(5)
  const parts: string[] = [`<path d="${bitmapPath(px, cols)}" fill="${INK}"/>`]
  // dust: single dots of ink, a few as tiny crosses, drifting up through the window between the slots.
  // They leave the ground and vanish past the top: ink on ink hides the start.
  for (let i = 0; i < 5; i++) {
    const x = cx - 10 + 20 * ((i + r()) / 5)
    const dur = secs(9 + r() * 5)
    const timing = `dur="${n1(dur)}s" begin="${beginAt(t, dur, spread(i) * dur)}" repeatCount="indefinite"`
    const shape = i % 2 === 0 ? `<path d="M0 -1h1v1h1v1h-1v1h-1v-1h-1v-1h1z"/>` : `<rect width="1" height="1"/>`
    parts.push(
      `<g fill="${INK}">` +
        `<animateMotion path="M${n1(x)} ${SH + 1} C${n1(x + 3)} ${SH - 16} ${n1(x - 3)} 20 ${n1(x + 1)} -2" ${timing}/>` +
        shape +
        `</g>`,
    )
  }
  // a stepped loop of ink dots: on or off, in slow steps, like an old gif
  const step = (d: string, values: number[], dur: number, phase: number, fill = INK) => {
    if (!d) return ''
    const { begin, frac } = loop(t, dur, phase)
    const now = trackAt(values, null, frac, true)
    return `<path d="${d}" fill="${fill}" opacity="${now}"><animate attributeName="opacity" values="${values.join(';')}" dur="${n1(dur)}s" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/></path>`
  }
  // the big star twinkles: broken tips grow past its rays and fall back
  const tips = (from: number, to: number, diag: boolean) => {
    let d = ''
    for (let i = from; i <= to; i += 2) {
      for (const [sx, sy] of diag ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + sx! * i
        const y = STAR.y + sy! * i
        if (clear(x, y)) d += `M${x} ${y}h1v1h-1z`
      }
    }
    return d
  }
  parts.push(step(tips(STAR.rayL + 1, STAR.rayL + 3, false), [0, 1, 1, 0, 0, 0], 4.8, 0))
  parts.push(step(tips(STAR.rayL + 5, STAR.rayL + 5, false), [0, 0, 1, 0, 0, 0], 4.8, 0))
  parts.push(step(tips(STAR.diagL + 1, STAR.diagL + 3, true), [0, 0, 0, 0, 1, 0], 4.8, 0))
  // a running agent's "+" pulses: the outer dots of its arms go dark and come back, the same shape
  // smaller and bigger, never another shape. Only dots in the clear sky are drawn: a dot that lands
  // on a cloud would blink a hole into it.
  s.agents.slice(0, AGENT_SLOTS.length).forEach((a, i) => {
    if (a !== 'running') return
    const [ox, oy] = AGENT_SLOTS[i]!
    const x = cx + ox
    const y = oy
    let off = ''
    const dotAt = (dx: number, dy: number) => (clear(x + dx, y + dy) ? `M${x + dx} ${y + dy}h1v1h-1z` : '')
    for (let k = 3; k <= 4; k++) off += dotAt(k, 0) + dotAt(-k, 0) + dotAt(0, k) + dotAt(0, -k)
    parts.push(step(off, [0, 1], 2.4, i * 0.6, BLACK))
  })
  // a few lone field stars blink out and back, in steps (no grays in 1-bit), always
  const lone = (x: number, y: number) =>
    px[y * cols + x] === 1 && !px[y * cols + x - 1] && !px[y * cols + x + 1] && !px[(y - 1) * cols + x] && !px[(y + 1) * cols + x]
  fieldStars(cols).forEach(([fx, fy], i) => {
    if (i % 2 || fy <= 0 || !lone(fx, fy)) return
    parts.push(step(`M${fx} ${fy}h1v1h-1z`, [0, 1, 0, 0], 4 + (i % 5), i * 0.7, BLACK))
  })
  const body = `<svg x="${n1(L)}" y="${top}" width="${n1(w)}" height="${n1(h)}" viewBox="0 0 ${cols} ${SH}" shape-rendering="crispEdges">${parts.join('')}</svg>`
  return doc(W, Math.round(top + h) + 6, BLACK, INK, body, ' shape-rendering="crispEdges"')
}

// ---------- entry ----------

export function buildScene(style: Style, s: SkyState, W: number, now: number) {
  const t = now / 1000
  if (style === '1bit') return sky(s, W, t)
  return (style === 'firefly' ? fireflies : embers)(TUBE[style], W, s.alarm, t)
}

// What the picture depends on: same key, same source string, and the editor keeps the running image.
export const sceneKey = (style: Style, s: SkyState, W: number) =>
  style === '1bit' ? `1bit|${W}|${s.alarm}|${Math.round(s.ctxPct ?? -1)}|${s.agents.join(',')}` : `${style}|${W}|${s.alarm}`

// The last picture per width, for a few widths: two panes of different widths taking turns (a split
// editor) would otherwise rebuild the scene on every draw. Only the last key of a width is reused: an
// older picture carries loop phases from the time it was built, so going back to it would jump.
const KEEP = 4
const kept = new Map<number, { key: string; svg: string }>()
export function sceneSvg(style: Style, s: SkyState, W: number, now: number) {
  const key = sceneKey(style, s, W)
  const hit = kept.get(W)
  if (hit?.key === key) return hit.svg
  const svg = buildScene(style, s, W, now)
  kept.delete(W)
  kept.set(W, { key, svg })
  if (kept.size > KEEP) kept.delete(kept.keys().next().value!)
  return svg
}
