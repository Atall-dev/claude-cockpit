// The BUS card as a phosphor tube: soft cards in one hue at different strengths. Amber and Firefly are
// this drawing in two palettes (styles.ts). Same view model as the 1-bit drawing (draw.ts). The card is a
// still image: the moving scene under it is a separate Svg (scene.ts), so only that small one repaints.

import type { Agent, Phase } from '../types'
import { FONT, HANDOFF_TEXT, PHASE_LABEL, STATUS_LABEL, cut, esc, fits, gaugeList, textW } from './draw'
import type { View } from './draw'
import { TUBE } from './styles'
import type { Palette } from './styles'

const phaseColor = (P: Palette): Record<Phase, string> => ({ idle: P.idle, thinking: P.fill, tool: P.fill, writing: P.num })
const statusColor = (P: Palette): Record<Agent['status'], string> => ({ running: P.fill, done: P.lab, failed: P.hot })

// ---------- terminal ----------

export const tubeTerminalLines = (v: View, P: Palette = TUBE.amber) => {
  const PHASE_COLOR = phaseColor(P)
  const STATUS_COLOR = statusColor(P)
  const lines: { text: string; color?: string; bold?: boolean }[] = []
  lines.push({ text: `${v.model}${v.effort ? ' · ' + v.effort : ''}`, color: P.num, bold: true })
  lines.push({ text: `${PHASE_LABEL[v.phase]}${v.tool ? ' · ' + v.tool : ''}  ${v.timer}`, color: PHASE_COLOR[v.phase], bold: v.isRunning })
  for (const g of gaugeList(v)) {
    const cells = 12
    const full = Math.round((Math.max(0, Math.min(100, g.pct)) / 100) * cells)
    lines.push({
      text: `${g.label.padEnd(8)} ${'━'.repeat(full)}${'─'.repeat(cells - full)} ${g.value.padStart(4)}${g.note ? '  ' + g.note : ''}`,
      color: g.hot ? P.hot : P.fill,
    })
  }
  if (v.handoff) lines.push({ text: `▶ ${HANDOFF_TEXT[v.handoff]}: new chat`, color: v.handoff === 'now' ? P.hot : P.num, bold: true })
  lines.push({ text: v.agents.length ? `AGENTS  ${v.running} running` : 'NO AGENTS', color: P.lab })
  for (const a of v.agents) {
    lines.push({ text: `${a.type}  ${STATUS_LABEL[a.status]} ${a.elapsed}`, color: STATUS_COLOR[a.status], bold: a.status === 'running' })
    lines.push({ text: `  ${a.status === 'running' && a.tool ? a.tool + ' · ' : ''}${a.description}`, color: P.lab })
  }
  return lines
}

// ---------- svg ----------

const PAD = 14

