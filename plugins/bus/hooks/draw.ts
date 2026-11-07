import type { SessionUsage } from 'claude-code'

import type { Agent, Bus, Phase } from '../types'
import type { SkyState } from './sky'

const MAX_SHOWN = 5

// ---------- view model ----------

export type View = {
  model: string
  effort: string | null
  phase: Phase
  tool: string | null
  timer: string
  isRunning: boolean
  ctx: { pct: number; tokens: number } | null
  handoff: 'soon' | 'now' | null
  limits: { label: string; pct: number; reset: string }[]
  agents: (Agent & { elapsed: string })[]
  running: number
  hidden: number
  sky: SkyState
  alt: string
}

const prettyModel = (id: string | null) => {
  if (!id) return 'CLAUDE'
  const clean = id.replace(/\[.*?\]/g, '').replace(/^claude-/, '')
  const m = clean.match(/^([a-z]+)-(\d+)(?:-(\d+))?/)
  return m ? `${m[1]!.toUpperCase()} ${m[2]}${m[3] ? '.' + m[3] : ''}` : clean.toUpperCase()
}

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))

const resetIn = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return ''
  const h = Math.floor(ms / 3.6e6)
  const m = Math.floor((ms % 3.6e6) / 6e4)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

// Context is measured against where auto-compact fires in a typical setup, not the model's window.
const COMPACT_AT = 200_000
const HANDOFF_SOON = 120_000
// The same line the context-guard hook warns at.
const HANDOFF_NOW = 150_000
export const handoffLevel = (tokens: number | undefined) =>
  tokens === undefined ? null : tokens >= HANDOFF_NOW ? 'now' : tokens >= HANDOFF_SOON ? 'soon' : null

const LIMIT_LABEL: Record<string, string> ={ five_hour: '5 HOURS', seven_day: 'WEEK', spend_limit: 'SPEND' }

export const toView = (b: Bus, usage: SessionUsage | null, modelId: string | null, now: number): View => {
  const isRunning = b.main.turnStartedAt !== null
  const phase: Phase = isRunning ? b.main.phase : 'idle'
  const timer = isRunning
    ? fmtTime(now - (b.main.turnStartedAt ?? now))
    : b.main.lastTurnMs !== null
      ? fmtTime(b.main.lastTurnMs)
      : ''
  const sorted = [...b.agents].sort((x, y) =>
    x.status === 'running' && y.status !== 'running' ? -1 : y.status === 'running' && x.status !== 'running' ? 1 : y.startedAt - x.startedAt,
  )
  const shown = sorted.slice(0, MAX_SHOWN).map(a => ({ ...a, elapsed: fmtTime((a.endedAt ?? now) - a.startedAt) }))
  const running = b.agents.filter(a => a.status === 'running').length
  const model = prettyModel(modelId)
  const tokens = usage?.context.tokens
  return {
    model,
    effort: b.main.effort ? b.main.effort.toUpperCase() : null,
    phase,
    tool: phase === 'tool' ? b.main.tool : null,
    timer,
    isRunning,
    ctx: tokens === undefined ? null : { tokens, pct: Math.min(100, (tokens / COMPACT_AT) * 100) },
    handoff: handoffLevel(tokens),
    limits: (usage?.rateLimits ?? [])
      .filter(l => LIMIT_LABEL[l.kind])
      .map(l => ({ label: LIMIT_LABEL[l.kind]!, pct: l.percentUsed, reset: resetIn(l.resetsAt, now) })),
    agents: shown,
    running,
    hidden: Math.max(0, sorted.length - shown.length),
    // Running agents first: the sky has six spots for them.
    sky: {
      ctxPct: tokens === undefined ? null : Math.min(100, (tokens / COMPACT_AT) * 100),
      alarm: handoffLevel(tokens) === 'now',
      agents: sorted.map(a => a.status),
    },
    alt: `Claude ${model}: ${phase}${running ? `, ${running} agent${running > 1 ? 's' : ''} running` : ''}`,
  }
}

// ---------- palette: 1-bit, ink on black ----------
// Two tones only. Every in-between tone is an ordered-dither pattern, never a gray or an opacity:
// that is what makes the pane read as a 1-bit print rather than a dark theme.

const INK = '#ece8dc'
const BG = '#000000'
// The terminal has no patterns; a dim ink stands in for the dithered tone there.
const DIM = '#8f8b80'

