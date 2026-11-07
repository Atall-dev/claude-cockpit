import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Bus, Main, Phase } from '../types'
import { tubeSvg, tubeTerminalLines } from './amber'
import { busSvg, fmtTok, handoffLevel, slotPx, terminalLines, toView } from './draw'
import { sceneSvg } from './scene'
import { STYLES, TUBE, chrome, corner, nextStyle, parseStyle, toStyle } from './styles'
import type { Style } from './styles'

const PANE = 'bus'
const TITLE = 'BUS'
const MAX_KEPT = 12

// The style is a userConfig row of this plugin and of the token meter alike, so /config shows it and a
// change reloads each with the new value. Setting it here sets both rows, under whatever key the install
// gave them (`bus.style`, or `bus@<marketplace>.style` for a marketplace install).
// An install lives at .../plugins/cache/<marketplace>/bus/<version>, its rows keyed `<name>@<marketplace>`.
export const marketOf = (root: string) => root.split(/[\\/]/).filter(Boolean).at(-3)

const setStyle = async ($: EngineInterface, style: Style): Promise<string | null> => {
  try {
    const all = await $.config.list()
    const rows = all.filter(r => /^(bus|token-meter)(@.+)?\.style$/.test(r.key))
    $.ui.log(`style rows: ${rows.map(r => r.key).join(', ') || `none of ${all.length}`}`)
    const locked = rows.find(r => r.isLocked)
    if (locked) return `${locked.key} is locked by policy`
    const own = rows.filter(r => r.key.startsWith('bus'))
    if (own.length) {
      // The meter's row goes first: changing our own reloads this module, so ours is set once, last.
      for (const row of [...rows.filter(r => !r.key.startsWith('bus')), own[0]!]) {
        const res = await $.config.set({ key: row.key, value: style })
        if (res.deny) return `${row.key}: ${res.deny}`
      }
      return null
    }
    // The list showed no row of ours (seen live in 0.8.1): try the keys an install gives, meter first.
    const tryKeys = async (keys: string[]) => {
      for (const key of keys) {
        // logged before the set: a set of our own key reloads this module, and nothing should follow it
        $.ui.log(`style set ${key}`)
        const res = await $.config.set({ key, value: style }).catch((err: unknown) => ({ deny: String(err) }))
        if (!res.deny) return true
        $.ui.log(`style set ${key} refused: ${res.deny}`)
      }
      return false
    }
    const market = marketOf($.plugin.root)
    const meterSet = await tryKeys([`token-meter@${market}.style`, 'token-meter.style'])
    if (await tryKeys([`bus@${market}.style`, 'bus.style'])) return null
    return meterSet ? 'the token meter changed, this pane has no style setting' : 'no style setting found; set it in /config'
  } catch (err) {
    return String(err instanceof Error ? err.message : err)
  }
}

const idleMain = (): Main => ({
  phase: 'idle',
  tool: null,
  model: null,
  effort: null,
  turnStartedAt: null,
  lastTurnMs: null,
})

// Bump the tag when Bus's fields change: it drops what an older version stored.
const bus = atom({ plugin: 'bus', key: 'bus' } as const, { main: idleMain(), agents: [] } as Bus, { shape: 'bus-1' })

type Ctx = EngineInterface

// The pane only watches: a failed write must never hold up a tool call or a spawn.
const safe = (p: Promise<unknown>) => p.then(
  () => undefined,
  () => undefined,
)

// Every write redraws the pane's card, a new image for the editor. So a write that changes nothing is
// skipped (a turn step, a tool call and each agent's calls would otherwise redraw several times a
// second while agents run). The scene under the card keeps running: its source only changes with it.
const put = async ($: Ctx, fn: (b: Bus) => Bus) => {
  const b = await read($, bus).catch(() => null)
  if (b && JSON.stringify(fn(b)) === JSON.stringify(b)) return
  await safe(update($, bus, fn))
}

const setMain = ($: Ctx, patch: Partial<Main>) => put($, b => ({ ...b, main: { ...b.main, ...patch } }))

const setAgent = ($: Ctx, id: string, fn: (a: Agent) => Agent) =>
  put($, b => ({ ...b, agents: b.agents.map(a => (a.id === id ? fn(a) : a)) }))

// One toast per crossing of the handoff line; a reload may repeat it once.
let toasted = false
// Whether the last drawing had a clock running (a turn or an agent): only then does the tick redraw.
let ticking = false
// Timers are drawn from the time of the redraw, and writes no longer come with every call: a slow
// tick keeps them moving. Rare on purpose, each redraw is a new card image.
export const TICK_MS = 5000
let tick: { cancel: () => void } | null = null

