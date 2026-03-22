import type { Agent } from '@/types'
import type { ClientSideConnection, SessionConfigOption, SessionModeState, Stream } from '@agentclientprotocol/sdk'
import type { StdioStreamResult } from './stdio-stream'
import type { SessionUpdateHandler } from './types'

export type LocalAgentDependencies = {
  createStdioStream: (opts: { command: string; args: string[] }) => StdioStreamResult
  createClientConnection: (
    stream: Stream,
    onSessionUpdate: SessionUpdateHandler,
    onRequestPermission: (
      params: unknown,
    ) => Promise<{ outcome: { outcome: 'cancelled' | 'selected'; optionId?: string } }>,
  ) => ClientSideConnection
  onSessionUpdate: SessionUpdateHandler
}

export type LocalAgentConnection = {
  connection: ClientSideConnection
  sessionId: string
  modes: SessionModeState | null
  configOptions: SessionConfigOption[]
  kill: () => Promise<void>
  onExit: (handler: (code: number) => void) => () => void
}

/**
 * Connects to a local CLI agent by spawning its process and establishing
 * an ACP connection over stdio. Handles initialization and session creation.
 */
export const connectToLocalAgent = async (
  agent: Agent,
  deps: LocalAgentDependencies,
): Promise<LocalAgentConnection> => {
  if (!agent.command) {
    throw new Error('Agent has no command configured')
  }

  const args: string[] = agent.args ? JSON.parse(agent.args) : []

  const { stream, process } = deps.createStdioStream({
    command: agent.command,
    args,
  })

  const exitHandlers = new Set<(code: number) => void>()

  process.onClose((code: number) => {
    exitHandlers.forEach((handler) => handler(code))
  })

  const connection = deps.createClientConnection(stream, deps.onSessionUpdate, async () => ({
    outcome: { outcome: 'cancelled' as const },
  }))

  await connection.initialize({
    protocolVersion: 1,
    clientInfo: { name: 'thunderbolt', version: '1.0.0' },
  })

  const session = await connection.newSession({
    cwd: '.',
    mcpServers: [],
  })

  return {
    connection,
    sessionId: session.sessionId,
    modes: session.modes ?? null,
    configOptions: session.configOptions ?? [],
    kill: process.kill,
    onExit: (handler: (code: number) => void) => {
      exitHandlers.add(handler)
      return () => exitHandlers.delete(handler)
    },
  }
}

/**
 * Disconnects from a local agent by killing its process.
 */
export const disconnectLocalAgent = async (conn: LocalAgentConnection): Promise<void> => {
  await conn.kill()
}
