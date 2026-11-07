import { expect, mock, test } from 'claude-code/testing'

import { beginAt, buildScene, sceneSvg, skyGrid, trackAt } from '../hooks/scene'
import { AGENT_SLOTS, SH, SW, skyBitmap, skyLayers } from '../hooks/sky'
import type { SkyState } from '../hooks/sky'
import { DIM, TUBE } from '../hooks/styles'
import { marketOf } from '../hooks/register'

const PANE = {
  plugin: 'bus',
  component: 'Pane',
  requestId: 'bus',
  props: {
    title: 'BUS',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

let tu = 0
const spawn = (subagentType: string, description: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++tu}`,
  provider: { plugin: 'engine', tier: 'core' },
})

const usage = {
  startedAt: 0,
  context: { tokens: 62000, window: 200000, percent: 31 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 47, resetsAt: new Date(Date.now() + 2.5 * 3.6e6).toISOString() },
    { kind: 'seven_day', percentUsed: 72 },
  ],
}

const stub = (on: any, use: () => unknown = () => usage, toolCall: (...a: any[]) => unknown = () => ({ result: {} })) => {
  on('session.usage', () => ({ value: use() }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('tool.call', toolCall)
  on('clock.now', () => ({ value: Date.now() }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.log', () => ({ value: undefined }))
}

type Mounted = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
// The pane is the switcher row (two corner images, the lit current style and two buttons), the card, then the scene.
const pane = async (ui: Mounted) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const card = svgs.find(s => String(s.props.alt).startsWith('Claude'))
  return { card: String(card?.props.source), cardAlt: String(card?.props.alt), scene: String(svgs.at(-1)?.props.source), count: svgs.length }
}
const draw = async ($: any, surface = 'vscode', bodyColumns = 48) => {
  const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns } })
  const p = await pane(ui)
  await ui.unmount()
  return p
}

// 1-bit: the drawing holds one ink on black; any third colour or a transparency grey breaks the look.
const onlyInk = (src: string) => {
  expect([...new Set(src.match(/#[0-9a-f]{6}/gi))].sort()).toEqual(['#000000', '#ece8dc'])
  expect(src).not.toMatch(/(?<!url\()#[0-9a-f]{3}\b|rgba?\(|hsla?\(/i) // no short hex or functional colours either
  expect(src).not.toMatch(/(fill|stroke)="(?!#|none|url)/) // nor a named one
  expect(src).not.toMatch(/opacity="0\.\d/)
}
// The card is a still image: a loop in it would repaint the whole card every frame in the editor.
const still = (src: string) => expect(src).not.toContain('<animate')

test('a running turn with agents draws the live bus', { options: { style: '1bit' } }, async ($, on) => {
  stub(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))

  await $.turn.start({ text: 'go', turnId: 'M1' })
  await $.agent.spawn(spawn('team-builder', 'Implement the BUS pane renderer') as never)
  await $.agent.spawn(spawn('Explore', 'Find every pane module in the repo') as never)
  await $.tool.call({ tool: 'Edit', agentId: 'a1' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'X', agentId: 'a2', reason: 'answer' } as never)

  // Before the main loop calls a tool, it is thinking.
  const { card, cardAlt, scene, count } = await draw($)
  expect(count).toBe(4) // two corners, the card, the scene
  expect(cardAlt).toBe('Claude OPUS 5.5: thinking, 1 agent running')
  expect(card).toContain('THINKING')
  expect(card).toMatch(/>0:0\d</) // the turn's timer sits in the phase row
  expect(card).toContain('TEAM-BUILDER')
  expect(card).toContain('Edit · Implement')
  expect(card).toContain('DONE')
  expect(card).toContain('1 RUNNING')
  expect(card).toContain('h2v2h-2z') // empty gauge cells are ':' dots, placed per cell
  expect(card).toContain('width="504"') // 48 cells: spans the pane
  expect(card).toContain('>62K<') // context in tokens, against the 200K auto-compact line
  expect(card).toContain('/ 200K')
  expect(card).not.toContain('HANDOFF')
  onlyInk(card)
  still(card)
  expect(scene).toContain('viewBox="0 0 159 50"') // the night sky under the card: 504px wide, 159 columns of 3px
  expect(scene).toContain('repeatCount="indefinite"')
  onlyInk(scene)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /TEAM-BUILDER|team-builder/ }))?.text).toContain('RUN')
  await ui.unmount()
})

test('at rest the card holds still and the scene keeps living', { options: { style: '1bit' } }, async ($, on) => {
  stub(on)
  await $.turn.start({ text: 'hi', turnId: 'M1' })
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'M1', reason: 'answer' } as never)
  const { card, scene } = await draw($, 'desktop')
  expect(card).toContain('IDLE')
  expect(card).toContain('LAST 0:00')
  expect(card).toContain('NO AGENTS')
  still(card)
  onlyInk(card)
  expect(scene).toContain('repeatCount="indefinite"')
})

// The heaviest drawing: many agents, a tool running, the handoff alarm.
test('the busiest 1-bit pane stays under the Svg cap', { options: { style: '1bit' } }, async ($, on) => {
  let release = () => {}
  stub(
    on,
    () => ({ ...usage, context: { tokens: 190000, window: 200000, percent: 95 } }),
    (_: unknown, e: { tool: string; agentId?: string }) =>
      e.tool === 'Edit' && !e.agentId ? new Promise(r => (release = () => r({ result: {} }))) : { result: {} },
  )
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `d${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (let i = 0; i < 10; i++) await $.agent.spawn(spawn('Explore', `a long description of agent number ${i} that runs on`) as never)
  await $.tool.call({ tool: 'Grep', agentId: 'd1' } as never)
  const editing = $.tool.call({ tool: 'Edit' } as never)
  await new Promise(r => (globalThis as unknown as { setTimeout: (f: unknown, ms: number) => void }).setTimeout(r, 20))
  try {
    for (const bodyColumns of [24, 48, 120]) {
      const { card, scene } = await draw($, 'vscode', bodyColumns)
      expect(card).toContain('TOOL')
      expect(card).toContain('HANDOFF NOW')
      expect(card).toContain('+5 MORE') // 10 running, 5 cards shown
      expect(card.length).toBeLessThan(131072) // the Svg element's cap
      expect(scene.length).toBeLessThan(131072)
      still(card)
      onlyInk(card)
      onlyInk(scene)
    }
  } finally {
    release()
    await editing
  }
})

const lit = (px: Uint8Array, x0: number, x1: number, y0: number, y1: number) => {
  let c = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c += px[y * SW + x]!
  return c
}
const base: SkyState = { ctxPct: 10, alarm: false, agents: [] }

// Catches a sky that ignores the session (agents, context).
test('the sky follows agents and context', async () => {
  const idle = skyBitmap(base)
  const one = skyBitmap({ ...base, agents: ['running'] })
  const two = skyBitmap({ ...base, agents: ['running', 'running'] })
  expect(lit(one, 0, SW, 0, SH)).toBeGreaterThan(lit(idle, 0, SW, 0, SH))
  expect(lit(two, 0, SW, 0, SH)).toBeGreaterThan(lit(one, 0, SW, 0, SH))
  // a filling context closes the clouds in on the window
  expect(lit(skyBitmap({ ...base, ctxPct: 90 }), 0, SW, 0, SH)).toBeGreaterThan(lit(idle, 0, SW, 0, SH))
  expect(skyBitmap(base)).toEqual(idle) // same state, same picture
  // a failed agent's mark is its own shape, not the running cross or the finished dot
  const run = skyBitmap({ ...base, agents: ['running'] })
  const fail = skyBitmap({ ...base, agents: ['failed'] })
  const done = skyBitmap({ ...base, agents: ['done'] })
  expect(fail).not.toEqual(run)
  expect(fail).not.toEqual(done)
  expect(lit(fail, 0, SW, 0, SH) - lit(idle, 0, SW, 0, SH)).toBe(5) // a broken x: five lone dots
  expect(lit(done, 0, SW, 0, SH) - lit(idle, 0, SW, 0, SH)).toBe(1) // a dot
  expect(lit(run, 0, SW, 0, SH) - lit(idle, 0, SW, 0, SH)).toBe(17) // a plain + with arms of four
})

// Catches a field star touching an agent's mark in any slot: each mark adds exactly its own dots
// (a broken x 5, a dot 1, a + 17), whichever of the six slots it takes.
test('every agent slot shows its mark whole, no field star in it', async () => {
  for (let i = 0; i < AGENT_SLOTS.length; i++) {
    const before: SkyState['agents'] = Array(i).fill('done')
    const under = lit(skyBitmap({ ...base, agents: before }), 0, SW, 0, SH)
    for (const [mark, dots] of [['failed', 5], ['done', 1], ['running', 17]] as const)
      expect([i, mark, lit(skyBitmap({ ...base, agents: [...before, mark] }), 0, SW, 0, SH) - under]).toEqual([i, mark, dots])
  }
  // and nothing touches a mark either: the sky without agents is dark in a box of 5 dots around each
  // slot (a mark spans 4), at any width
  for (const cols of [96, 131, 159, 291]) {
    const { px } = skyLayers(base, cols)
    const cx = Math.floor(cols / 2)
    AGENT_SLOTS.forEach(([ox, oy], i) => {
      let on = 0
      for (let y = oy - 5; y <= oy + 5; y++) for (let x = cx + ox - 5; x <= cx + ox + 5; x++) on += px[y * cols + x]!
      expect([cols, i, on]).toEqual([cols, i, 0])
    })
  }
})

// Catches a blinking dot of the scene (star tips, a pulsing +, a twinkling field star) placed on a
// cloud or its clear band: open, half shut and shut clouds, no blinking dot is in `near`. The dust
// (animateMotion) is left out on purpose: ink rising over ink, it may cross a cloud.
test('no blinking dot of the 1-bit scene lands on a cloud', async () => {
  for (const [ctxPct, alarm] of [[0, false], [55, false], [100, true]] as const)
  for (const [W, want] of [[300, 96], [504, 159], [900, 291]] as const) {
    const s: SkyState = { ctxPct, alarm, agents: Array(6).fill('running') }
    const { cols } = skyGrid(W)
    expect(cols).toBe(want)
    const { near } = skyLayers(s, cols)
    const svg = buildScene('1bit', s, W, 0)
    let dots = 0
    let hits = 0
    for (const [, d] of svg.matchAll(/<path d="([^"]*)" fill="#[0-9a-f]{6}" opacity="[01]"><animate/g))
      for (const [, x, y] of d!.matchAll(/M(-?\d+) (-?\d+)h1v1h-1z/g)) {
        dots++
        const X = Number(x)
        const Y = Number(y)
        if (X < 0 || Y < 0 || X >= cols || Y >= SH || near[Y * cols + X]) hits++
      }
    expect(dots).toBeGreaterThan(20)
    expect([ctxPct, W, hits]).toEqual([ctxPct, W, 0])
  }
})

// Catches a sparkle or a star sitting on a cloud: everything but the clouds keeps CLEAR dots of sky
// around it, at any context and any width, and the clouds keep off the strip's side edges.
test('every sparkle and star keeps clear of the clouds at any context', async () => {
  for (const cols of [96, 131, 159, 291])
    for (const [ctxPct, alarm] of [[0, false], [20, false], [45, false], [70, false], [100, false], [100, true]] as const) {
      const sky = skyLayers({ ctxPct, alarm, agents: Array(6).fill('running') }, cols)
      const cx = Math.floor(cols / 2)
      for (const [ox, oy] of AGENT_SLOTS)
        for (let k = -4; k <= 4; k++) {
          expect(sky.near[oy * cols + cx + ox + k]).toBe(0)
          expect(sky.near[(oy + k) * cols + cx + ox]).toBe(0)
        }
      let touching = 0
      for (let i = 0; i < cols * SH; i++) if (sky.px[i] && sky.near[i] && !sky.cloud[i]) touching++
      expect(touching).toBe(0)
      // the bottom row is ground from edge to edge; the clouds at the star's height stop short of the edges
      for (let x = 0; x < cols; x++) expect(sky.px[(SH - 1) * cols + x]).toBe(1)
      for (let y = 0; y < 28; y++) {
        expect(sky.cloud[y * cols]).toBe(0)
        expect(sky.cloud[y * cols + cols - 1]).toBe(0)
      }
    }
})

// Catches a strip that stretches its dots or grows past 160px: square dots, columns added on wide
// panes, the whole Svg no taller than 160px at any width (about 150 at the base width).
test('the 1-bit scene is a strip of square dots, the Svg at most 160 px tall', async () => {
  expect(skyGrid(300)).toEqual({ dot: 272 / 96, cols: 96, w: 272, h: (272 / 96) * 50 })
  expect(skyGrid(420)).toEqual({ dot: 3, cols: 131, w: 393, h: 150 })
  expect(skyGrid(900)).toEqual({ dot: 3, cols: 291, w: 873, h: 150 })
  expect(skyGrid(220).cols).toBe(96)
  expect(skyGrid(220).h).toBe(100)
  expect(buildScene('1bit', base, 300, 0)).toContain('height="152"')
  for (const W of [220, 260, 300, 361, 420, 504, 640, 900]) {
    const svg = buildScene('1bit', base, W, 0)
    const { cols, w, h } = skyGrid(W)
    expect(svg).toContain(`width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="0 0 ${cols} 50"`)
    expect(svg).not.toContain('preserveAspectRatio')
    expect(Number(svg.match(/^<svg[^>]* height="(\d+)"/)![1])).toBeLessThanOrEqual(160)
    expect(svg).toContain(`width="${W}"`)
  }
})

// Catches a scene whose first paint is dark: before the animations are sampled, every faded element
// shows its static opacity, so that value must be the loop's value for this moment (the same place
// its `begin` points at), not the attribute's resting zero.
// Catches the n - 1 spans of a linear track used for a discrete one: SMIL gives a discrete track
// without keyTimes n even spans, so "0;1" at 60% of the loop shows 1, not 0.
test('a discrete track without keyTimes steps in n even spans', async () => {
  expect(trackAt([0, 1], null, 0.6, true)).toBe(1)
  expect(trackAt([0, 1], null, 0.4, true)).toBe(0)
  expect(trackAt([0, 1, 1, 0, 0, 0], null, 0.5, true)).toBe(0)
  expect(trackAt([0, 1, 0, 0], null, 0.3, true)).toBe(1)
  expect(Math.abs(trackAt([0, 1], null, 0.6) - 0.6)).toBeLessThan(1e-9)
})

test('the first frame of a scene is a frame of the running loop', async () => {
  const at = (values: number[], keyTimes: number[] | null, frac: number, discrete: boolean) => {
    const kt = keyTimes ?? values.map((_, i) => (discrete ? i / values.length : i / (values.length - 1)))
    let i = 0
    while (i < values.length - 1 && kt[i + 1]! <= frac) i++
    if (discrete || i >= values.length - 1) return values[i]!
    return values[i]! + ((values[i + 1]! - values[i]!) * (frac - kt[i]!)) / (kt[i + 1]! - kt[i]!)
  }
  const busy: SkyState = { ctxPct: 55, alarm: false, agents: ['running', 'running', 'done'] }
  const t0 = Date.UTC(2026, 10, 6, 12, 0, 0)
  for (const style of ['amber', 'firefly', '1bit'] as const) {
    let litAny = 0
    for (const dt of [0, 800, 1600, 2400]) {
      const svg = buildScene(style, busy, 300, t0 + dt)
      const re = /opacity="([\d.]+)">(?:<animateMotion [^>]*\/>)?<animate attributeName="opacity" ([^>]*)\/>/g
      let n = 0
      let lit = 0
      for (const m of svg.matchAll(re)) {
        const attrs = m[2]!
        const get = (k: string) => attrs.match(new RegExp(` ?${k}="([^"]+)"`))?.[1]
        const values = get('values')!.split(';').map(Number)
        const keyTimes = get('keyTimes')?.split(';').map(Number) ?? null
        const dur = Number(get('dur')!.replace('s', ''))
        const begin = -Number(get('begin')!.replace('s', ''))
        const discrete = get('calcMode') === 'discrete'
        // begin is written to 0.01 s, so right on a step boundary either side of it is the same moment
        const off = (f: number) => Math.abs(Number(m[1]) - at(values, keyTimes, f, discrete))
        const f = begin / dur
        const e = 0.006 / dur
        expect(discrete ? Math.min(off(f), off(f - e), off(f + e)) : off(f)).toBeLessThan(0.02)
        n++
        if (Number(m[1]) >= 0.5 * Math.max(...values)) lit++
      }
      expect(n).toBeGreaterThan(8) // sparks, fireflies, tips and blinks were all found
      // and the frame has lights on (amber, firefly: the lights are the faded elements; the 1-bit sky
      // is a still bitmap and its blinks are black dots over it, so all of them can be off at once)
      if (style !== '1bit') expect(lit).toBeGreaterThan(0)
      litAny += lit
    }
    expect([style, litAny > 0]).toEqual([style, true]) // the 1-bit blinks do run: some are on at some moment
  }
})

// Catches a cache of one slot: two panes of different widths taking turns would rebuild every draw.
test('the scene cache keeps a few recent pictures', async () => {
  const a = sceneSvg('amber', base, 300, 1_000)
  const b = sceneSvg('amber', base, 420, 2_000)
  expect(sceneSvg('amber', base, 300, 50_000)).toBe(a)
  expect(sceneSvg('amber', base, 420, 60_000)).toBe(b)
})

// Catches a cache that hands back an older picture on a return to its key (alarm on, then off): its
// loops would carry the phase of the time it was built and every spark would jump.
test('going back to an earlier scene key rebuilds it from the clock', async () => {
  const W = 361
  const t0 = Date.UTC(2026, 10, 6, 12, 0, 0)
  const calm = sceneSvg('amber', base, W, t0)
  sceneSvg('amber', { ...base, alarm: true }, W, t0 + 300_000)
  const back = sceneSvg('amber', base, W, t0 + 600_000)
  expect(back).not.toBe(calm)
  expect(back).toBe(buildScene('amber', base, W, t0 + 600_000))
})

// Catches a palette tweak that makes a small label unreadable: every label tone 4.5:1 to its ground.
test('small labels keep 4.5:1 contrast on their grounds', async () => {
  const lin = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  }
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
  for (const P of [TUBE.amber, TUBE.firefly])
    for (const ink of [P.lab, P.unit, P.idle, P.text])
      for (const ground of [P.bg, P.card, P.screen]) expect(ratio(ink, ground)).toBeGreaterThanOrEqual(4.5)
  expect(ratio(DIM, '#000000')).toBeGreaterThanOrEqual(4.5)
})

