import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk'

/**
 * Abstraction over the Tauri Command API for spawning child processes.
 * Returns streams and lifecycle controls for the spawned process.
 */
export type TauriCommandSpawner = (
  command: string,
  args: string[],
) => {
  stdout: ReadableStream<Uint8Array>
  stdin: WritableStream<Uint8Array>
  onClose: (handler: (code: number) => void) => void
  kill: () => Promise<void>
}

export type StdioStreamResult = {
  stream: Stream
  process: {
    kill: () => Promise<void>
    onClose: (handler: (code: number) => void) => void
  }
}

type CreateStdioStreamOptions = {
  command: string
  args: string[]
  spawn: TauriCommandSpawner
}

/**
 * Creates an ACP stream by spawning a CLI agent process via Tauri's Command API.
 * Bridges the process's stdin/stdout to Web Streams wrapped with ndJsonStream
 * for ACP JSON-RPC communication.
 */
export const createStdioStream = (options: CreateStdioStreamOptions): StdioStreamResult => {
  const { command, args, spawn } = options

  const child = spawn(command, args)
  const stream = ndJsonStream(child.stdin, child.stdout)

  return {
    stream,
    process: {
      kill: child.kill,
      onClose: child.onClose,
    },
  }
}
