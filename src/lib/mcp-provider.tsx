import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { experimental_createMCPClient } from 'ai'
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react'

type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>

interface MCPContextType {
  client: MCPClient | null
  isConnected: boolean
  error: Error | null
  reconnect: () => Promise<void>
}

const MCPContext = createContext<MCPContextType | undefined>(undefined)

export function MCPProvider({ children, mcpUrl }: { children: ReactNode; mcpUrl: string }) {
  const [client, setClient] = useState<MCPClient | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const clientRef = useRef<MCPClient | null>(null)

  const initializeClient = async () => {
    try {
      console.log('Initializing MCP client with URL:', mcpUrl)
      const mcpClient = await experimental_createMCPClient({
        transport: new StreamableHTTPClientTransport(new URL(mcpUrl)),
      })

      clientRef.current = mcpClient
      setClient(mcpClient)
      setIsConnected(true)
      setError(null)
      console.log('MCP client initialized successfully')
    } catch (err) {
      console.error('Failed to initialize MCP client:', err)
      setError(err as Error)
      setIsConnected(false)
      setClient(null)
    }
  }

  // Initialize connection
  useEffect(() => {
    initializeClient()

    // Cleanup on unmount
    return () => {
      if (clientRef.current?.close) {
        console.log('Closing MCP client connection')
        try {
          clientRef.current.close()
        } catch (error) {
          console.error('Error closing MCP client:', error)
        }
      }
    }
  }, [mcpUrl])

  const reconnect = async () => {
    console.log('Reconnecting MCP client...')
    // Close existing connection if any
    if (clientRef.current?.close) {
      try {
        clientRef.current.close()
      } catch (error) {
        console.error('Error closing existing MCP client:', error)
      }
    }

    // Reset state
    setClient(null)
    setIsConnected(false)
    setError(null)

    // Reinitialize
    await initializeClient()
  }

  return <MCPContext.Provider value={{ client, isConnected, error, reconnect }}>{children}</MCPContext.Provider>
}

export function useMCP() {
  const context = useContext(MCPContext)
  if (!context) {
    throw new Error('useMCP must be used within an MCPProvider')
  }
  return context
}

// Export the MCPClient type for use in other files
export type { MCPClient }