export const PHASE_LABEL: Record<Phase, string> = { idle: 'IDLE', thinking: 'THINKING', tool: 'TOOL', writing: 'WRITING' }
export const STATUS_LABEL: Record<Agent['status'], string> = { running: 'RUN', done: 'DONE', failed: 'FAIL' }

export type Gauge = { label: string; pct: number; value: string; note: string; hot: boolean }
// Context first, in tokens against the auto-compact line; then the plan's limits in percent.
export const gaugeList = (v: View): Gauge[] => [
  ...(v.ctx
    ? [{
        label: 'CONTEXT',
        pct: v.ctx.pct,
        value: fmtTok(v.ctx.tokens).replace(/\.\dK$/, 'K'),
        note: `/ ${fmtTok(COMPACT_AT).replace('.0K', 'K')}`,
        hot: v.handoff === 'now',
      }]
    : []),
  ...v.limits.map(l => ({ label: l.label, pct: l.pct, value: `${Math.round(l.pct)}%`, note: l.reset, hot: l.pct >= 85 })),
]

export const HANDOFF_TEXT = { soon: 'HANDOFF SOON', now: 'HANDOFF NOW' } as const

// ---------- terminal ----------

export const terminalLines = (v: View) => {
  const lines: { text: string; color?: string; bold?: boolean }[] = []
  lines.push({ text: `${v.model}${v.effort ? ' · ' + v.effort : ''}`, color: INK, bold: true })
  lines.push({ text: `${v.isRunning ? '▶' : '·'} ${PHASE_LABEL[v.phase]}${v.tool ? ' · ' + v.tool : ''}  ${v.timer}`, color: v.isRunning ? INK : DIM, bold: v.isRunning })
  for (const g of gaugeList(v)) {
    const cells = 12
    const full = Math.round((Math.max(0, Math.min(100, g.pct)) / 100) * cells)
    lines.push({
      text: `${g.label.padEnd(8)} [${'█'.repeat(full)}${'░'.repeat(cells - full)}] ${g.value.padStart(4)}${g.note ? '  ' + g.note : ''}`,
      color: g.hot ? INK : DIM,
      bold: g.hot,
    })
  }
  if (v.handoff) lines.push({ text: `!! ${HANDOFF_TEXT[v.handoff]}: new chat`, color: INK, bold: true })
  lines.push({ text: v.agents.length ? `AGENTS  ${v.running} running` : 'NO AGENTS', color: DIM })
  for (const a of v.agents) {
    lines.push({ text: `${a.status === 'running' ? '✦' : '·'} ${a.type}  ${STATUS_LABEL[a.status]} ${a.elapsed}`, color: a.status === 'done' ? DIM : INK, bold: a.status === 'running' })
    lines.push({ text: `  ${a.status === 'running' && a.tool ? a.tool + ' · ' : ''}${a.description}`, color: DIM })
  }
  return lines
}

// ---------- svg ----------

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const cut = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)).trimEnd() + '…' : s)
export const FONT = `font-family="Consolas,ui-monospace,SFMono-Regular,monospace"`
// Consolas advances 0.55em, letter-spacing on top: how many characters of a size fit in a width.
// Counted at 0.6em so a wider fallback font still keeps the ellipsis inside the box.
export const fits = (px: number, size: number, ls = 0) => Math.max(3, Math.floor(px / (size * 0.6 + ls)))
export const textW = (s: string, size: number, ls = 0) => s.length * (size * 0.55 + ls)

// CSS pixels per cell, measured in the editor (a 62-cell band is ~595px, a 25-cell pane ~250px) and
// rounded up: the surface caps an Svg without a width prop at its slot, so a little too wide fills it exactly.
const CELL_PX = 10.5
export const slotPx = (columns: number | undefined) => Math.round(Math.max(220, Math.min(900, (columns || 30) * CELL_PX)))

const PAD = 14

// Dither tone in 2px dots: big enough to survive the slight downscale to the slot without moire.
const PATTERNS =
  `<pattern id="d50" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${INK}"/><rect x="2" y="2" width="2" height="2" fill="${INK}"/></pattern>`

// An empty cell is a ':' of two 2px dots on its centre. A pattern there beats against the cell pitch and
// leaves uneven gaps; dots placed per cell stay even at any width.
const colon = (x: number, w: number, y: number, gap: number) => {
  const cx = Math.round(x + w / 2 - 1)
  return `M${cx} ${y}h2v2h-2zM${cx} ${y + gap}h2v2h-2z`
}

