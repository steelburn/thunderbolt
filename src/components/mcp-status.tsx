import { useMCP } from '@/lib/mcp-provider'
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react'

export function MCPStatus() {
  const { isConnected, error, reconnect } = useMCP()

  if (isConnected) {
    return (
      <div className="flex items-center gap-2 text-green-600">
        <CheckCircle className="h-4 w-4" />
        <span className="text-sm">MCP Connected</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600">
        <XCircle className="h-4 w-4" />
        <span className="text-sm">MCP Error</span>
        <button onClick={reconnect} className="text-xs underline hover:no-underline">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-yellow-600">
      <AlertCircle className="h-4 w-4" />
      <span className="text-sm">MCP Connecting...</span>
    </div>
  )
}
