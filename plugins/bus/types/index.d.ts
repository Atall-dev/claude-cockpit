export type Phase = 'idle' | 'thinking' | 'tool' | 'writing'

export type Main = {
  phase: Phase
  tool: string | null
  model: string | null
  effort: string | null
  turnStartedAt: number | null
  lastTurnMs: number | null
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type Agent = {
  id: string
  type: string
  description: string
  model: string
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  tool: string | null
  calls: number
  tokens: number
}

export type Bus = {
  main: Main
  agents: Agent[]
}

declare module 'claude-code' {
  interface PluginState {
    bus: { bus: Shaped<Bus> }
  }
}