export const register: Register = (on, options) => {
  const style: Style = toStyle(options.style)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'bus',
      description: `Open the BUS cockpit pane ("/bus style ${STYLES.map(s => s.value).join('|')}" switches the look, "/bus clear" drops finished agents)`,
    })
    void $.ui.open({ id: PANE, title: TITLE })
    // One tick per module: a second session.start (/clear, resume) replaces it, never adds one.
    tick?.cancel()
    tick = $.clock.every(TICK_MS, () => {
      if (ticking) $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  on('command.run', { command: 'bus' }, async ($, e) => {
    const [arg, value] = String(e.args ?? '').trim().split(/\s+/)
    if (arg === 'style') {
      const asked = parseStyle(value)
      if (value && !asked) return { text: `Usage: /bus style [${STYLES.map(s => s.value).join('|')}]` }
      const next: Style = asked ?? nextStyle(style)
      const why = await setStyle($, next)
      return { text: why ? `BUS: style not changed, ${why}.` : `BUS style: ${next}.` }
    }
    if (arg === 'clear') {
      await update($, bus, b => ({ ...b, agents: b.agents.filter(a => a.status === 'running') }))
      return { text: 'BUS: finished agents cleared.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'BUS pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId) {
      const id = e.agentId
      await setAgent($, id, a => ({ ...a, status: 'running', endedAt: null }))
    } else {
      await setMain($, { phase: 'thinking', tool: null, turnStartedAt: now })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId) {
      const failed = e.reason === 'error' || e.reason === 'refusal'
      const id = e.agentId
      await setAgent($, id, a => ({ ...a, status: failed ? 'failed' : 'done', endedAt: now, tool: null }))
    } else {
      await update($, bus, b => ({
        ...b,
        main: {
          ...b.main,
          phase: 'idle' as const,
          tool: null,
          lastTurnMs: b.main.turnStartedAt ? now - b.main.turnStartedAt : b.main.lastTurnMs,
          turnStartedAt: null,
        },
      }))
      const tokens = (await $.session.usage().catch(() => null))?.context.tokens
      const level = handoffLevel(tokens)
      if (level === 'now' && !toasted) {
        toasted = true
        $.ui.toast(`Context ${fmtTok(tokens ?? 0)}: time to hand off to a new chat`)
      }
      if (!level) toasted = false
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.agentId) {
      const now = await $.clock.now()
      const agent: Agent = {
        id: ran.agentId,
        type: e.subagentType,
        description: e.description,
        model: ran.model,
        status: 'running',
        startedAt: now,
        endedAt: null,
        tool: null,
        calls: 0,
        tokens: 0,
      }
      await safe(update($, bus, b => ({ ...b, agents: prune([agent, ...b.agents.filter(a => a.id !== agent.id)]) })))
    }
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const tool = e.tool
    if (e.agentId) {
      const id = e.agentId
      // Only the tool is drawn (the drone's floor); counting calls here would redraw on every call.
      await setAgent($, id, a => ({ ...a, tool }))
    } else {
      await setMain($, { phase: 'tool', tool })
    }
    const ran = await next(e)
    if (!e.agentId) {
      await put($, b => (b.main.turnStartedAt ? { ...b, main: { ...b.main, phase: 'thinking', tool: null } } : b))
    }
    return ran
  })

  // Main loop only: a subagent's step changes nothing the pane draws.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    await setMain($, { model: e.model, effort: typeof e.effort === 'string' ? e.effort : null })
    // Walk the stream by hand to see which kind of block is arriving; only a change of phase writes.
    const stream = next(e)
    let last: Phase | null = null
    let r = await stream.next()
    while (!r.done) {
      const c = r.value
      const phase: Phase | null =
        c.kind === 'thinking' ? 'thinking' : c.kind === 'text' ? 'writing' : c.kind === 'tool' ? 'tool' : null
      if (phase && phase !== last) {
        last = phase
        await setMain($, phase === 'tool' && c.kind === 'tool' ? { phase, tool: c.name } : { phase })
      }
      yield c
      r = await stream.next()
    }
    return r.value
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const b = await read($, bus)
    const now = await $.clock.now()
    const usage = await $.session.usage().catch(() => null)
    const model = b.main.model ?? (await $.session.model().catch(() => null))
    const view = toView(b, usage, model, now)
    ticking = view.isRunning || view.running > 0

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {(style === '1bit' ? terminalLines(view) : tubeTerminalLines(view, TUBE[style])).map(l => (
            <Text color={l.color} bold={l.bold}>
              {l.text}
            </Text>
          ))}
        </Box>
      )
    }

    const { Box, Svg, Button, Text } = $.ui.resolve(e)
    const W = slotPx(e.props.bodyColumns)
    const c = chrome(style)
    const pick = (s: Style) => {
      if (s !== style) void setStyle($, s).then(why => why && $.ui.toast(`BUS: style not changed, ${why}.`))
    }
    // Three pieces: the style switcher in the card's top corner (a row in the card's own color, so it
    // reads as part of it), the card, a still image redrawn with the state, and the scene, a small
    // looping image whose source only changes with what it draws, so the editor never restarts it.
    // No width prop on either Svg: the markup's own width, capped at the pane by the surface (see slotPx).
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="nowrap" backgroundColor={c.bg}>
          <Svg source={corner('left', c.edge)} alt="" />
          {/* the editor turns these into 0.4lh and 0.5ch: a thin strip, the buttons near the corner */}
          <Box flexDirection="row" flexGrow={1} justifyContent="flex-end" columnGap={1} paddingTop={0.4} paddingRight={0.5}>
            {/* The current look is lit text in the card's colour; the others are dim Buttons, which VS Code
                draws as ghosts (no fill, a thin border) where a bright one gets the theme's blue. VS Code draws a
                Button's label, never its children, so a Button cannot carry the palette colour. */}
            {STYLES.map(s =>
              s.value === style ? (
                <Text key={`style-${s.value}`} color={c.on}>{s.label}</Text>
              ) : (
                <Button key={`style-${s.value}`} label={s.label} dimColor onPress={() => pick(s.value)} />
              ),
            )}
          </Box>
          <Svg source={corner('right', c.edge)} alt="" />
        </Box>
        <Svg source={style === '1bit' ? busSvg(view, W) : tubeSvg(view, W, TUBE[style])} alt={view.alt} />
        <Svg source={sceneSvg(style, view.sky, W, now)} alt="" />
      </Box>
    )
  })
}

const prune = (agents: Agent[]) => {
  const running = agents.filter(a => a.status === 'running')
  const ended = agents.filter(a => a.status !== 'running')
  return [...running, ...ended].slice(0, Math.max(MAX_KEPT, running.length))
}
