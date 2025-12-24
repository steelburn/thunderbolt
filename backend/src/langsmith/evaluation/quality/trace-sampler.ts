/**
 * Production Trace Sampler
 *
 * Fetches and filters production traces from LangSmith for evaluation.
 * Supports both automatic sampling of recent traces and manual trace selection.
 */

import { getLangSmithClient, getLangSmithProject, isLangSmithConfigured } from '../../client'
import type { ConversationTrace, Message, SamplingConfig, ToolInvocation } from './types'

type LangSmithRun = {
  id: string
  name: string
  run_type: string
  inputs?: {
    messages?: Array<{
      role: string
      content: string
      tool_call_id?: string
      tool_calls?: Array<{
        id: string
        type: string
        function: { name: string; arguments: string }
      }>
    }>
  }
  outputs?: {
    content?: string
    tool_calls?: Array<{
      name: string
      arguments: string
    }>
  }
  start_time?: string
  end_time?: string
  extra?: {
    metadata?: Record<string, unknown>
  }
  child_runs?: LangSmithRun[]
}

/**
 * Convert a LangSmith run to a ConversationTrace
 * This is a best-effort conversion since LangSmith traces may have different structures
 */
const runToConversationTrace = (run: LangSmithRun): ConversationTrace | null => {
  try {
    const messages: Message[] = []
    const toolInvocations: ToolInvocation[] = []

    // Extract messages from inputs
    if (run.inputs?.messages) {
      for (const msg of run.inputs.messages) {
        messages.push({
          role: msg.role as Message['role'],
          content: msg.content || '',
          tool_call_id: msg.tool_call_id,
          tool_calls: msg.tool_calls?.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: tc.function,
          })),
        })
      }
    }

    // Find the initial user query
    const userMessage = messages.find((m) => m.role === 'user')
    if (!userMessage) {
      return null // Can't evaluate without a user query
    }

    // Extract tool calls from child runs if available
    let turnCount = 1
    if (run.child_runs) {
      for (const child of run.child_runs) {
        if (child.run_type === 'tool' || child.name?.includes('tool')) {
          toolInvocations.push({
            turn: turnCount,
            callId: child.id,
            tool: child.name || 'unknown',
            arguments: (child.inputs as Record<string, unknown>) || {},
            result: typeof child.outputs === 'string' ? child.outputs : JSON.stringify(child.outputs || {}),
            latencyMs: calculateLatency(child.start_time, child.end_time),
          })
        }
      }
    }

    // Try to find final answer
    let finalAnswer: string | null = null
    if (run.outputs?.content) {
      finalAnswer = run.outputs.content
    } else {
      // Look for last assistant message
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop()
      if (lastAssistant?.content && !lastAssistant.tool_calls?.length) {
        finalAnswer = lastAssistant.content
      }
    }

    return {
      id: run.id,
      source: 'production',
      initialQuery: userMessage.content,
      messages,
      toolInvocations,
      finalAnswer,
      turnCount: Math.max(1, toolInvocations.length > 0 ? toolInvocations.length + 1 : 1),
      totalLatencyMs: calculateLatency(run.start_time, run.end_time),
      status: 'completed',
      metadata: {
        productionTraceId: run.id,
      },
    }
  } catch (e) {
    console.error(`Failed to convert run ${run.id} to trace:`, e)
    return null
  }
}

const calculateLatency = (startTime?: string, endTime?: string): number => {
  if (!startTime || !endTime) return 0
  return new Date(endTime).getTime() - new Date(startTime).getTime()
}

/**
 * Sample recent production traces from LangSmith
 */
export const sampleRecentTraces = async (config: SamplingConfig): Promise<ConversationTrace[]> => {
  if (!isLangSmithConfigured()) {
    console.warn('[TraceSampler] LangSmith not configured, cannot sample production traces')
    return []
  }

  const client = getLangSmithClient()
  const project = getLangSmithProject()

  const hoursBack = config.hoursBack ?? 24
  const maxTraces = config.maxTraces ?? 20
  const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000)

  try {
    // List runs from the project
    const runs: LangSmithRun[] = []

    // Use the listRuns method with filters
    const runIterator = client.listRuns({
      projectName: project,
      startTime,
      runType: 'llm',
      limit: maxTraces * 2, // Fetch extra in case some are filtered out
    })

    for await (const run of runIterator) {
      // Type assertion since the SDK types may not match exactly
      const typedRun = run as unknown as LangSmithRun

      // Apply filters
      if (config.filters?.hasToolCalls) {
        const hasToolCalls = typedRun.outputs?.tool_calls && typedRun.outputs.tool_calls.length > 0
        if (!hasToolCalls) continue
      }

      runs.push(typedRun)

      if (runs.length >= maxTraces) break
    }

    // Convert runs to conversation traces
    const traces: ConversationTrace[] = []
    for (const run of runs) {
      const trace = runToConversationTrace(run)
      if (trace) {
        traces.push(trace)
      }
    }

    console.log(`[TraceSampler] Sampled ${traces.length} production traces from last ${hoursBack}h`)
    return traces
  } catch (error) {
    console.error('[TraceSampler] Failed to sample traces:', error)
    return []
  }
}

/**
 * Fetch specific traces by ID from LangSmith
 */
export const fetchTracesByIds = async (traceIds: string[]): Promise<ConversationTrace[]> => {
  if (!isLangSmithConfigured()) {
    console.warn('[TraceSampler] LangSmith not configured')
    return []
  }

  const client = getLangSmithClient()
  const traces: ConversationTrace[] = []

  for (const traceId of traceIds) {
    try {
      const run = (await client.readRun(traceId)) as unknown as LangSmithRun
      const trace = runToConversationTrace(run)
      if (trace) {
        traces.push(trace)
      }
    } catch (error) {
      console.error(`[TraceSampler] Failed to fetch trace ${traceId}:`, error)
    }
  }

  console.log(`[TraceSampler] Fetched ${traces.length}/${traceIds.length} traces by ID`)
  return traces
}

/**
 * Main entry point for sampling traces
 */
export const sampleProductionTraces = async (config: SamplingConfig): Promise<ConversationTrace[]> => {
  if (config.source === 'manual' && config.traceIds?.length) {
    return fetchTracesByIds(config.traceIds)
  }

  return sampleRecentTraces(config)
}