// A loop's begin is minus how far into it the wall clock is: a rebuilt scene picks up where the last one was.
test('scene timing comes from the wall clock', async () => {
  expect(beginAt(10, 4, 1)).toBe('-3.00s')
  expect(beginAt(-1, 4, 0)).toBe('-3.00s')
  expect(beginAt(8, 4, 0)).toBe('0.00s')
  // catches a scene that ignores the clock: every redraw would restart its sparks from the bottom
  expect(buildScene('amber', base, 300, 1_000)).not.toBe(buildScene('amber', base, 300, 1_500))
  // the same picture asked again is the same string, whatever the time: the editor keeps it running
  const a = sceneSvg('firefly', base, 300, 1_000)
  expect(sceneSvg('firefly', base, 300, 99_000)).toBe(a)
  expect(sceneSvg('firefly', { ...base, alarm: true }, 300, 99_000)).not.toBe(a)
})

// Catches a loop whose written `dur` is rounded while its `begin` came from the unrounded one: after a
// rebuild minutes later (clouds moved, a resize) every spark, firefly and mote would jump.
test('a rebuilt scene keeps every loop in phase with the clock', async () => {
  const pairs = (svg: string) => [...svg.matchAll(/dur="([\d.]+)s" begin="(-?[\d.]+)s"/g)].map(m => [Number(m[1]), Number(m[2])] as const)
  const t0 = Date.UTC(2026, 10, 6, 12, 0, 0)
  const busy: SkyState = { ...base, agents: ['running', 'running'] }
  for (const style of ['amber', '1bit', 'firefly'] as const) {
    const a = pairs(buildScene(style, busy, 300, t0))
    const b = pairs(buildScene(style, busy, 300, t0 + 600_000))
    expect(a.length).toBeGreaterThan(5)
    expect(b.length).toBe(a.length)
    a.forEach(([dur, b0], i) => {
      const [dur1, b1] = b[i]!
      expect(dur1).toBe(dur) // a loop's length never depends on the clock
      const into = (v: number) => ((v % dur) + dur) % dur
      const d = Math.abs(into(-b0 + 600) - into(-b1))
      // begin is written to 0.01 s on each side
      expect(Math.min(d, dur - d)).toBeLessThan(0.0101)
    })
  }
})

