/**
 * Quality Evaluators
 *
 * LLM-as-judge evaluators and heuristics for comprehensive quality assessment
 */

// Core evaluators
export { evaluateToolDecision } from './tool-decision'
export { evaluateToolExecution } from './tool-execution'
export { evaluateAnswerQuality } from './answer-quality'
export { evaluateJourney, evaluateJourneyHeuristic } from './journey'

// New evaluators
export { evaluateFaithfulness } from './faithfulness'
export { evaluateHallucination } from './hallucination'
export { evaluateLatency } from './latency'
export { evaluateTokenEfficiency } from './token-efficiency'
export { evaluateConfidence } from './confidence'
export { evaluateInstructionFollowing } from './instruction-following'

import type { ConversationTrace, EvaluatorResult, QualityResult } from '../types'
import { evaluateToolDecision } from './tool-decision'
import { evaluateToolExecution } from './tool-execution'
import { evaluateAnswerQuality } from './answer-quality'
import { evaluateJourney } from './journey'

/**
 * Run all quality evaluators on a conversation trace
 */
export const evaluateConversation = async (trace: ConversationTrace): Promise<QualityResult> => {
  // Run all evaluators in parallel
  const [toolDecision, toolExecution, answerQuality, journey] = await Promise.all([
    evaluateToolDecision(trace),
    evaluateToolExecution(trace), // Returns null if no tools were used
    evaluateAnswerQuality(trace),
    evaluateJourney(trace),
  ])

  // Calculate overall score (weighted average)
  const scores: number[] = []
  const weights: number[] = []

  // Tool decision - weight: 0.2
  scores.push(toolDecision.score)
  weights.push(0.2)

  // Tool execution - weight: 0.2 (only if tools were used)
  if (toolExecution) {
    scores.push(toolExecution.score)
    weights.push(0.2)
  }

  // Answer quality - weight: 0.4 (most important)
  scores.push(answerQuality.score)
  weights.push(0.4)

  // Journey - weight: 0.2
  scores.push(journey.score)
  weights.push(0.2)

  // Normalize weights if tool execution was skipped
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const overallScore = scores.reduce((sum, score, i) => sum + score * weights[i], 0) / totalWeight

  // Pass if overall score >= 0.7 and no critical failures
  const criticalFailure = answerQuality.score < 0.3 || (toolDecision.score < 0.3 && trace.toolInvocations.length > 0)
  const passed = overallScore >= 0.7 && !criticalFailure

  return {
    traceId: trace.id,
    source: trace.source,
    query: trace.initialQuery,
    turnCount: trace.turnCount,
    totalLatencyMs: trace.totalLatencyMs,
    status: trace.status,
    scores: {
      toolDecision,
      toolExecution,
      answerQuality,
      journey,
    },
    overallScore,
    passed,
  }
}

/**
 * Run evaluators on multiple traces with concurrency limit
 */
export const evaluateTracesBatch = async (
  traces: ConversationTrace[],
  maxConcurrent: number = 2,
): Promise<QualityResult[]> => {
  const results: QualityResult[] = []

  for (let i = 0; i < traces.length; i += maxConcurrent) {
    const batch = traces.slice(i, i + maxConcurrent)
    const batchResults = await Promise.all(batch.map(evaluateConversation))
    results.push(...batchResults)
  }

  return results
}
