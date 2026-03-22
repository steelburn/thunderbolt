import {
  ClientSideConnection,
  type Client,
  type Agent,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type Stream,
  type SessionMode,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk'
import type { AgentSessionState } from './types'

type SessionUpdateHandler = (update: SessionNotification['update']) => void

type AcpClientOptions = {
  stream: Stream
  onSessionUpdate?: SessionUpdateHandler
  onPermissionRequest?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
}

/**
 * Thin wrapper around ACP ClientSideConnection with Thunderbolt-specific helpers.
 */
export const createAcpClient = ({ stream, onSessionUpdate, onPermissionRequest }: AcpClientOptions) => {
  let sessionState: AgentSessionState | null = null

  const client: (agent: Agent) => Client = (_agent) => ({
    sessionUpdate: async (params: SessionNotification) => {
      const update = params.update

      // Track mode/config changes from agent
      if (update.sessionUpdate === 'current_mode_update' && sessionState) {
        sessionState.currentModeId = update.currentModeId
      }
      if (update.sessionUpdate === 'config_option_update' && sessionState) {
        sessionState.configOptions = update.configOptions
      }

      onSessionUpdate?.(update)
    },

    requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
      if (onPermissionRequest) {
        return onPermissionRequest(params)
      }
      // Default: allow once
      const allowOption = params.options.find((o) => o.kind === 'allow_once')
      return allowOption ? { outcome: 'selected', optionId: allowOption.optionId } : { outcome: 'cancelled' }
    },
  })

  const connection = new ClientSideConnection(client, stream)

  return {
    connection,

    initialize: async () => {
      const result = await connection.initialize({
        clientInfo: { name: 'Thunderbolt', version: '1.0.0' },
        protocolVersion: 1,
        capabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      })
      return result
    },

    createSession: async (cwd?: string): Promise<AgentSessionState> => {
      const result = await connection.newSession({
        cwd: cwd ?? '.',
        mcpServers: [],
      })
      sessionState = {
        sessionId: result.sessionId,
        availableModes: result.modeState?.availableModes ?? [],
        currentModeId: result.modeState?.currentModeId ?? null,
        configOptions: result.configOptions ?? [],
      }
      return sessionState
    },

    prompt: async (text: string) => {
      if (!sessionState) {
        throw new Error('No active session. Call createSession() first.')
      }
      return connection.prompt({
        sessionId: sessionState.sessionId,
        prompt: [{ type: 'text', text }],
      })
    },

    setMode: async (modeId: string) => {
      if (!sessionState) {
        throw new Error('No active session')
      }
      return connection.setSessionMode({
        sessionId: sessionState.sessionId,
        modeId,
      })
    },

    setConfigOption: async (configId: string, value: string) => {
      if (!sessionState) {
        throw new Error('No active session')
      }
      return connection.setSessionConfigOption({
        sessionId: sessionState.sessionId,
        configId,
        value,
      })
    },

    cancel: async () => {
      if (!sessionState) {
        return
      }
      return connection.cancel({
        sessionId: sessionState.sessionId,
      })
    },

    getSessionState: () => sessionState,

    get signal() {
      return connection.signal
    },

    get closed() {
      return connection.closed
    },
  }
}

export type AcpClient = ReturnType<typeof createAcpClient>