test('a full context asks for a handoff: banner, hot gauge, one toast', { options: { style: '1bit' } }, async ($, on) => {
  let tokens = 130000
  stub(on, () => ({ ...usage, context: { tokens, window: 1000000, percent: 13 } }))
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const turn = async () => {
    await $.turn.start({ text: 'go', turnId: 'M1' })
    await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'M1', reason: 'answer' } as never)
  }

  await turn()
  expect((await draw($)).card).toContain('HANDOFF SOON')
  expect(toasts).toHaveLength(0)

  tokens = 178000
  await turn()
  await turn()
  const { card } = await draw($)
  expect(card).toContain('HANDOFF NOW')
  expect(card).toContain('handoff: new chat')
  still(card)
  expect(card).toMatch(/fill="#000000"[^>]*>178K</) // the hot value is a chip: dark ink on light
  expect(toasts).toHaveLength(1) // not one per turn
  expect(toasts[0]).toContain('hand off')
})

test('a failing state write never blocks a tool call', async ($, on) => {
  stub(on)
  on('state.set', () => {
    throw new Error('disk full')
  })
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect('deny' in (ran as object) && (ran as { deny?: string }).deny).toBeFalsy()
})

// Each write redraws the card; a repeat of what is already drawn must not write.
test('a write that changes nothing is skipped', async ($, on) => {
  stub(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'w1' }))
  let writes = 0
  on('state.set', ((_: unknown, e: unknown, next: (e: unknown) => unknown) => (writes++, next(e))) as never)
  await $.agent.spawn(spawn('Explore', 'Find panes') as never)
  await $.tool.call({ tool: 'Grep', agentId: 'w1' } as never)
  const once = writes
  await $.tool.call({ tool: 'Grep', agentId: 'w1' } as never)
  await $.tool.call({ tool: 'Grep', agentId: 'w1' } as never)
  expect(writes).toBe(once)
  await $.tool.call({ tool: 'Edit', agentId: 'w1' } as never)
  expect(writes).toBe(once + 1)
})

