/**
 * Faithfulness to Tool Results Evaluator
 *
 * Evaluates whether the model's answer accurately reflects what the tools returned.
 * Catches cases where the model searches correctly but ignores or misinterprets results.
 */

import { createLLMAsJudge } from 'openevals'
import type { ConversationTrace, EvaluatorResult } from '../types'

const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

const FAITHFULNESS_PROMPT = `You are evaluating whether an AI assistant's answer is FAITHFUL to the tool results it received.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Evaluation Criteria

1. **Accuracy**: Does the answer accurately represent information from the tool results?
   - Are facts, numbers, and names correct?
   - Are quotes or paraphrases accurate?

2. **Completeness**: Does the answer include the key information from the tools?
   - Are important findings from tool results mentioned?
   - Is any critical information omitted?

3. **No Fabrication**: Does the answer avoid adding information NOT in the tool results?
   - Are all claims supported by the tool results?
   - Does it avoid "filling in gaps" with made-up details?

4. **Correct Attribution**: If sources are mentioned, are they correctly attributed?

## Scoring Guide
- 0.0-0.3: Major faithfulness issues (ignores tools, adds unsupported claims)
- 0.4-0.6: Partial faithfulness (some accurate, some issues)
- 0.7-0.9: Mostly faithful (accurate with minor issues)
- 1.0: Perfectly faithful (all claims supported by tool results)

Provide your reasoning, then assign a score.`

/**
 * Format tool results for the evaluator
 */
const formatToolResults = (trace: ConversationTrace): string => {
  if (trace.toolInvocations.length === 0) {
    return 'NO TOOLS WERE USED'
  }

  return trace.toolInvocations
    .map((t, i) => {
      const resultPreview = t.result.length > 1000 ? t.result.slice(0, 1000) + '... [truncated]' : t.result

      return `=== Tool ${i + 1}: ${t.tool} ===
Arguments: ${JSON.stringify(t.arguments)}
Result:
${resultPreview}`
    })
    .join('\n\n')
}

/**
 * Evaluate faithfulness to tool results
 */
export const evaluateFaithfulness = async (trace: ConversationTrace): Promise<EvaluatorResult | null> => {
  // Skip if no tools were used - faithfulness doesn't apply
  if (trace.toolInvocations.length === 0) {
    return null
  }

  const toolResults = formatToolResults(trace)
  const finalAnswer = trace.finalAnswer || ''

  if (!finalAnswer.trim()) {
    return {
      score: 0,
      passed: false,
      reasoning: 'No final answer provided - cannot evaluate faithfulness',
      metadata: { hasAnswer: false },
    }
  }

  const inputsContent = `QUESTION: ${trace.initialQuery}

TOOL RESULTS PROVIDED TO THE AI:
${toolResults}`

  const outputsContent = `AI'S FINAL ANSWER:
${finalAnswer}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: FAITHFULNESS_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'faithfulness',
      choices: SCORE_CHOICES,
    })

    const result = await evaluator({
      inputs: inputsContent,
      outputs: outputsContent,
    })

    let score: number
    if (typeof result.score === 'number') {
      score = result.score
    } else if (typeof result.score === 'boolean') {
      score = result.score ? 1.0 : 0.0
    } else {
      score = 0
    }

    return {
      score,
      passed: score >= 0.7,
      reasoning: String(result.comment || 'No reasoning provided'),
      metadata: {
        toolCount: trace.toolInvocations.length,
        answerLength: finalAnswer.length,
      },
    }
  } catch (error) {
    return {
      score: 0,
      passed: false,
      reasoning: `Faithfulness evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}
