/**
 * Multi-Turn Conversation Executor
 *
 * Executes a complete conversation with the model, including:
 * - Sending messages to the chat completions API
 * - Parsing streaming responses
 * - Executing tool calls when requested
 * - Continuing the conversation until completion or max turns
 */

import type { ConversationTrace, ExecutorConfig, Message, ToolCall, ToolInvocation } from './types'
import { executeTools, getToolDefinitions } from './tool-runner'

type StreamedResponse = {
  content: string
  toolCalls: ToolCall[]
  finishReason: string | undefined
}

/**
 * Call the chat completions API and parse the streamed response
 */
const callChatAPI = async (messages: Message[], config: ExecutorConfig): Promise<StreamedResponse> => {
  const response = await fetch(`${config.backendUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
      })),
      stream: true,
      temperature: config.temperature ?? 0.7,
      tools: getToolDefinitions(),
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[Executor] Chat API error (${response.status}):`, errorText.slice(0, 200))
    throw new Error(`Chat API failed (${response.status}): ${errorText}`)
  }

  const text = await response.text()
  const lines = text.split('\n').filter((line) => line.startsWith('data: '))

  let content = ''
  const toolCalls: ToolCall[] = []
  const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map()
  let finishReason: string | undefined

  for (const line of lines) {
    const data = line.slice(6) // Remove 'data: ' prefix
    if (data === '[DONE]') break

    try {
      const chunk = JSON.parse(data)
      const choice = chunk.choices?.[0]

      if (choice?.delta?.content) {
        content += choice.delta.content
      }

      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          let existing = toolCallsInProgress.get(tc.index)
          if (!existing) {
            existing = { id: tc.id ?? '', name: '', arguments: '' }
            toolCallsInProgress.set(tc.index, existing)
          }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.name = tc.function.name
          if (tc.function?.arguments) existing.arguments += tc.function.arguments
        }
      }

      if (choice?.finish_reason) {
        finishReason = choice.finish_reason
      }
    } catch {
      // Skip malformed chunks
    }
  }

  // Convert in-progress tool calls to final format
  for (const [, tc] of toolCallsInProgress) {
    if (tc.id && tc.name) {
      toolCalls.push({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      })
    }
  }

  return { content, toolCalls, finishReason }
}

/**
 * Execute a complete multi-turn conversation
 *
 * @param initialQuery - The user's question
 * @param config - Executor configuration
 * @returns A complete trace of the conversation
 */
export const executeConversation = async (
  initialQuery: string,
  config: ExecutorConfig,
  metadata?: { testCaseId?: string; testCaseName?: string },
): Promise<ConversationTrace> => {
  const startTime = Date.now()
  const traceId = crypto.randomUUID()

  const messages: Message[] = [{ role: 'user', content: initialQuery }]
  const toolInvocations: ToolInvocation[] = []

  let turnCount = 0
  let status: ConversationTrace['status'] = 'completed'
  let error: string | undefined
  let finalAnswer: string | null = null

  try {
    while (turnCount < config.maxTurns) {
      turnCount++

      // Check timeout
      if (Date.now() - startTime > config.timeoutMs) {
        status = 'timeout'
        error = `Conversation timed out after ${config.timeoutMs}ms`
        break
      }

      // Call the model
      const response = await callChatAPI(messages, config)

      // If the model returned content (no tool calls), we're done
      if (response.toolCalls.length === 0) {
        finalAnswer = response.content
        messages.push({
          role: 'assistant',
          content: response.content,
        })
        break
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      })

      // Execute each tool call
      const toolResults = await executeTools(response.toolCalls, turnCount, {
        backendUrl: config.backendUrl,
        timeoutMs: config.timeoutMs,
      })

      // Record tool invocations
      toolInvocations.push(...toolResults)

      // Add tool results as messages
      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          content: result.error || result.result,
          tool_call_id: result.callId,
        })
      }
    }

    // Check if we hit max turns without getting an answer
    if (turnCount >= config.maxTurns && !finalAnswer) {
      status = 'max_turns'
      // Try to extract any content from the last assistant message
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop()
      if (lastAssistant?.content) {
        finalAnswer = lastAssistant.content
      }
    }
  } catch (e) {
    status = 'error'
    error = e instanceof Error ? e.message : 'Unknown error'
    console.error(`[Executor] Error for "${initialQuery.slice(0, 50)}...":`, error)
  }

  return {
    id: traceId,
    source: 'synthetic',
    initialQuery,
    messages,
    toolInvocations,
    finalAnswer,
    turnCount,
    totalLatencyMs: Date.now() - startTime,
    status,
    error,
    metadata,
  }
}

/**
 * Execute multiple conversations in parallel with concurrency limit
 */
export const executeConversationsBatch = async (
  queries: Array<{ query: string; id?: string; name?: string }>,
  config: ExecutorConfig,
  maxConcurrent: number = 2,
): Promise<ConversationTrace[]> => {
  const results: ConversationTrace[] = []

  // Process in batches of maxConcurrent
  for (let i = 0; i < queries.length; i += maxConcurrent) {
    const batch = queries.slice(i, i + maxConcurrent)
    const batchResults = await Promise.all(
      batch.map((q) => executeConversation(q.query, config, { testCaseId: q.id, testCaseName: q.name })),
    )
    results.push(...batchResults)
  }

  return results
}
