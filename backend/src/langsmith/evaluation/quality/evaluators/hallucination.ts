/**
 * Hallucination Detection Evaluator
 *
 * Detects if the model made up facts that weren't in the tool results
 * or aren't verifiable common knowledge.
 */

import { createLLMAsJudge } from 'openevals'
import type { ConversationTrace, EvaluatorResult } from '../types'

const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

const HALLUCINATION_PROMPT = `You are a hallucination detector. Your job is to identify if the AI assistant made up facts or information that are NOT supported by either:
1. The tool results provided
2. Well-established common knowledge

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Types of Hallucinations to Detect

1. **Fabricated Facts**: Made-up statistics, dates, names, or events
   - Example: "The company was founded in 1987" when no founding date was in the results

2. **Invented Sources**: Citing sources that weren't in the tool results
   - Example: "According to a 2024 study..." when no such study was returned

3. **False Specificity**: Adding specific details that weren't provided
   - Example: Tool says "CEO is John" but answer says "CEO John Smith, age 52"

4. **Confident Guessing**: Presenting uncertain information as fact
   - Example: "The price is $299" when tools showed different/no price

5. **Temporal Confusion**: Mixing up dates, timelines, or versions
   - Example: Using outdated information when tools returned current data

## What is NOT a hallucination
- Reasonable inferences clearly stated as such
- Well-established facts (e.g., "Paris is in France")
- Logical conclusions from the data
- Clarifying context that's obviously true

## Scoring Guide
- 1.0: No hallucinations detected
- 0.7-0.9: Minor issues (slight embellishments, unclear phrasing)
- 0.4-0.6: Moderate hallucinations (some fabricated details)
- 0.0-0.3: Severe hallucinations (significant made-up information)

Provide your reasoning, listing any hallucinations found, then assign a score.`

/**
 * Format tool results for the evaluator
 */
const formatToolResults = (trace: ConversationTrace): string => {
  if (trace.toolInvocations.length === 0) {
    return 'NO TOOLS WERE USED - The AI answered from its training knowledge only'
  }

  return trace.toolInvocations
    .map((t, i) => {
      const resultPreview = t.result.length > 1200 ? t.result.slice(0, 1200) + '... [truncated]' : t.result

      return `=== Tool ${i + 1}: ${t.tool} ===
Arguments: ${JSON.stringify(t.arguments)}
Result:
${resultPreview}`
    })
    .join('\n\n')
}

/**
 * Detect hallucinations in the response
 */
export const evaluateHallucination = async (trace: ConversationTrace): Promise<EvaluatorResult> => {
  const toolResults = formatToolResults(trace)
  const finalAnswer = trace.finalAnswer || ''

  if (!finalAnswer.trim()) {
    return {
      score: 1.0, // No answer = no hallucination
      passed: true,
      reasoning: 'No answer provided - no hallucination possible',
      metadata: { hasAnswer: false },
    }
  }

  const inputsContent = `QUESTION: ${trace.initialQuery}

AVAILABLE INFORMATION (from tools):
${toolResults}`

  const outputsContent = `AI'S ANSWER TO CHECK FOR HALLUCINATIONS:
${finalAnswer}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: HALLUCINATION_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'hallucination',
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
        hadToolResults: trace.toolInvocations.length > 0,
        answerLength: finalAnswer.length,
      },
    }
  } catch (error) {
    return {
      score: 0,
      passed: false,
      reasoning: `Hallucination detection failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}
