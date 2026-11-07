import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'token-meter',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

type U = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

test('totals main and subagent requests into one 1-bit gauge', { options: { style: '1bit' } }, async ($, on) => {
  const queue: U[] = [
    { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
    { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ]
  on('turn.step', async function* (_, e) {
    const usage = { ...queue.shift()!, model: 'm' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  // Stands for the engine's own band when the meter yields.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 1.5 } } as never }))

  const step = async (turnId: string, agentId?: string) => {
    const s = $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of s) {
      // drain
    }
    await s.result
  }

  // Before any request the band yields to the engine.
  const before = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await before.find({ type: 'Text' }))?.text).toBe('engine')
  await before.unmount()

  await step('t1')
  await step('a1', 'agent-1')
  await step('t2')
  // 1310 main + 55 agent + 2 main = 1367 tokens, next milestone 100k.

  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /1\.4/ }))?.text?.trim()).toBe('1.4')
  expect((await term.find({ type: 'Text', text: /100K/ }))?.text?.trim()).toBe('100K')
  await term.unmount()

  const vs = await $.ui.mount({ ...BAND, surface: 'vscode', props: { ...BAND.props, isWorking: true } })
  const svg = await vs.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('Tokens 1.4k of 100K')
  const source = String(svg?.props.source)
  expect(source).toContain('>1.4<tspan')
  expect(source).toContain('dx="3">K</tspan>')
  expect(source).toContain('width="1260"') // 120 cells: the gauge spans the row
  expect(source).toContain('>25K</text>') // quarter mark of the 100K scale
  // 1-bit: one ink on black, tones only as dither, no amber left
  const colors = new Set(source.match(/#[0-9a-f]{6}/gi))
  expect([...colors].sort()).toEqual(['#000000', '#ece8dc'])
  expect(source).toContain('h2v2h-2z') // empty cells are ':' dots, placed per cell
  expect(source).toContain('url(#d50)')
  expect(source).not.toContain('opacity="0.') // no grey made by transparency
  expect(source).toContain('repeatCount="indefinite"') // pointer blinks while working
  // no smooth motion: every animation steps, nothing slides
  expect(source).not.toContain('calcMode="spline"')
  expect(source).not.toContain('animateTransform')
  expect(source.match(/<animate /g)?.length).toBe((source.match(/calcMode="discrete"/g) ?? []).length)
  await vs.unmount()
})

test('the pointer stops pulsing when no turn runs', async ($, on) => {
  on('turn.step', async function* (_, e) {
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } as never }))
  const s = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  for await (const _ of s) {
    // drain
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).not.toContain('repeatCount="indefinite"')
  await ui.unmount()
})

// Amber is the default: the phosphor gauge, its pointer stepping while a turn runs.
test('amber by default, the 1-bit look only when chosen', async ($, on) => {
  on('turn.step', async function* (_, e) {
    const usage = { input_tokens: 30000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } as never }))
  const s = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  for await (const _ of s) {
    // drain
  }
  const vs = await $.ui.mount({ ...BAND, surface: 'vscode', props: { ...BAND.props, isWorking: true } })
  const source = String((await vs.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('#ff9d1c')
  expect(source).not.toContain('#ece8dc')
  expect(source).toContain('>31.0<tspan')
  expect(source).toContain('>25K</text>') // the 100K scale marked in quarters
  for (const a of source.match(/<animate(Transform)? [^>]*repeatCount[^>]*>/g) ?? []) expect(a).toContain('calcMode="discrete"')
  await vs.unmount()
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /TOKENS/ }))?.props.color).toBe('#b08035')
  await term.unmount()
})

// Firefly is the tube in the moss palette: catches a register that ignores the palette and draws amber.
test('firefly draws the tube gauge in lime on moss', { options: { style: 'firefly' } }, async ($, on) => {
  on('turn.step', async function* (_, e) {
    const usage = { input_tokens: 30000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } as never }))
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })) {
    // drain
  }
  const vs = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const source = String((await vs.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('#0a110b')
  expect(source).toContain('#8fb05f')
  expect(source).not.toContain('#ff9d1c')
  expect(source).not.toContain('#140d05')
  await vs.unmount()
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /TOKENS/ }))?.props.color).toBe('#8fb05f')
  await term.unmount()
})