// Timers are drawn at redraw time; with repeat writes skipped, a slow tick keeps them moving while
// work runs, and stops once nothing runs. The scene's source never changes with the tick.
test('a slow tick redraws the card only while work runs, never the scene', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: usage }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 't1' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await $.agent.spawn(spawn('Explore', 'Long search') as never)
  await $.tool.call({ tool: 'Grep', agentId: 't1' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const first = await pane(ui)
  expect(first.card).toContain('RUN 0:00')
  await clock.advance(65_000)
  const later = await pane(ui)
  expect(later.card).toContain('RUN 1:05')
  expect(later.scene).toBe(first.scene) // a new source would restart the scene's loops
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'X', agentId: 't1', reason: 'answer' } as never)
  const done = (await pane(ui)).card
  await clock.advance(30_000)
  expect((await pane(ui)).card).toBe(done)
  await ui.unmount()
})

// ---------- the tube styles: amber (default) and firefly ----------

test('amber is the default: phosphor card, embers below, a still card', async ($, on) => {
  stub(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  await $.agent.spawn(spawn('team-builder', 'Build it') as never)
  await $.agent.spawn(spawn('Explore', 'Old job') as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'X', agentId: 'a2', reason: 'error' } as never)
  for (const surface of ['vscode', 'desktop'] as const) {
    const { card, scene } = await draw($, surface)
    expect(card).toContain('#ff9d1c')
    expect(card).not.toContain('#ece8dc')
    expect(card).toContain('TEAM-BUILDER')
    expect(card).not.toContain(TUBE.amber.ptr) // the pointer tone is the scene's; no pale accent on the card
    expect(card).toContain(`fill="${TUBE.amber.hot}" font-weight="700" text-anchor="end">FAIL`) // the hot mark says it failed
    expect(card).not.toContain('line-through') // and the name stays readable
    still(card)
    expect(scene).toContain('#ff9d1c') // the sparks
    expect(scene).toContain('animateMotion')
    expect(scene).not.toContain('viewBox="0 0 96 132"') // no night sky in amber
  }
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /OPUS 5\.5/ }))?.props.color).toBe('#ffc46b')
  await term.unmount()
})

