/**
 * Type definitions for the quality evaluation system
 */

export type Message = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export type ToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ToolInvocation = {
  turn: number
  callId: string
  tool: string
  arguments: Record<string, unknown>
  result: string
  latencyMs: number
  error?: string
}

export type ConversationTrace = {
  id: string
  source: 'synthetic' | 'production'
  initialQuery: string
  messages: Message[]
  toolInvocations: ToolInvocation[]
  finalAnswer: string | null
  turnCount: number
  totalLatencyMs: number
  status: 'completed' | 'max_turns' | 'timeout' | 'error'
  error?: string
  metadata?: {
    testCaseId?: string
    testCaseName?: string
    productionTraceId?: string
  }
}

export type EvaluatorResult = {
  score: number // 0.0 to 1.0
  passed: boolean
  reasoning: string
  metadata?: Record<string, unknown>
}

export type QualityResult = {
  traceId: string
  source: 'synthetic' | 'production'
  query: string
  turnCount: number
  totalLatencyMs: number
  status: ConversationTrace['status']

  scores: {
    toolDecision: EvaluatorResult | null
    toolExecution: EvaluatorResult | null
    answerQuality: EvaluatorResult | null
    journey: EvaluatorResult | null
  }

  overallScore: number
  passed: boolean
}

export type ExecutorConfig = {
  backendUrl: string
  model: string
  maxTurns: number
  timeoutMs: number
  temperature?: number
}

export type SamplingConfig = {
  source: 'recent' | 'manual'

  // For 'recent' source
  hoursBack?: number
  maxTraces?: number
  filters?: {
    hasToolCalls?: boolean
    minTurns?: number
  }

  // For 'manual' source
  traceIds?: string[]
}
