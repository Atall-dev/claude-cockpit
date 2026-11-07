import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { Counts, Meter } from '../types'
import { DIM, INK, fmtGoal, gaugeSvg, parts, progress, slotPx, tubeFor, tubeGaugeSvg } from './gauge'

const zero = (): Counts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 })
const empty = (): Meter => ({ main: zero(), agents: zero(), turn: zero(), turnId: null, usd: null })

// Bump the tag when Meter's fields change: it drops what an older version stored.
const meter = atom({ plugin: 'token-meter', key: 'meter' } as const, empty(), { shape: 'meter-1' })
const isHidden = atom({ plugin: 'token-meter', key: 'isHidden' } as const, false)

const add = (c: Counts, u: TurnUsage): Counts => ({
  input: c.input + u.input_tokens,
  output: c.output + u.output_tokens,
  cacheRead: c.cacheRead + u.cache_read_input_tokens,
  cacheWrite: c.cacheWrite + u.cache_creation_input_tokens,
  requests: c.requests + 1,
})

const sum = (c: Counts) => c.input + c.output + c.cacheRead + c.cacheWrite

const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)

const usd = (v: number | null) => (v === null ? '' : `$${v.toFixed(2)}`)

const line = (label: string, c: Counts) =>
  `${label.padEnd(9)} ${fmt(sum(c)).padStart(8)}  in ${fmt(c.input)} | out ${fmt(c.output)} | cache read ${fmt(c.cacheRead)} | cache write ${fmt(c.cacheWrite)} | ${c.requests} req`

// Where the amber pointer was last drawn: it eases from there to the new total.
let shownFrac = 0

export const register: Register = (on, options) => {
  // The look, shared with the BUS pane: "/bus style" or the pane's switcher sets both. Null is 1-bit.
  const tube = tubeFor(options.style)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Token meter: details, or "/tokens hide", "/tokens show", "/tokens reset"',
    })

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    if (arg === 'hide' || arg === 'show') {
      await update($, isHidden, () => arg === 'hide')
      return { text: arg === 'hide' ? 'Token meter hidden.' : 'Token meter shown.' }
    }
    if (arg === 'reset') {
      await update($, meter, () => empty())
      return { text: 'Token meter reset.' }
    }
    const m = await read($, meter)
    const total: Counts = {
      input: m.main.input + m.agents.input,
      output: m.main.output + m.agents.output,
      cacheRead: m.main.cacheRead + m.agents.cacheRead,
      cacheWrite: m.main.cacheWrite + m.agents.cacheWrite,
      requests: m.main.requests + m.agents.requests,
    }

    return {
      text: [
        line('Session', total),
        line('Main', m.main),
        line('Subagents', m.agents),
        line('Last turn', m.turn),
        m.usd === null ? '' : `Cost so far: ${usd(m.usd)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    }
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      // A failed read must not cost the step's count.
      const cost = (await $.session.usage().catch(() => null))?.cost?.usd ?? null
      await update($, meter, m => {
        const isNewTurn = !e.agentId && e.turnId !== m.turnId
        return {
          main: e.agentId ? m.main : add(m.main, u),
          agents: e.agentId ? add(m.agents, u) : m.agents,
          turn: add(isNewTurn ? zero() : m.turn, u),
          turnId: e.agentId ? m.turnId : e.turnId,
          usd: cost,
        }
      })
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, meter)
    const hasData = m.main.requests + m.agents.requests > 0
    if (e.props.hasSurvey || !hasData || (await read($, isHidden))) {
      return next(e)
    }

    const total = sum(m.main) + sum(m.agents)
    const { goal, frac } = progress(total)
    const alt = `Tokens ${fmt(total)} of ${fmtGoal(goal)}`

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const cells = 30
      const full = Math.min(cells - 1, Math.round(frac * cells))
      const [num, unit] = parts(total)
      if (tube) {
        const P = tube
        return (
          <Box>
            <Text color={P.lab}>TOKENS </Text>
            <Text color={P.num} bold>{num.padStart(6)}</Text>
            <Text color={P.unit}>{unit.padEnd(1)} </Text>
            <Text color={P.fill}>{'━'.repeat(full)}</Text>
            <Text color={P.ptr} bold>┃</Text>
            <Text color={P.restTerm}>{'─'.repeat(cells - full - 1)}</Text>
            <Text color={P.lab}> {fmtGoal(goal)}</Text>
          </Box>
        )
      }
      return (
        <Box>
          <Text color={DIM}>TOKENS </Text>
          <Text color={INK} bold>{num.padStart(6)}</Text>
          <Text color={INK}>{unit.padEnd(1)} [</Text>
          <Text color={INK}>{'█'.repeat(full)}</Text>
          <Text color={INK} bold>▓</Text>
          <Text color={DIM}>{'░'.repeat(cells - full - 1)}</Text>
          <Text color={INK}>] </Text>
          <Text color={DIM}>{fmtGoal(goal)}</Text>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    // No width prop: the markup's own width, which the surface caps at the slot. It is sized a little past the
    // slot's cells so the cap, not a gap, decides: the gauge always spans the row.
    const W = slotPx(e.props.bodyColumns)
    if (tube) {
      // a lower total (a reset) slides from zero
      const from = shownFrac > frac ? 0 : shownFrac
      shownFrac = frac
      return <Svg source={tubeGaugeSvg(total, goal, from, frac, e.props.isWorking, W, tube)} alt={alt} />
    }
    return <Svg source={gaugeSvg(total, goal, frac, e.props.isWorking, W)} alt={alt} />
  })
}