test('the busiest amber pane stays under the Svg cap and its scene runs hot', async ($, on) => {
  stub(on, () => ({ ...usage, context: { tokens: 190000, window: 200000, percent: 95 } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `d${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (let i = 0; i < 10; i++) await $.agent.spawn(spawn('Explore', `a long description of agent number ${i} that runs on`) as never)
  for (const bodyColumns of [24, 48, 120]) {
    const { card, scene } = await draw($, 'vscode', bodyColumns)
    expect(card).toContain('HANDOFF NOW')
    expect(card).not.toContain('fill-opacity') // the banner is a dark box in a bright frame, not a tint
    still(card)
    expect(scene).toContain('#ff5b3a') // the embers turn red at handoff
    expect(card.length).toBeLessThan(131072)
    expect(scene.length).toBeLessThan(131072)
  }
})

// Catches a register that ignores the third style and draws amber for it.
test('firefly is the tube in lime on moss, fireflies below', { options: { style: 'firefly' } }, async ($, on) => {
  stub(on)
  const { card, scene } = await draw($)
  expect(card).toContain('#b8f23a')
  expect(card).toContain('#0a110b')
  expect(card).not.toContain('#ff9d1c')
  still(card)
  expect(scene).toContain('#b8f23a')
  expect(scene).not.toContain('#ff9d1c')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /OPUS 5\.5/ }))?.props.color).toBe('#d9ff5c')
  await term.unmount()
})

// ---------- the style switcher ----------

// Catches a switcher or command that changes nothing, or only one of the two mods.
test('the switcher and /bus style set both mods', async ($, on) => {
  stub(on)
  const rows = ['theme', 'bus@market.style', 'token-meter@market.style', 'other.style']
  on('config.list', () => ({ value: rows.map(key => ({ key })) }) as never)
  const set: [string, unknown][] = []
  on('config.set', ((_: unknown, e: { key: string; value: unknown }) => (set.push([e.key, e.value]), { value: e.value })) as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.key)).toEqual(['style-1bit', 'style-firefly']) // the current one is text
  await ui.press({ key: 'style-firefly' })
  await ui.unmount()
  expect(set).toEqual([
    ['token-meter@market.style', 'firefly'],
    ['bus@market.style', 'firefly'],
  ])

  set.length = 0
  const out = await $.command.run({ command: 'bus', args: 'style' } as never)
  expect(JSON.stringify(out)).toContain('1bit') // no value: the next after the current amber
  expect(set.map(s => s[1])).toEqual(['1bit', '1bit'])

  // the switcher's labels work as typed values; an unknown word changes nothing
  set.length = 0
  await $.command.run({ command: 'bus', args: 'style 1-BIT' } as never)
  await $.command.run({ command: 'bus', args: 'style Firefly' } as never)
  expect(set.map(s => s[1])).toEqual(['1bit', '1bit', 'firefly', 'firefly'])
  set.length = 0
  const bad = await $.command.run({ command: 'bus', args: 'style neon' } as never)
  expect(JSON.stringify(bad)).toContain('Usage')
  expect(JSON.stringify(bad)).toContain('firefly')
  expect(set).toEqual([])
})

// Catches 0.8.1's bug: config.list showed no row of ours live, and the switch gave up without trying.
test('an empty config list still sets both mods by their install keys', async ($, on) => {
  stub(on)
  on('config.list', () => ({ value: [] }) as never)
  const set: string[] = []
  const known = new Set(['bus.style'])
  on('config.set', ((_: unknown, e: { key: string; value: unknown }) => {
    set.push(e.key)
    // the engine rejects a key no row has, it does not answer { deny }
    if (!known.has(e.key) && !(known.size && e.key.startsWith('token-meter@'))) throw new Error('no row')
    return { value: e.value }
  }) as never)
  const out = JSON.stringify(await $.command.run({ command: 'bus', args: 'style firefly' } as never))
  expect(out).toContain('style: firefly')
  // the marketplace comes from the install path, .../cache/<marketplace>/bus/<version>
  expect(set.map(k => k.replace(/@[^.]+/, '@M'))).toEqual(['token-meter@M.style', 'bus@M.style', 'bus.style'])

  known.clear()
  const none = JSON.stringify(await $.command.run({ command: 'bus', args: 'style 1bit' } as never))
  expect(none).toContain('no style setting found')
})

// Catches a wrong segment of the install path, which the plain `bus.style` fallback would hide.
test('the marketplace is read from the install path', () => {
  expect(marketOf(String.raw`C:\Users\u\.claude\plugins\cache\my-market\bus\0.8.3`)).toBe('my-market')
  expect(marketOf('/home/u/.claude/plugins/cache/cockpit/bus/0.8.3/')).toBe('cockpit')
})

// Catches a half switch reported as nothing changed: the meter took the style, the pane did not.
test('a meter-only change says so', async ($, on) => {
  stub(on)
  on('config.list', () => ({ value: [] }) as never)
  on('config.set', ((_: unknown, e: { key: string; value: unknown }) => {
    if (e.key.startsWith('token-meter@')) return { value: e.value }
    throw new Error('no row')
  }) as never)
  const out = JSON.stringify(await $.command.run({ command: 'bus', args: 'style firefly' } as never))
  expect(out).toContain('the token meter changed')
})

// Catches a command that reports a switch the engine refused (config.set answers { deny }, it does not throw).
test('a refused style change is reported, not claimed', async ($, on) => {
  stub(on)
  on('config.list', () => ({ value: [{ key: 'bus.style' }, { key: 'token-meter.style' }] }) as never)
  on('config.set', (() => ({ deny: 'nope' })) as never)
  const out = JSON.stringify(await $.command.run({ command: 'bus', args: 'style 1bit' } as never))
  expect(out).not.toContain('style: 1bit')
  expect(out).toContain('nope')
})

// The chosen look is lit in the card's own colours, the others dim, all in one weight (a bold label
// is wider, and the row would shift on every switch); the row wears the card's background.
test('the switcher marks the current style', { options: { style: '1bit' } }, async ($, on) => {
  stub(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.find(t => (t as { text?: string }).text === '1-BIT')?.props).toMatchObject({ color: '#ece8dc' })
  // The others are dim Buttons: VS Code fills a bright one with the theme's blue, a dim one is a ghost.
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => [b.props.label, b.props.dimColor])).toEqual([['AMBER', true], ['FIREFLY', true]])
  const rows = await ui.findAll({ type: 'Box' })
  expect(rows.some(b => b.props.backgroundColor === '#000000')).toBe(true)
  await ui.unmount()
})

// Catches a scene redrawn per phase (each new source restarts its loops) or one deaf to agents.
test('the 1-bit scene changes with agents, not with each turn', { options: { style: '1bit' } }, async ($, on) => {
  stub(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 's1' }))
  const idle = (await draw($)).scene
  await $.turn.start({ text: 'go', turnId: 'M1' })
  await $.tool.call({ tool: 'Grep' } as never)
  expect((await draw($)).scene).toBe(idle)
  await $.agent.spawn(spawn('Explore', 'Look around') as never)
  expect((await draw($)).scene).not.toBe(idle)
})
