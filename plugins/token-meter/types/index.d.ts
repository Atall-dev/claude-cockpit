export type Counts = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
}

export type Meter = {
  main: Counts
  agents: Counts
  turn: Counts
  turnId: string | null
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { meter: Shaped<Meter>; isHidden: boolean }
  }
}
