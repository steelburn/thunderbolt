/**
 * Tool Execution Evaluator
 *
 * Evaluates how effectively tools were used:
 * - Was the search query well-formed?
 * - Were relevant URLs fetched?
 * - Were tool results properly utilized?
 */

import { createLLMAsJudge } from 'openevals'
import type { ConversationTrace, EvaluatorResult } from '../types'

const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

// Continuous score choices for openevals
const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

const TOOL_EXECUTION_PROMPT = `You are evaluating how effectively an AI assistant used tools to answer a question.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Evaluation Criteria

1. **Search Query Quality** (for web_search):
   - Is the search query specific and relevant to the question?
   - Does it include key terms that would find useful results?
   - Is it too vague or too narrow?

2. **URL Selection** (for fetch_content):
   - Were authoritative/relevant URLs chosen?
   - Did the model avoid low-quality or irrelevant sources?

3. **Tool Result Utilization**:
   - Did the model effectively use the information from tool results?
   - Were key facts from the results incorporated into the answer?
   - Did it ignore relevant information from tool results?

4. **Efficiency**:
   - Were there redundant tool calls?
   - Could fewer tool calls have achieved the same result?

Provide your reasoning, then assign a score from 0.0 to 1.0:
- 0.0-0.3: Poor tool usage (bad queries, irrelevant results, wasted calls)
- 0.4-0.6: Acceptable (some issues but mostly effective)
- 0.7-0.9: Good (effective queries, good utilization)
- 1.0: Excellent (optimal tool usage)`

/**
 * Format tool invocations for the evaluator
 */
const formatToolDetails = (trace: ConversationTrace): string => {
  if (trace.toolInvocations.length === 0) {
    return 'No tools were invoked.'
  }

  return trace.toolInvocations
    .map((t, i) => {
      const args = Object.entries(t.arguments)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ')

      const resultPreview = t.result.length > 500 ? t.result.slice(0, 500) + '... [truncated]' : t.result

      return `${i + 1}. ${t.tool}(${args})
   Result: ${resultPreview}
   ${t.error ? `Error: ${t.error}` : ''}`
    })
    .join('\n\n')
}

/**
 * Evaluate tool execution quality
 */
export const evaluateToolExecution = async (trace: ConversationTrace): Promise<EvaluatorResult | null> => {
  // Skip if no tools were used
  if (trace.toolInvocations.length === 0) {
    return null // N/A - no tools to evaluate
  }

  const toolDetails = formatToolDetails(trace)
  const finalAnswer = trace.finalAnswer || '(No final answer provided)'

  // Format for openevals
  const inputsContent = `QUESTION: ${trace.initialQuery}

TOOL INVOCATIONS:
${toolDetails}`

  const outputsContent = `FINAL ANSWER: ${finalAnswer}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: TOOL_EXECUTION_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'tool_execution',
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
        toolCount: trace.toolInvocations.length,
        tools: trace.toolInvocations.map((t) => ({
          name: t.tool,
          hasError: !!t.error,
          latencyMs: t.latencyMs,
        })),
      },
    }
  } catch (error) {
    return {
      score: 0,
      passed: false,
      reasoning: `Tool execution evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}
