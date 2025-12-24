/**
 * Response Latency Budget Evaluator
 *
 * Checks if response time is within acceptable limits based on query complexity.
 * This is a heuristic evaluator (no LLM cost).
 */

import type { ConversationTrace, EvaluatorResult } from '../types'

// Latency budgets in milliseconds
const LATENCY_BUDGETS = {
  simple: 5000, // Simple factual queries: 5s
  moderate: 15000, // Queries needing 1-2 tool calls: 15s
  complex: 30000, // Research queries needing multiple tools: 30s
  max: 60000, // Absolute maximum: 60s
}

/**
 * Determine expected complexity based on tool usage
 */
const getExpectedComplexity = (trace: ConversationTrace): 'simple' | 'moderate' | 'complex' => {
  const toolCount = trace.toolInvocations.length
  const turnCount = trace.turnCount

  if (toolCount === 0 && turnCount === 1) {
    return 'simple'
  } else if (toolCount <= 2 && turnCount <= 2) {
    return 'moderate'
  } else {
    return 'complex'
  }
}

/**
 * Evaluate response latency against budget
 */
export const evaluateLatency = (trace: ConversationTrace): EvaluatorResult => {
  const complexity = getExpectedComplexity(trace)
  const budget = LATENCY_BUDGETS[complexity]
  const latency = trace.totalLatencyMs

  // Calculate score based on how well we met the budget
  let score: number
  let reasoning: string

  if (latency <= budget * 0.5) {
    // Under half the budget - excellent
    score = 1.0
    reasoning = `Excellent latency (${(latency / 1000).toFixed(1)}s) - well under ${complexity} budget of ${budget / 1000}s`
  } else if (latency <= budget) {
    // Within budget - good
    score = 0.9 - (0.2 * (latency - budget * 0.5)) / (budget * 0.5)
    reasoning = `Good latency (${(latency / 1000).toFixed(1)}s) - within ${complexity} budget of ${budget / 1000}s`
  } else if (latency <= budget * 1.5) {
    // Slightly over budget - acceptable
    score = 0.5 - (0.2 * (latency - budget)) / (budget * 0.5)
    reasoning = `Acceptable latency (${(latency / 1000).toFixed(1)}s) - slightly over ${complexity} budget of ${budget / 1000}s`
  } else if (latency <= LATENCY_BUDGETS.max) {
    // Over budget but under max - poor
    score = 0.3
    reasoning = `Poor latency (${(latency / 1000).toFixed(1)}s) - significantly over ${complexity} budget of ${budget / 1000}s`
  } else {
    // Over absolute max - failing
    score = 0.1
    reasoning = `Failing latency (${(latency / 1000).toFixed(1)}s) - exceeds maximum allowed of ${LATENCY_BUDGETS.max / 1000}s`
  }

  return {
    score: Math.max(0, Math.min(1, score)), // Clamp to [0, 1]
    passed: score >= 0.7,
    reasoning,
    metadata: {
      latencyMs: latency,
      budgetMs: budget,
      complexity,
      percentOfBudget: Math.round((latency / budget) * 100),
    },
  }
}
