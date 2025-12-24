/**
 * Instruction Following Evaluator
 *
 * Evaluates whether the model follows specific system prompt instructions.
 * This checks behavioral compliance with rules like "don't use tables",
 * "always cite sources", "search before answering", etc.
 */

import { createLLMAsJudge } from 'openevals'
import type { ConversationTrace, EvaluatorResult } from '../types'

const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

// Thunderbolt's key system prompt instructions
const SYSTEM_INSTRUCTIONS = [
  {
    id: 'search_first',
    rule: 'For queries requiring current/real-time information, search the web FIRST before answering',
    check: 'Did the model search when the question required current information?',
  },
  {
    id: 'no_tables',
    rule: 'Avoid using markdown tables in responses unless explicitly requested',
    check: 'Did the model avoid using tables (or were tables explicitly requested)?',
  },
  {
    id: 'cite_sources',
    rule: 'When using information from web searches, cite or reference where the information came from',
    check: 'Did the model indicate where information came from when using tool results?',
  },
  {
    id: 'concise',
    rule: 'Be concise and direct. Avoid unnecessary preambles or verbose explanations',
    check: 'Was the response appropriately concise without unnecessary filler?',
  },
  {
    id: 'honest_uncertainty',
    rule: 'If unsure about something, acknowledge uncertainty rather than guessing',
    check: 'Did the model acknowledge uncertainty appropriately rather than guessing?',
  },
]

const INSTRUCTION_FOLLOWING_PROMPT = `You are evaluating whether an AI assistant followed its system instructions.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Instructions the AI Should Follow

${SYSTEM_INSTRUCTIONS.map(
  (inst, i) => `${i + 1}. **${inst.id}**: ${inst.rule}
   Check: ${inst.check}`,
).join('\n\n')}

## Evaluation Process

For each instruction:
1. Determine if the instruction was APPLICABLE to this query
2. If applicable, check if it was FOLLOWED
3. Note any clear violations

## Scoring Guide
- 1.0: All applicable instructions followed perfectly
- 0.7-0.9: Most instructions followed, minor issues
- 0.4-0.6: Some instructions followed, some violated
- 0.0-0.3: Major instruction violations

Give more weight to violations of "search_first" and "honest_uncertainty" as these affect answer quality.

Provide reasoning listing which instructions were checked and their status, then assign a score.`

/**
 * Detect if the query requires current information
 */
const requiresCurrentInfo = (query: string): boolean => {
  const indicators = [
    'current',
    'latest',
    'now',
    'today',
    'recent',
    'price',
    'weather',
    'stock',
    'news',
    'version',
    'release',
    'update',
    'ceo',
    'president',
    'leader', // These change
  ]
  const lower = query.toLowerCase()
  return indicators.some((ind) => lower.includes(ind))
}

/**
 * Check if response contains a table
 */
const hasTable = (text: string): boolean => {
  // Markdown table pattern: | col1 | col2 |
  return /\|[^|]+\|[^|]+\|/.test(text)
}

/**
 * Format context for the evaluator
 */
const formatContext = (trace: ConversationTrace): string => {
  const parts: string[] = []

  parts.push(`Query requires current info: ${requiresCurrentInfo(trace.initialQuery) ? 'YES' : 'NO'}`)
  parts.push(`Tools used: ${trace.toolInvocations.map((t) => t.tool).join(', ') || 'None'}`)
  parts.push(`Response contains table: ${hasTable(trace.finalAnswer || '') ? 'YES' : 'NO'}`)

  return parts.join('\n')
}

/**
 * Evaluate instruction following
 */
export const evaluateInstructionFollowing = async (trace: ConversationTrace): Promise<EvaluatorResult> => {
  const finalAnswer = trace.finalAnswer || ''

  if (!finalAnswer.trim()) {
    return {
      score: 0,
      passed: false,
      reasoning: 'No answer provided - cannot evaluate instruction following',
      metadata: { hasAnswer: false },
    }
  }

  const context = formatContext(trace)

  const inputsContent = `QUESTION: ${trace.initialQuery}

CONTEXT:
${context}

TOOL CALLS MADE:
${
  trace.toolInvocations.length > 0
    ? trace.toolInvocations.map((t) => `- ${t.tool}(${JSON.stringify(t.arguments)})`).join('\n')
    : 'None'
}`

  const outputsContent = `AI'S RESPONSE:
${finalAnswer}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: INSTRUCTION_FOLLOWING_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'instruction_following',
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

    // Quick heuristic checks for bonus metadata
    const heuristicChecks = {
      searchedWhenNeeded: requiresCurrentInfo(trace.initialQuery)
        ? trace.toolInvocations.some((t) => t.tool === 'web_search')
        : null, // N/A
      avoidedTables: !hasTable(finalAnswer),
      usedTools: trace.toolInvocations.length > 0,
    }

    return {
      score,
      passed: score >= 0.7,
      reasoning: String(result.comment || 'No reasoning provided'),
      metadata: {
        ...heuristicChecks,
        instructionsChecked: SYSTEM_INSTRUCTIONS.map((i) => i.id),
      },
    }
  } catch (error) {
    return {
      score: 0,
      passed: false,
      reasoning: `Instruction following evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}
