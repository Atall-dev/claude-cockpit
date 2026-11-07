// Renders the token meter in a few states and widths to PNG via headless Chrome.
// node concepts/meter-preview.mts <out.png> [scale] [amber|1bit|firefly]
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { gaugeSvg, progress, tubeFor, tubeGaugeSvg } from '../hooks/gauge.ts'

const out = process.argv[2]!
const scale = process.argv[3] || '1'
const style = process.argv[4] || 'amber'
const states = [
  ['1.4K idle, 120 cols', 1367, false, 1260],
  ['62K working, 62 cols', 62300, true, 651],
  ['1.73M idle, 120 cols', 1734000, false, 1260],
  ['240K working, 48 cols', 240000, true, 504],
] as const
let html = '<!doctype html><body style="margin:0;background:#111;color:#ece8dc;font:11px Consolas;padding:20px">'
for (const [cap, total, working, W] of states) {
  const { goal, frac } = progress(total)
  const svg = style === '1bit' ? gaugeSvg(total, goal, frac, working, W) : tubeGaugeSvg(total, goal, frac, frac, working, W, tubeFor(style)!)
  html += `<div style="margin:0 0 6px">${cap} · ${svg.length} ch</div><img style="display:block;margin-bottom:18px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`
}
const page = out.replace(/\.png$/, '.html')
writeFileSync(page, html)
execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`, '--window-size=1320,380', `--screenshot=${out}`, 'file:///' + page.replace(/\\/g, '/')], { stdio: 'ignore' })
console.log('ok', out)
