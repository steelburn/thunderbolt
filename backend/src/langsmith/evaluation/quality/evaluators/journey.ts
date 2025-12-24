/**
 * Journey Quality Evaluator
 *
 * Evaluates the efficiency and quality of the conversation path:
 * - Was the conversation path efficient?
 * - Were there unnecessary turns?
 * - Was the latency acceptable?
 */

import { createLLMAsJudge } from 'openevals'
import type { ConversationTrace, EvaluatorResult } from '../types'

const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

// Continuous score choices for openevals
const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

const JOURNEY_QUALITY_PROMPT = `You are evaluating the efficiency of an AI assistant's conversation path to answer a question.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Evaluation Criteria

1. **Path Efficiency**:
   - Was the number of turns reasonable for this question?
   - Simple questions should be answered in 1-2 turns
   - Complex research may need 3-4 turns
   - More than 4 turns suggests inefficiency

2. **Tool Usage Efficiency**:
   - Were there redundant or repetitive tool calls?
   - Did the model search for the same information multiple times?
   - Could fewer tools have achieved the same result?

3. **Latency**:
   - Under 5 seconds: Excellent
   - 5-15 seconds: Acceptable for tool-using queries
   - 15-30 seconds: Slow but acceptable for complex research
   - Over 30 seconds: Too slow

4. **Conversation Status**:
   - "completed": Good
   - "max_turns": Hit the turn limit - might indicate the model got stuck
   - "timeout": Took too long
   - "error": Something went wrong

Provide your reasoning, then assign a score from 0.0 to 1.0.`

/**
 * Format tools summary for the evaluator
 */
const formatToolsSummary = (trace: ConversationTrace): string => {
  if (trace.toolInvocations.length === 0) {
    return 'None (direct answer)'
  }

  const toolCounts: Record<string, number> = {}
  for (const t of trace.toolInvocations) {
    toolCounts[t.tool] = (toolCounts[t.tool] || 0) + 1
  }

  return Object.entries(toolCounts)
    .map(([tool, count]) => `${tool}: ${count} call(s)`)
    .join(', ')
}

/**
 * Evaluate journey quality
 */
export const evaluateJourney = async (trace: ConversationTrace): Promise<EvaluatorResult> => {
  const toolsSummary = formatToolsSummary(trace)
  const finalAnswer = trace.finalAnswer || '(No final answer)'

  // Format for openevals
  const inputsContent = `QUESTION: ${trace.initialQuery}

CONVERSATION SUMMARY:
- Total turns: ${trace.turnCount}
- Total latency: ${trace.totalLatencyMs}ms
- Tools invoked: ${toolsSummary}
- Status: ${trace.status}`

  const outputsContent = `FINAL ANSWER: ${finalAnswer}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: JOURNEY_QUALITY_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'journey_quality',
      choices: SCORE_CHOICES, // Enable continuous scoring
    })

    const result = await evaluator({
      inputs: inputsContent,
      outputs: outputsContent,
    })

    // Handle both number and boolean scores
    let score: number
    if (typeof result.score === 'number') {
      score = result.score
    } else if (typeof result.score === 'boolean') {
      score = result.score ? 1.0 : 0.0
    } else {
      score = 0
    }

    const reasoning = String(result.comment || 'No reasoning provided')

    return {
      score,
      passed: score >= 0.7,
      reasoning,
      metadata: {
        turnCount: trace.turnCount,
        latencyMs: trace.totalLatencyMs,
        status: trace.status,
        toolCount: trace.toolInvocations.length,
      },
    }
  } catch (error) {
    return {
      score: 0,
      passed: false,
      reasoning: `Journey evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}

/**
 * Quick heuristic-based journey scoring (no LLM)
 * Can be used as a supplement or when LLM is unavailable
 */
export const evaluateJourneyHeuristic = (trace: ConversationTrace): EvaluatorResult => {
  let score = 1.0
  const reasons: string[] = []

  // Turn count scoring
  if (trace.turnCount === 1) {
    // Perfect for simple questions
  } else if (trace.turnCount === 2) {
    // Good for tool-using questions
  } else if (trace.turnCount <= 4) {
    score -= 0.1
    reasons.push(`${trace.turnCount} turns (moderately complex path)`)
  } else {
    score -= 0.3
    reasons.push(`${trace.turnCount} turns (too many turns)`)
  }

  // Latency scoring
  if (trace.totalLatencyMs < 5000) {
    // Excellent
  } else if (trace.totalLatencyMs < 15000) {
    score -= 0.1
    reasons.push(`Latency ${(trace.totalLatencyMs / 1000).toFixed(1)}s (acceptable)`)
  } else if (trace.totalLatencyMs < 30000) {
    score -= 0.2
    reasons.push(`Latency ${(trace.totalLatencyMs / 1000).toFixed(1)}s (slow)`)
  } else {
    score -= 0.4
    reasons.push(`Latency ${(trace.totalLatencyMs / 1000).toFixed(1)}s (very slow)`)
  }

  // Status scoring
  if (trace.status === 'max_turns') {
    score -= 0.3
    reasons.push('Hit max turns limit')
  } else if (trace.status === 'timeout') {
    score -= 0.4
    reasons.push('Timed out')
  } else if (trace.status === 'error') {
    score -= 0.5
    reasons.push('Error occurred')
  }

  // No answer penalty
  if (!trace.finalAnswer) {
    score -= 0.3
    reasons.push('No final answer provided')
  }

  // Ensure score is in valid range
  score = Math.max(0, Math.min(1, score))

  return {
    score,
    passed: score >= 0.7,
    reasoning: reasons.length > 0 ? `Issues: ${reasons.join('; ')}` : 'Efficient path with good latency',
    metadata: {
      turnCount: trace.turnCount,
      latencyMs: trace.totalLatencyMs,
      status: trace.status,
    },
  }
}
