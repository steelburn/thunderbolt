import type { Agent } from '@/types'

export const defaultAgentBuiltIn: Agent = {
  id: 'agent-built-in',
  name: 'Thunderbolt',
  type: 'built-in',
  transport: 'in-process',
  command: null,
  args: null,
  url: null,
  authMethod: null,
  icon: 'zap',
  isSystem: 1,
  enabled: 1,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultAgentClaudeCode: Agent = {
  id: 'agent-claude-code',
  name: 'Claude Code',
  type: 'local',
  transport: 'stdio',
  command: 'claude',
  args: JSON.stringify(['--acp']),
  url: null,
  authMethod: null,
  icon: 'terminal',
  isSystem: 1,
  enabled: 1,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultAgentCodex: Agent = {
  id: 'agent-codex',
  name: 'Codex',
  type: 'local',
  transport: 'stdio',
  command: 'codex',
  args: JSON.stringify(['--acp']),
  url: null,
  authMethod: null,
  icon: 'code',
  isSystem: 1,
  enabled: 1,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

/** Agents shipped with the app. Local agents are auto-discovered at runtime. */
export const defaultAgents: ReadonlyArray<Agent> = [
  defaultAgentBuiltIn,
  defaultAgentClaudeCode,
  defaultAgentCodex,
] as const
