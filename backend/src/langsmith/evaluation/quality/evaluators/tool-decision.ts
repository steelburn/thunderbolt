/**
 * Tool Decision Evaluator
 *
 * Evaluates whether the model made appropriate decisions about tool usage:
 * - Did it use tools when it should have?
 * - Did it avoid tools when they weren't needed?
 */

import { createLLMAsJudge } from 'openevals'
import type { ConversationTrace, EvaluatorResult } from '../types'

const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

// Continuous score choices for openevals
const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

const TOOL_DECISION_PROMPT = `You are evaluating whether an AI assistant made appropriate decisions about using tools (web search, fetch content) to answer a question.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Evaluation Criteria

1. **Should tools have been used?**
   - YES for: current events, real-time data (weather, stock prices), recent news, company info that changes, software versions
   - NO for: math calculations, well-known historical facts, coding concepts, general knowledge

2. **Were tools used appropriately?**
   - If tools SHOULD have been used but weren't → score LOW (0.0-0.3)
   - If tools were used UNNECESSARILY → score MEDIUM (0.4-0.6)
   - If tool usage was APPROPRIATE (used when needed, avoided when not) → score HIGH (0.7-1.0)

3. **Consider the outcome**:
   - Did the tool usage (or lack thereof) lead to a good answer?
   - A wrong answer without tools when tools were needed = very low score
   - A correct answer with unnecessary tools = medium score

Provide your reasoning, then assign a score from 0.0 to 1.0.`

/**
 * Evaluate tool decision quality
 */
export const evaluateToolDecision = async (trace: ConversationTrace): Promise<EvaluatorResult> => {
  // Build context about tools used
  const toolsUsed =
    trace.toolInvocations.length > 0
      ? trace.toolInvocations.map((t) => `${t.tool}(${JSON.stringify(t.arguments)})`).join(', ')
      : 'None - no tools were used'

  const finalAnswer = trace.finalAnswer || '(No final answer provided)'

  // Format for openevals
  const inputsContent = `QUESTION: ${trace.initialQuery}

TOOLS USED: ${toolsUsed}`

  const outputsContent = `FINAL ANSWER: ${finalAnswer}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: TOOL_DECISION_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'tool_decision',
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
        toolsUsed: trace.toolInvocations.map((t) => t.tool),
        toolCount: trace.toolInvocations.length,
      },
    }
  } catch (error) {
    return {
      score: 0,
      passed: false,
      reasoning: `Tool decision evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}
