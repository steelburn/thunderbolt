/**
 * Confidence Calibration Evaluator
 *
 * Evaluates whether the model expresses appropriate uncertainty when it should.
 * Good calibration means being confident when correct and uncertain when unsure.
 */

import { createLLMAsJudge } from 'openevals'
import type { ConversationTrace, EvaluatorResult } from '../types'

const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

const CONFIDENCE_PROMPT = `You are evaluating whether an AI assistant expresses APPROPRIATE confidence in its answer.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Good Confidence Calibration

1. **Express certainty when warranted**:
   - Clear facts from reliable tool results → confident language
   - Well-established knowledge → confident language
   - Example: "Tim Cook is the CEO of Apple" (verifiable fact)

2. **Express uncertainty when warranted**:
   - Speculation or inference → hedging language
   - Conflicting information → acknowledge uncertainty
   - Rapidly changing information → note potential staleness
   - Example: "The price appears to be around $299, though this may vary"

3. **Appropriate hedging phrases**:
   - "Based on the available information..."
   - "It appears that..." / "It seems..."
   - "As of [date]..."
   - "I'm not certain, but..."

## Bad Confidence Calibration

1. **Overconfident**: 
   - Stating uncertain things as definite facts
   - No hedging when information is ambiguous
   
2. **Underconfident**:
   - Excessive hedging on clear facts
   - "I think Paris is in France" (unnecessary doubt)

3. **Inconsistent**:
   - Sometimes confident, sometimes hedging on similar claims

## Scoring Guide
- 0.0-0.3: Poor calibration (overconfident on uncertain things, or excessively hedging)
- 0.4-0.6: Partial calibration (some issues)
- 0.7-0.9: Good calibration (mostly appropriate confidence)
- 1.0: Excellent calibration (perfect match between confidence and certainty)

Consider the NATURE of the question and information quality when scoring.`

/**
 * Format context for the evaluator
 */
const formatContext = (trace: ConversationTrace): string => {
  const parts: string[] = []

  parts.push(`Question type: ${categorizeQuestion(trace.initialQuery)}`)
  parts.push(`Tools used: ${trace.toolInvocations.length > 0 ? 'Yes' : 'No'}`)

  if (trace.toolInvocations.length > 0) {
    const toolSummary = trace.toolInvocations.map((t) => `- ${t.tool}: ${t.result.slice(0, 200)}...`).join('\n')
    parts.push(`Tool results summary:\n${toolSummary}`)
  }

  return parts.join('\n')
}

/**
 * Categorize the type of question
 */
const categorizeQuestion = (query: string): string => {
  const lower = query.toLowerCase()

  if (lower.includes('current') || lower.includes('latest') || lower.includes('now') || lower.includes('today')) {
    return 'Real-time/current information (requires hedging about freshness)'
  }
  if (lower.includes('opinion') || lower.includes('think') || lower.includes('best')) {
    return 'Opinion/subjective (requires hedging)'
  }
  if (lower.includes('predict') || lower.includes('future') || lower.includes('will')) {
    return 'Prediction (requires strong hedging)'
  }
  if (lower.includes('what is') || lower.includes('who is') || lower.includes('define')) {
    return 'Factual query (confidence appropriate if well-sourced)'
  }
  return 'General query'
}

/**
 * Evaluate confidence calibration
 */
export const evaluateConfidence = async (trace: ConversationTrace): Promise<EvaluatorResult> => {
  const finalAnswer = trace.finalAnswer || ''

  if (!finalAnswer.trim()) {
    return {
      score: 0,
      passed: false,
      reasoning: 'No answer provided - cannot evaluate confidence calibration',
      metadata: { hasAnswer: false },
    }
  }

  const context = formatContext(trace)

  const inputsContent = `QUESTION: ${trace.initialQuery}

CONTEXT:
${context}`

  const outputsContent = `AI'S ANSWER:
${finalAnswer}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: CONFIDENCE_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'confidence',
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
        questionType: categorizeQuestion(trace.initialQuery),
        hadToolResults: trace.toolInvocations.length > 0,
      },
    }
  } catch (error) {
    return {
      score: 0,
      passed: false,
      reasoning: `Confidence calibration evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}
