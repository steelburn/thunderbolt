/**
 * Tool Runner - Executes tools by calling the actual backend endpoints
 * This ensures evaluation uses the same tool implementations as production
 */

import type { ToolCall, ToolInvocation } from './types'

type ToolRunnerConfig = {
  backendUrl: string
  timeoutMs: number
}

/**
 * Map tool names to their backend endpoints and request format
 */
const TOOL_ENDPOINTS: Record<
  string,
  {
    path: string
    formatRequest: (args: Record<string, unknown>) => Record<string, unknown>
    formatResponse: (data: unknown) => string
  }
> = {
  web_search: {
    path: '/v1/pro/search',
    formatRequest: (args) => ({
      query: args.query as string,
      max_results: 10,
    }),
    formatResponse: (data) => {
      const response = data as { data?: Array<{ title?: string; url?: string; snippet?: string }> }
      if (!response.data || !Array.isArray(response.data)) {
        return 'No search results found.'
      }
      return response.data
        .map((r, i) => `${i + 1}. ${r.title || 'Untitled'}\n   ${r.url || ''}\n   ${r.snippet || ''}`)
        .join('\n\n')
    },
  },
  fetch_content: {
    path: '/v1/pro/fetch-content',
    formatRequest: (args) => ({
      url: args.url as string,
    }),
    formatResponse: (data) => {
      const response = data as { data?: { text?: string; title?: string } }
      if (!response.data) {
        return 'Failed to fetch content.'
      }
      const title = response.data.title ? `Title: ${response.data.title}\n\n` : ''
      return title + (response.data.text || 'No content extracted.')
    },
  },
}

/**
 * Execute a single tool call by calling the backend
 */
export const executeTool = async (
  toolCall: ToolCall,
  turn: number,
  config: ToolRunnerConfig,
): Promise<ToolInvocation> => {
  const startTime = Date.now()
  const toolName = toolCall.function.name

  let args: Record<string, unknown>
  try {
    args = JSON.parse(toolCall.function.arguments)
  } catch {
    return {
      turn,
      callId: toolCall.id,
      tool: toolName,
      arguments: {},
      result: '',
      latencyMs: Date.now() - startTime,
      error: `Failed to parse tool arguments: ${toolCall.function.arguments}`,
    }
  }

  const endpoint = TOOL_ENDPOINTS[toolName]
  if (!endpoint) {
    return {
      turn,
      callId: toolCall.id,
      tool: toolName,
      arguments: args,
      result: '',
      latencyMs: Date.now() - startTime,
      error: `Unknown tool: ${toolName}. Available tools: ${Object.keys(TOOL_ENDPOINTS).join(', ')}`,
    }
  }

  try {
    const response = await fetch(`${config.backendUrl}${endpoint.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(endpoint.formatRequest(args)),
      signal: AbortSignal.timeout(config.timeoutMs),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        turn,
        callId: toolCall.id,
        tool: toolName,
        arguments: args,
        result: '',
        latencyMs: Date.now() - startTime,
        error: `Tool execution failed (${response.status}): ${errorText}`,
      }
    }

    const data = await response.json()
    const result = endpoint.formatResponse(data)

    return {
      turn,
      callId: toolCall.id,
      tool: toolName,
      arguments: args,
      result,
      latencyMs: Date.now() - startTime,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return {
      turn,
      callId: toolCall.id,
      tool: toolName,
      arguments: args,
      result: '',
      latencyMs: Date.now() - startTime,
      error: `Tool execution error: ${errorMessage}`,
    }
  }
}

/**
 * Execute multiple tool calls in sequence
 * (Sequential to avoid rate limits and maintain order)
 */
export const executeTools = async (
  toolCalls: ToolCall[],
  turn: number,
  config: ToolRunnerConfig,
): Promise<ToolInvocation[]> => {
  const results: ToolInvocation[] = []

  for (const toolCall of toolCalls) {
    const result = await executeTool(toolCall, turn, config)
    results.push(result)
  }

  return results
}

/**
 * Get the tool definitions that the model can use
 * These match the production tool schema
 */
export const getToolDefinitions = () => [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description:
        'Search the web for current information. Use for questions about recent events, facts that may have changed, or topics requiring up-to-date information.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant information',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetch_content',
      description:
        'Fetch and extract the main content from a URL. Use when you need to read the full content of a specific webpage.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch content from',
          },
        },
        required: ['url'],
      },
    },
  },
]