export const busSvg = (v: View, W: number) => {
  const L = PAD
  const R = W - PAD
  const inner = R - L
  const body: string[] = []
  const t = (x: number, y: number, size: number, fill: string, s: string, extra = '') =>
    `<text x="${x}" y="${y}" ${FONT} font-size="${size}" fill="${fill}" ${extra}>${s}</text>`
  const label = (x: number, y: number, s: string, extra = '', fill = INK) => t(x, y, 10.5, fill, esc(s), `letter-spacing="2" ${extra}`)
  // A dotted leader between two labels on one line, the way a printout joins a name to its value.
  const leader = (x0: number, x1: number, y: number) =>
    x1 - x0 > 12 ? `<line x1="${x0.toFixed(1)}" y1="${y}" x2="${x1.toFixed(1)}" y2="${y}" stroke="${INK}" stroke-width="2" stroke-dasharray="2 4"/>` : ''
  const chip = (xr: number, y: number, size: number, s: string, extra = '') => {
    const w = textW(s, size, 1) + 8
    return `<rect x="${(xr - w).toFixed(1)}" y="${y - size}" width="${w.toFixed(1)}" height="${size + 4}" fill="${INK}"/>` +
      t(xr - 4, y, size, BG, esc(s), `font-weight="700" letter-spacing="1" text-anchor="end" ${extra}`)
  }

  // ---- header: who is working (the corner above is the style switcher's) ----
  let y = 15
  body.push(label(L, y, 'CLAUDE'))
  body.push(leader(L + textW('CLAUDE', 10.5, 2) + 6, R, y - 4))
  y += 28
  const effort = v.effort ? v.effort : ''
  const model = cut(v.model, fits(inner, 22))
  const effortFits = effort && textW(model, 22) + textW(effort, 11, 1.5) + 12 <= inner
  body.push(t(L, y, 22, INK, esc(model), 'font-weight="700"'))
  if (effortFits) body.push(t(R, y, 11, INK, esc(effort), 'letter-spacing="1.5" text-anchor="end"'))

  // ---- phase: an inverted bar while running, a dotted frame at rest ----
  y += 14
  const ph = PHASE_LABEL[v.phase]
  const rowH = 28
  // the turn's timer at the row's end: running, or how long the last one took
  const timer = v.timer ? (v.isRunning ? v.timer : `LAST ${v.timer}`) : ''
  const timerRoom = timer ? textW(timer, 11, 1) + 12 : 0
  if (v.isRunning) {
    body.push(`<rect x="${L}" y="${y}" width="${inner}" height="${rowH}" fill="${INK}"/>`)
    body.push(`<path d="M${L + 10} ${y + 9}l7 5l-7 5z" fill="${BG}"/>`)
    const toolRoom = inner - 30 - textW(ph, 13, 1.5) - 10 - timerRoom
    const tool = v.tool && toolRoom > 30 ? `<tspan font-weight="400" letter-spacing="0" dx="8">${esc(cut(v.tool, fits(toolRoom, 13)))}</tspan>` : ''
    body.push(t(L + 24, y + 19, 13, BG, ph + tool, 'font-weight="700" letter-spacing="1.5"'))
    if (timer) body.push(t(R - 9, y + 18.5, 11, BG, esc(timer), 'font-weight="700" letter-spacing="1" text-anchor="end"'))
  } else {
    body.push(`<rect x="${L + 0.5}" y="${y + 0.5}" width="${inner - 1}" height="${rowH - 1}" fill="none" stroke="${INK}" stroke-dasharray="2 3"/>`)
    body.push(t(L + 12, y + 19, 13, INK, ph, 'letter-spacing="1.5"'))
    if (timer) body.push(t(R - 9, y + 18.5, 11, INK, esc(timer), 'letter-spacing="1" text-anchor="end"'))
  }
  y += rowH

  // ---- gauges: [#####::....] ----
  y += 6
  for (const g of gaugeList(v)) {
    y += 24
    const pct = Math.max(0, Math.min(100, g.pct))
    body.push(label(L, y, g.label))
    if (g.hot) body.push(chip(R, y + 1, 14, g.value))
    else body.push(t(R, y + 1, 16, INK, esc(g.value), 'font-weight="700" text-anchor="end"'))
    if (g.note) {
      const rx = L + textW(g.label, 10.5, 2) + 6
      const room = R - textW(g.value, 16) - 10 - rx
      if (room >= textW(g.note, 10.5)) body.push(t(rx, y, 10.5, INK, esc(g.note)))
    }
    // brackets, then cells: solid where used, a half-dithered head, sparse dots for what is left
    const by = y + 8
    const bx0 = L + 7
    const bx1 = R - 7
    body.push(`<path d="M${L + 4} ${by - 1}h-3.5v12h3.5M${R - 4} ${by - 1}h3.5v12h-3.5" fill="none" stroke="${INK}" stroke-width="1.5"/>`)
    const segs = Math.max(10, Math.floor((bx1 - bx0 + 2) / 8))
    const sw = (bx1 - bx0 + 2) / segs
    const lit = (pct / 100) * segs
    const full = Math.floor(lit)
    let solid = ''
    let rest = ''
    for (let i = 0; i < segs; i++) {
      const cell = `M${(bx0 + i * sw).toFixed(1)} ${by + 1}h${(sw - 2).toFixed(1)}v8h${(2 - sw).toFixed(1)}z`
      if (i < full) solid += cell
      else if (i === full && lit - full > 0.15) body.push(`<path d="${cell}" fill="url(#d50)"/>`)
      else rest += colon(bx0 + i * sw, sw - 2, by + 2, 4)
    }
    body.push(`<path d="${solid}" fill="${INK}"/><path d="${rest}" fill="${INK}"/>`)
    y += 22
  }

  // ---- handoff: the chat is near the auto-compact line ----
  if (v.handoff) {
    y += 14
    const hh = 44
    const sub = esc(cut('handoff: new chat', fits(inner - 24, 12)))
    body.push(`<rect x="${L + 0.5}" y="${y + 0.5}" width="${inner - 1}" height="${hh - 1}" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="${v.handoff === 'now' ? 'none' : '2 3'}"/>`)
    body.push(t(L + 12, y + 19, 13, INK, `!! ${HANDOFF_TEXT[v.handoff]}`, 'font-weight="700" letter-spacing="1.5"'))
    body.push(t(L + 12, y + 35, 12, INK, sub))
    if (v.handoff === 'now') {
      // the same box inverted over it: the loudest thing on a still card
      body.push(
        `<g>` +
          `<rect x="${L}" y="${y}" width="${inner}" height="${hh}" fill="${INK}"/>` +
          t(L + 12, y + 19, 13, BG, `!! ${HANDOFF_TEXT.now}`, 'font-weight="700" letter-spacing="1.5"') +
          t(L + 12, y + 35, 12, BG, sub) +
          `</g>`,
      )
    }
    y += hh
  }

  // ---- agents ----
  y += 18
  body.push(`<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="${INK}" stroke-width="2" stroke-dasharray="2 4"/>`)
  y += 22
  if (!v.agents.length) {
    body.push(label(L, y, 'NO AGENTS'))
    y += 8
  } else {
    body.push(label(L, y, 'AGENTS'))
    if (v.running) body.push(label(R, y, `${v.running} RUNNING`, 'text-anchor="end"'))
    y += 10
    for (const a of v.agents) {
      const isRun = a.status === 'running'
      const top = y
      const h = 46
      body.push(
        `<rect x="${L + 0.5}" y="${top + 0.5}" width="${inner - 1}" height="${h - 1}" fill="none" stroke="${INK}" ${isRun ? '' : 'stroke-dasharray="2 3"'}/>`,
      )
      if (isRun) body.push(`<rect x="${L}" y="${top}" width="4" height="${h}" fill="${INK}"/>`)
      const ix = L + 12
      const ir = R - 8
      const right = `${STATUS_LABEL[a.status]} ${a.elapsed}`
      if (a.status === 'done') body.push(t(ir, top + 19, 11, INK, esc(right), 'letter-spacing="1" text-anchor="end"'))
      else body.push(chip(ir + 2, top + 19, 11, right))
      const typeRoom = ir - ix - textW(right, 11, 1) - 14
      body.push(t(ix, top + 19, 12.5, INK, esc(cut(a.type.toUpperCase(), fits(typeRoom, 12.5, 0.8))), 'font-weight="700" letter-spacing="0.8"'))
      const sub = isRun && a.tool ? `${a.tool} · ${a.description}` : a.description
      body.push(t(ix, top + 36, 11.5, INK, esc(cut(sub, fits(ir - ix, 11.5)))))
      y += h + 6
    }
    if (v.hidden) {
      y += 12
      body.push(label(L, y, `+${v.hidden} MORE`))
    }
  }

  const H = y + 4

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">`,
    `<defs>${PATTERNS}</defs>`,
    `<rect width="${W}" height="${H}" fill="${BG}"/>`,
    // no corners: the switcher row above draws the frame's top ones, the scene below the bottom ones
    ...body,
    '</svg>',
  ].join('\n')
}
