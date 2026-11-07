// A strip of scene frames, `step` seconds apart, one row per style: how the loop moves, without a video.
// node --import ./concepts/ts-resolve.mjs concepts/scene-frames.mts <out.png> [width] [frames] [step] [alarm]
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { buildScene } from '../hooks/scene.ts'
import { STYLES } from '../hooks/styles.ts'

const out = process.argv[2]!
const W = Number(process.argv[3] || 300)
const frames = Number(process.argv[4] || 5)
const step = Number(process.argv[5] || 0.8)
const alarm = process.argv[6] === 'alarm'
const now = Date.UTC(2026, 10, 6, 12, 0, 0)
const sky = { phase: 'idle' as const, ctxPct: 30, alarm, agents: ['running', 'done'] as ('running' | 'done' | 'failed')[] }
let html = '<!doctype html><body style="margin:0;background:#181818;color:#ccc;font:11px Consolas;padding:16px">'
let H = 32
for (const s of STYLES) {
  html += '<div style="display:flex;gap:12px;margin-bottom:12px">'
  let h = 0
  for (let i = 0; i < frames; i++) {
    const svg = buildScene(s.value, sky, W, now + i * step * 1000)
    h = Math.max(h, Number(svg.match(/height="(\d+)"/)![1]))
    html += `<div><div>${s.value} t+${(i * step).toFixed(1)}s</div><img style="display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></div>`
  }
  html += '</div>'
  H += h + 30
}
const page = out.replace(/\.png$/, '.html')
writeFileSync(page, html)
execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${(W + 12) * frames + 32},${H}`, `--screenshot=${out}`, 'file:///' + page.replace(/\\/g, '/')], { stdio: 'ignore' })
console.log('ok', out)