export const tubeSvg = (v: View, W: number, P: Palette = TUBE.amber) => {
  const PHASE_COLOR = phaseColor(P)
  const STATUS_COLOR = statusColor(P)
  const L = PAD
  const R = W - PAD
  const inner = R - L
  const body: string[] = []
  const t = (x: number, y: number, size: number, fill: string, s: string, extra = '') =>
    `<text x="${x}" y="${y}" ${FONT} font-size="${size}" fill="${fill}" ${extra}>${s}</text>`
  const label = (x: number, y: number, s: string, extra = '', fill: string = P.lab) => t(x, y, 11, fill, esc(s), `letter-spacing="1.8" ${extra}`)

  // ---- model (the corner above is the style switcher's) ----
  let y = 16
  body.push(label(L, y, 'CLAUDE'))
  y += 27
  const effort = v.effort ? ` ${v.effort}` : ''
  const model = cut(v.model, fits(inner, 21))
  const effortFits = textW(model, 21) + textW(effort, 12, 1) + 4 <= inner
  body.push(
    t(L, y, 21, P.num, esc(model) + (effort && effortFits ? `<tspan font-size="12" fill="${P.unit}" letter-spacing="1" dx="4">${esc(effort.trim())}</tspan>` : ''), 'font-weight="700"'),
  )

  // ---- state ----
  y += 30
  const pc = PHASE_COLOR[v.phase]
  body.push(`<rect x="${L}" y="${y - 19}" width="${inner}" height="28" rx="2" fill="${v.isRunning ? P.card : 'none'}" stroke="${v.isRunning ? pc : P.edge}" stroke-opacity="${v.isRunning ? 0.55 : 1}"/>`)
  body.push(`<circle cx="${L + 14}" cy="${y - 5}" r="4" fill="${pc}"/>`)
  // the turn's timer at the row's end: running, or how long the last one took
  const timer = v.timer ? (v.isRunning ? v.timer : `LAST ${v.timer}`) : ''
  if (timer) body.push(t(R - 10, y, 12, v.isRunning ? P.num : P.lab, esc(timer), 'text-anchor="end" letter-spacing="1"'))
  const phase = PHASE_LABEL[v.phase]
  const toolRoom = inner - 28 - textW(phase, 14, 1) - 10 - (timer ? textW(timer, 12, 1) + 14 : 0)
  const tool = v.tool && toolRoom > 30 ? `<tspan fill="${P.text}" font-weight="400" letter-spacing="0" dx="8">${esc(cut(v.tool, fits(toolRoom, 14)))}</tspan>` : ''
  body.push(t(L + 26, y, 14, pc, phase + tool, 'font-weight="700" letter-spacing="1"'))

  // ---- gauges ----
  y += 20
  for (const g of gaugeList(v)) {
    y += 24
    const pct = Math.max(0, Math.min(100, g.pct))
    const color = g.hot ? P.hot : P.fill
    body.push(label(L, y, g.label))
    body.push(t(R, y + 1, 17, color, esc(g.value), 'font-weight="700" text-anchor="end"'))
    if (g.note) {
      const rx = L + textW(g.label, 11, 1.8) + 8
      const room = R - textW(g.value, 17) - 8 - rx
      // a limit's note is when it resets: say so when there is room
      const long = g.label === 'CONTEXT' ? g.note : `RESET ${g.note}`
      const note = room >= textW(long, 11) ? long : room >= textW(g.note, 11) ? g.note : ''
      if (note) body.push(t(rx, y, 11, P.idle, esc(note)))
    }
    // segmented bar, the meter's ticks laid flat
    const segs = Math.max(10, Math.floor(inner / 7))
    const sw = inner / segs
    const lit = Math.round((pct / 100) * segs)
    let on = ''
    let off = ''
    for (let i = 0; i < segs; i++) {
      const cell = `M${(L + i * sw).toFixed(1)} ${y + 8}h${(sw - 2).toFixed(1)}v7h${(2 - sw).toFixed(1)}z`
      if (i < lit) on += cell
      else off += cell
    }
    body.push(`<path d="${on}" fill="${color}"/><path d="${off}" fill="${P.rest}"/>`)
    y += 22
  }

  // ---- handoff: the chat is near the auto-compact line ----
  if (v.handoff) {
    const now = v.handoff === 'now'
    const c = now ? P.hot : P.num
    y += 14
    // a dark box with a bright frame: a tinted fill would muddy the hue
    body.push(`<rect x="${L}" y="${y}" width="${inner}" height="46" rx="2" fill="${P.screen}" stroke="${c}" stroke-width="${now ? 2 : 1}"/>`)
    body.push(t(L + 12, y + 20, 14, c, HANDOFF_TEXT[v.handoff], 'font-weight="700" letter-spacing="1.2"'))
    body.push(t(L + 12, y + 37, 12, P.text, esc(cut('handoff: new chat', fits(inner - 24, 12)))))
    y += 46
  }

  // ---- agents ----
  y += 16
  body.push(`<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="${P.edge}"/>`)
  y += 22
  if (!v.agents.length) {
    body.push(label(L, y, 'NO AGENTS', '', P.idle))
    y += 10
  } else {
    body.push(label(L, y, 'AGENTS'))
    if (v.running) body.push(label(R, y, `${v.running} RUNNING`, 'text-anchor="end"', P.fill))
    y += 10
    for (const a of v.agents) {
      const color = STATUS_COLOR[a.status]
      const isRun = a.status === 'running'
      const isFail = a.status === 'failed'
      const top = y
      const h = 50
      body.push(`<rect x="${L}" y="${top}" width="${inner}" height="${h}" rx="2" fill="${P.card}" stroke="${isRun || isFail ? color : P.edge}" stroke-opacity="${isRun ? 0.6 : 1}"${isFail ? ' stroke-dasharray="4 3"' : ''}/>`)
      body.push(`<rect x="${L}" y="${top}" width="3" height="${h}" fill="${color}"/>`)
      const ix = L + 12
      const ir = R - 10
      const right = `${STATUS_LABEL[a.status]} ${a.elapsed}`
      body.push(t(ir, top + 20, 12, color, esc(right), 'font-weight="700" text-anchor="end"'))
      const typeRoom = ir - ix - textW(right, 12) - 8
      const type = esc(cut(a.type.toUpperCase(), fits(typeRoom, 13, 0.5)))
      // a failed agent keeps its name readable: the hot FAIL mark at the row's end says it
      body.push(t(ix, top + 20, 13, isRun ? P.text : P.lab, type, 'font-weight="700" letter-spacing="0.5"'))
      const sub = isRun && a.tool ? `${a.tool} · ${a.description}` : a.description
      body.push(t(ix, top + 39, 12, isRun ? P.text : P.idle, esc(cut(sub, fits(ir - ix, 12)))))
      y += h + 6
    }
    if (v.hidden) {
      y += 12
      body.push(label(L, y, `+${v.hidden} MORE`, '', P.idle))
    }
  }

  const H = y + 4

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${P.bg}"/>`,
    // no corners: the switcher row above draws the frame's top ones, the scene below the bottom ones
    ...body,
    '</svg>',
  ].join('\n')
}
