// Night sky: the BUS scene in 1-bit. A landscape strip: black sky, one big star in a window framed by
// clouds, dust rising through the window. Rasterized here into a low-res bitmap (ordered 4x4 Bayer
// dither), then drawn as runs of ink: no grays, no opacity, every tone is a dither density. The motion
// lives in scene.ts.
//
// Reacts to: agents (small sparkles in the window) and context (the clouds close in on the window; at
// handoff they leave only its core). The star always shines in full: one picture, not one per phase.
//
// The strip is SW dots wide at the pane's base width and grows by columns on wider panes: the ground
// continues to the edges, the middle (star, window, slots, the two clouds) stays put around the centre.

export const SW = 96 // columns at the base width; wider panes add columns
export const SH = 50 // rows, always
// no star or sparkle within this many dots of a cloud: they sit in the sky, not on the clouds
// (4 dots is 11 to 12 CSS px from the base width up)
export const CLEAR = 4

export type SkyState = {
  ctxPct: number | null
  alarm: boolean
  // one entry per agent shown: running agents sparkle, ended ones are a dot
  agents: ('running' | 'done' | 'failed')[]
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const dither = (x: number, y: number, tone: number) => tone * 16 > BAYER[(y & 3) * 4 + (x & 3)]! + 0.5

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

// A cloud is a row of humps on a flat base: each hump a disc on the base line plus the block under it,
// so the underside is one straight edge and the top reads as two or three billows, no seams between.
// A flat one is the plateau that carries the last hump of the ground out of the strip: the wall leaves
// the frame as a wall, never as a sliver of a hump cut by the edge.
type Hump = { x: number; y: number; r: number; base: number; flat?: boolean }

// A bank: humps walked from an inner end outward (`side` -1 left, +1 right) or, for the ground, from
// the centre both ways to the strip's edges. A closed bank is a cloud of at most `max` humps that stops
// short of the edge (never cut by it); an open one runs off the edge as a solid wall. dx/dy: how far
// it moves as context fills (toward the window and up); humps keep their base, so a wall still stands
// on the strip's floor.
// `y` is the row of the humps' centres, `base` the row their blocks reach down to: the foothills
// stand on the ground's base, so there is no slit of sky between them and the ground. `gap` is the
// distance between hump centres in radii: 1.6 melts humps into a ridge, 1.9 keeps a dip between them.
// `ramp` makes the first humps smaller (a third, two thirds of their size): the bank then rises from
// its inner end in steps, not as a wall.
type Bank = { seed: number; y: number; base: number; inner: number; side: -1 | 0 | 1; rMin: number; rMax: number; dx: number; dy: number; gap: number; max?: number; ramp?: number }
// a closed cloud keeps this many columns from the strip's edge
const MARGIN = 3

const BANKS: Bank[] = [
  { seed: 3, y: SH, base: SH + 1, inner: 0, side: 0, rMin: 7, rMax: 10, dx: 0, dy: -5, gap: 1.6 }, // the ground, full width
  { seed: 8, y: 40, base: SH + 1, inner: -26, side: -1, rMin: 4.5, rMax: 6.5, dx: 4, dy: -2, gap: 1.6, ramp: 3 }, // foothills, left
  { seed: 5, y: 40, base: SH + 1, inner: 26, side: 1, rMin: 4.5, rMax: 6.5, dx: -4, dy: -2, gap: 1.6, ramp: 3 }, // foothills, right
  { seed: 11, y: 24, base: 25, inner: -30, side: -1, rMin: 3.5, rMax: 4.5, dx: 5, dy: 0, gap: 1.9, max: 3 }, // the left cloud
  { seed: 23, y: 24, base: 25, inner: 27, side: 1, rMin: 3.5, rMax: 4.3, dx: -5, dy: 0, gap: 1.9, max: 2 }, // the right cloud, its own shape; both humps fit before the margin at 96 cols
]

// Humps of one bank for a strip of `cols` columns, in strip coordinates, at `close` (0 open, 1 shut).
function humps(b: Bank, cols: number, close: number): Hump[] {
  const cx = Math.floor(cols / 2)
  const out: Hump[] = []
  const walk = (side: -1 | 1, from: number, seed: number) => {
    const r = rng(seed)
    let x = from
    let last: Hump | null = null
    for (let k = 0; k < (b.max ?? 64); k++) {
      const rr = (b.rMin + r() * (b.rMax - b.rMin)) * (b.ramp ? Math.min(1, (k + 1) / b.ramp) : 1)
      const hx = x + side * rr * (b.gap / 2) + b.dx * close
      if (b.max ? hx - rr < MARGIN || hx + rr > cols - 1 - MARGIN : hx < -1 || hx > cols) break
      last = { x: hx, y: b.y - r() * 1.5 + b.dy * close, r: rr, base: b.base }
      out.push(last)
      x = hx + side * rr * (b.gap / 2) - b.dx * close
    }
    if (!last || b.max) return
    const edge = side < 0 ? -2 : cols + 1
    out.push({ x: (last.x + edge) / 2, y: last.y - last.r * 0.9, r: Math.abs(edge - last.x) / 2 + 0.5, base: b.base, flat: true })
  }
  if (b.side === 0) {
    // the ground: one hump on the centre column, then outward both ways
    const r = rng(b.seed)
    const rr = b.rMin + r() * (b.rMax - b.rMin)
    out.push({ x: cx, y: b.y + b.dy * close, r: rr, base: b.base })
    walk(-1, cx - rr * 0.1, b.seed + 1)
    walk(1, cx + rr * 0.1, b.seed + 2)
  } else walk(b.side, cx + b.inner, b.seed)
  return out
}

export const STAR = { y: 18, rayL: 13, diagL: 6 }
// Agent sparkles, relative to the centre column: inside the window's core, which stays open at any
// context (the test checks every dot of every sparkle for CLEAR dots of sky around it at any context).
export const AGENT_SLOTS: [number, number][] = [[-20, 8], [20, 8], [-13, 25], [13, 25], [-31, 9], [31, 9]]
// Field stars in centre-relative columns for any strip up to 300 columns wide. None within SLOT_GAP
// dots of an agent slot (either axis): a star there would touch the agent's mark and change its shape.
const SLOT_GAP = 5
const FIELD = (() => {
  const r = rng(29)
  return Array.from({ length: 90 }, () => [Math.floor(r() * 300) - 150, Math.floor(r() * 38), r()] as const).filter(
    ([x, y]) => !AGENT_SLOTS.some(([ox, oy]) => Math.abs(x - ox) <= SLOT_GAP && Math.abs(y - oy) <= SLOT_GAP),
  )
})()
export const fieldStars = (cols: number) => {
  const cx = Math.floor(cols / 2)
  return FIELD.map(([x, y, k]) => [x + cx, y, k] as const).filter(([x]) => x >= 1 && x < cols - 1)
}

// px: the picture. cloud: where a cloud is. near: a cloud or the CLEAR dots of sky around one, where
// nothing else is drawn (not here, not by the animations in scene.ts).
export type Sky = { px: Uint8Array; cloud: Uint8Array; near: Uint8Array; cols: number }

export function skyLayers(s: SkyState, cols = SW): Sky {
  const px = new Uint8Array(cols * SH)
  const cloud = new Uint8Array(cols * SH)
  const near = new Uint8Array(cols * SH)
  const cx = Math.floor(cols / 2)
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < cols && y < SH) px[y * cols + x] = 1
  }
  const t = s.ctxPct === null ? 0 : Math.max(0, Math.min(1, s.ctxPct / 100))
  const close = s.alarm ? 1 : t

  // ---- clouds: the union of all humps, and the band of sky kept clear around them ----
  const all: Hump[] = []
  for (const b of BANKS) all.push(...humps(b, cols, close))
  for (const h of all) {
    const x0 = Math.max(0, Math.floor(h.x - h.r))
    const x1 = Math.min(cols - 1, Math.ceil(h.x + h.r))
    const y0 = Math.max(0, Math.floor(h.y - h.r))
    const y1 = Math.min(SH - 1, Math.ceil(h.base))
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (h.flat) {
          if (y >= h.y && Math.abs(x - h.x) <= h.r) cloud[y * cols + x] = 1
          continue
        }
        const dy = y < h.y ? y - h.y : 0
        if ((x - h.x) ** 2 + dy * dy <= h.r * h.r) cloud[y * cols + x] = 1
      }
  }
  for (let x = 0; x < cols; x++) cloud[(SH - 1) * cols + x] = 1 // the bottom row is ground, edge to edge
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < cols; x++) {
      if (!cloud[y * cols + x]) continue
      for (let dy = -CLEAR; dy <= CLEAR; dy++)
        for (let dx = -CLEAR; dx <= CLEAR; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < cols && ny < SH) near[ny * cols + nx] = 1
        }
    }

  // ---- star field ----
  for (const [x, y, k] of fieldStars(cols)) {
    set(x, y)
    if (k > 0.86) { set(x - 1, y); set(x + 1, y); set(x, y - 1); set(x, y + 1) }
  }

  // ---- the big star: dithered glow, cross rays, short diagonals (no rays at other angles: their
  // rounded dots make hooks and stairs, shapes the sky does not use) ----
  const sx = cx
  const sy = STAR.y
  const glowR = 8
  const { rayL, diagL } = STAR
  for (let y = sy - glowR; y <= sy + glowR; y++)
    for (let x = sx - glowR; x <= sx + glowR; x++) {
      const d = Math.hypot(x - sx, y - sy) / glowR
      if (d < 1 && dither(x, y, (1 - d) ** 3 * 0.6)) set(x, y)
    }
  for (let i = -rayL; i <= rayL; i++) {
    const a = Math.abs(i) / rayL
    // the ray thins out: solid near the core, broken toward its tip
    if (a < 0.5 || dither(sx + i, sy, 1 - a)) set(sx + i, sy)
    if (a < 0.5 || dither(sx, sy + i, 1 - a)) set(sx, sy + i)
  }
  for (let i = -diagL; i <= diagL; i++) {
    const a = Math.abs(i) / diagL
    if (a < 0.4 || dither(sx + i, sy + i, 1 - a)) { set(sx + i, sy + i); set(sx + i, sy - i) }
  }
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) set(sx + x, sy + y)

  // ---- agents, in the sky's own marks: a running one is a "+", a finished one a dot, a failed one a
  // broken "x" of five lone dots (a shape that never blinks and never reads as a box) ----
  s.agents.slice(0, AGENT_SLOTS.length).forEach((a, i) => {
    const [ox, oy] = AGENT_SLOTS[i]!
    const x = cx + ox
    const y = oy
    if (a === 'running') {
      for (let k = -4; k <= 4; k++) { set(x + k, y); set(x, y + k) }
    } else if (a === 'failed') {
      set(x, y); set(x - 2, y - 2); set(x + 2, y - 2); set(x - 2, y + 2); set(x + 2, y + 2)
    } else {
      set(x, y)
    }
  })

  // ---- the clouds over everything, with clear sky around them: a solid mass, its rim lit, one
  // halftone row under the rim, the bottom row solid from edge to edge ----
  for (let x = 0; x < cols; x++) {
    let top = -1
    for (let y = 0; y < SH; y++) {
      const idx = y * cols + x
      if (!cloud[idx]) {
        top = -1
        if (near[idx]) px[idx] = 0
        continue
      }
      if (top < 0) top = y
      const depth = y - top
      const tone = depth === 2 && y < SH - 1 ? 0.5 : 1
      px[idx] = dither(x, y, tone) ? 1 : 0
    }
  }
  return { px, cloud, near, cols }
}

export const skyBitmap = (s: SkyState, cols = SW) => skyLayers(s, cols).px

// Runs of ink per row, as one path: "M x y h w" with a 1-unit-tall stroke.
export function bitmapPath(px: Uint8Array, cols = SW): string {
  let d = ''
  for (let y = 0; y < SH; y++) {
    let x = 0
    while (x < cols) {
      if (!px[y * cols + x]) { x++; continue }
      const x0 = x
      while (x < cols && px[y * cols + x]) x++
      d += `M${x0} ${y}h${x - x0}v1h${x0 - x}z`
    }
  }
  return d
}
