/**
 * Answer Quality Evaluator
 *
 * Evaluates the quality of the final answer:
 * - Is it factually correct?
 * - Does it address the question?
 * - Is it well-structured and clear?
 */

import { createLLMAsJudge } from 'openevals'
import type { ConversationTrace, EvaluatorResult } from '../types'

const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

// Continuous score choices for openevals
const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

const ANSWER_QUALITY_PROMPT = `You are evaluating the quality of an AI assistant's final answer to a question.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Evaluation Criteria

1. **Correctness** (most important):
   - Is the answer factually accurate?
   - Are there any errors or incorrect statements?

2. **Completeness**:
   - Does the answer address what was asked?
   - Is anything important missing?

3. **Clarity**:
   - Is the answer easy to understand?
   - Is it well-organized?

4. **Grounding** (if tool results were used):
   - Does the answer properly use information from tool results?
   - Does it make unsupported claims?

If there is NO final answer (empty), score 0.0.

Provide your reasoning, then assign a score from 0.0 to 1.0:
- 0.0-0.3: Poor (incorrect, incomplete, or unclear)
- 0.4-0.6: Acceptable (mostly correct but has issues)
- 0.7-0.9: Good (correct, complete, and clear)
- 1.0: Excellent (perfect answer)`

/**
 * Format tool results for the evaluator
 */
const formatToolResults = (trace: ConversationTrace): string => {
  if (trace.toolInvocations.length === 0) {
    return 'No tool results (the AI answered from its training data)'
  }

  return trace.toolInvocations
    .map((t, i) => {
      const resultPreview = t.result.length > 800 ? t.result.slice(0, 800) + '... [truncated]' : t.result

      return `Tool ${i + 1} (${t.tool}): ${resultPreview}`
    })
    .join('\n\n')
}

/**
 * Evaluate answer quality
 */
export const evaluateAnswerQuality = async (trace: ConversationTrace): Promise<EvaluatorResult> => {
  const toolResults = formatToolResults(trace)
  const finalAnswer = trace.finalAnswer || ''

  // Check if there's actually an answer to evaluate
  if (!finalAnswer.trim()) {
    return {
      score: 0,
      passed: false,
      reasoning: 'No final answer was provided. The conversation ended with tool calls but no synthesis.',
      metadata: { hasAnswer: false },
    }
  }

  // Format inputs for openevals (using {inputs} and {outputs} placeholders)
  const inputsContent = `QUESTION: ${trace.initialQuery}

TOOL RESULTS:
${toolResults}`

  const outputsContent = `FINAL ANSWER: ${finalAnswer}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: ANSWER_QUALITY_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'answer_quality',
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
        answerLength: finalAnswer.length,
        hadToolResults: trace.toolInvocations.length > 0,
      },
    }
  } catch (error) {
    return {
      score: 0,
      passed: false,
      reasoning: `Answer quality evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}
