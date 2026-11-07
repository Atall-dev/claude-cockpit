// Renders the whole BUS pane as the editor lays it out (switcher row, card, scene) in a few states,
// to PNG via headless Chrome. One row of states per style.
// node --import ./concepts/ts-resolve.mjs concepts/pane-preview.mts <out.png> [width] [scale] [amber|1bit|firefly|all] [seconds]
// `seconds` shifts the clock: the scene is drawn that far into its loops (a later frame of the same loop).
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { busSvg, toView } from '../hooks/draw.ts'
import { tubeSvg } from '../hooks/amber.ts'
import { buildScene } from '../hooks/scene.ts'
import { STYLES, TUBE, chrome, corner } from '../hooks/styles.ts'
import type { Style } from '../hooks/styles.ts'

const out = process.argv[2]!
const W = Number(process.argv[3] || 300)
const scale = process.argv[4] || '1'
const pick = process.argv[5] || 'all'
const shift = Number(process.argv[6] || 0) * 1000
const styles: Style[] = pick === 'all' ? STYLES.map(s => s.value) : [pick as Style]
const now = Date.UTC(2026, 10, 6, 12, 0, 0)
const agent = (type: string, description: string, status: string, tool: string | null, ago: number) => ({
  id: type + ago, type, description, model: 'claude-sonnet-5-5', status, startedAt: now - ago, endedAt: status === 'running' ? null : now - 2000, tool, calls: 0, tokens: 0,
})
const usage = (tokens: number) => ({
  startedAt: 0,
  context: { tokens, window: 400000, percent: 0 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 47, resetsAt: new Date(now + 2.5 * 3.6e6).toISOString() },
    { kind: 'seven_day', percentUsed: 72, resetsAt: new Date(now + 3.2 * 86.4e6).toISOString() },
  ],
})
const main = (phase: string, tool: string | null, running: boolean) => ({
  phase, tool, model: 'claude-opus-5-5', effort: 'medium', turnStartedAt: running ? now - 42000 : null, lastTurnMs: running ? null : 95000,
})
const states = [
  ['IDLE', { main: main('idle', null, false), agents: [] }, 22000],
  ['WORKING', { main: main('tool', 'Edit', true), agents: [agent('team-builder', 'Implement the sky renderer', 'running', 'Edit', 62000), agent('Explore', 'Find every pane module', 'running', 'Grep', 30000), agent('team-tester', 'Run the suite', 'done', null, 300000)] }, 96000],
  ['HANDOFF', { main: main('thinking', null, true), agents: [agent('team-reviewer', 'Review the diff', 'running', 'Read', 12000), agent('team-builder', 'Old job', 'failed', null, 900000)] }, 162000],
] as const

const img = (svg: string) => `<img width="${W}" style="display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`
// The switcher row with the editor's own dim Button CSS (.buttonDim in the webview), Dark Modern colors.
const row = (s: Style) => {
  const c = chrome(s)
  const btns = STYLES.map(x => `<button class="b"><span style="color:${x.value === s ? c.on : c.off}">${x.label}</span></button>`).join('')
  const k = (side: 'left' | 'right') => `<img style="display:block;flex-shrink:0" src="data:image/svg+xml;base64,${Buffer.from(corner(side, c.edge)).toString('base64')}">`
  return `<div class="row" style="background:${c.bg}">${k('left')}<div class="btns">${btns}</div>${k('right')}</div>`
}
let html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#181818;color:#ccc;font:13px "Segoe WPC","Segoe UI",sans-serif;padding:20px}
.line{display:flex;gap:24px;align-items:flex-start;margin-bottom:24px}
.pane{width:${W}px;line-height:1.4}
.row{display:flex;flex-wrap:nowrap}
.btns{display:flex;flex-wrap:wrap;flex-grow:1;justify-content:flex-end;column-gap:1ch;padding:0.4lh 0.5ch 0 0}
.b{white-space:nowrap;font-family:inherit;font-size:inherit;color:#9d9d9d;border:1px solid #313131;padding:0 8px;cursor:pointer;background:0 0;border-radius:4px;flex-shrink:0;align-self:flex-start}
.cap{margin-bottom:6px;font:11px Consolas}
</style>`
let totalH = 40
for (const s of styles) {
  html += '<div class="line">'
  let maxH = 0
  for (const [cap, bus, tok] of states) {
    const v = toView(bus as never, usage(tok) as never, 'claude-opus-5-5', now)
    const card = s === '1bit' ? busSvg(v, W) : tubeSvg(v, W, TUBE[s])
    const scene = buildScene(s, v.sky, W, now + shift)
    const h = (svg: string) => Number(svg.match(/height="(\d+)"/)![1])
    maxH = Math.max(maxH, h(card) + h(scene) + 30)
    html += `<div><div class="cap">${s} ${cap} · card ${card.length} · scene ${scene.length} ch</div><div class="pane">${row(s)}${img(card)}${img(scene)}</div></div>`
  }
  html += '</div>'
  totalH += maxH + 24 + 20
}
const page = out.replace(/\.png$/, '.html')
writeFileSync(page, html)
execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`, `--window-size=${(W + 24) * states.length + 40},${totalH}`, `--screenshot=${out}`, 'file:///' + page.replace(/\\/g, '/')], { stdio: 'ignore' })
console.log('ok', out, totalH)
