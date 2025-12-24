import { getLangSmithClient, getLangSmithProject, shouldTrace } from './client'

export type TraceMetadata = {
  model: string
  provider: string
  userId?: string
  sessionId?: string
  hasTools: boolean
  temperature?: number
}

export type TraceContext = {
  runId: string
  shouldTrace: boolean
}

/**
 * Start a new trace for an inference request
 * Returns a context object that can be used to end the trace
 */
export const startInferenceTrace = async (
  messages: Array<{ role: string; content: string }>,
  metadata: TraceMetadata,
): Promise<TraceContext | null> => {
  if (!shouldTrace()) {
    return null
  }

  const client = getLangSmithClient()
  const project = getLangSmithProject()

  // Generate our own run ID since createRun returns void
  const runId = crypto.randomUUID()

  await client.createRun({
    id: runId,
    name: 'chat_completion',
    run_type: 'llm',
    inputs: {
      messages,
      model: metadata.model,
      provider: metadata.provider,
      has_tools: metadata.hasTools,
      temperature: metadata.temperature,
    },
    extra: {
      metadata: {
        user_id: metadata.userId,
        session_id: metadata.sessionId,
        model: metadata.model,
        provider: metadata.provider,
      },
    },
    project_name: project,
  })

  return {
    runId,
    shouldTrace: true,
  }
}

/**
 * End a trace with the completion result
 */
export const endInferenceTrace = async (
  context: TraceContext | null,
  output: {
    content?: string
    toolCalls?: Array<{ name: string; arguments: string }>
    finishReason?: string
    tokenUsage?: {
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
    }
  },
  error?: Error,
): Promise<void> => {
  if (!context?.shouldTrace) {
    return
  }

  const client = getLangSmithClient()

  await client.updateRun(context.runId, {
    outputs: error
      ? { error: error.message }
      : {
          content: output.content,
          tool_calls: output.toolCalls,
          finish_reason: output.finishReason,
          usage: output.tokenUsage,
        },
    error: error?.message,
    end_time: Date.now(),
  })
}

/**
 * Trace metadata for evaluation purposes
 */
export type EvaluationMetadata = {
  toolCallCount: number
  responseLength: number
  hasTable: boolean
  containsSearch: boolean
  latencyMs: number
}

/**
 * Extract evaluation-relevant metadata from a completion
 */
export const extractEvaluationMetadata = (
  content: string,
  toolCalls: Array<{ name: string }>,
  startTime: number,
): EvaluationMetadata => {
  return {
    toolCallCount: toolCalls.length,
    responseLength: content.length,
    hasTable: /\|.*\|.*\|/m.test(content), // Simple table detection
    containsSearch: toolCalls.some((tc) => tc.name.includes('search') || tc.name.includes('web')),
    latencyMs: Date.now() - startTime,
  }
}
