/**
 * Evaluator functions for assessing model outputs
 *
 * These evaluators check:
 * - Tool invocation accuracy
 * - Response formatting compliance
 * - Response quality metrics
 * - Tool efficiency
 * - Language matching
 * - Error recovery
 * - Persona consistency
 * - Context summarization
 */

import { createLLMAsJudge } from 'openevals'
import type { BehavioralCase } from './behavioral-datasets'

export type EvaluationResult = {
  score: number // 0.0 to 1.0
  passed: boolean
  reason: string
  metadata?: Record<string, unknown>
}

export type CompletionOutput = {
  content: string
  toolCalls: Array<{ name: string; arguments: string }>
  finishReason?: string
}

// For LLM-as-judge evaluators
const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

const SCORE_CHOICES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

/**
 * Evaluate tool invocation accuracy
 * Checks if tools were used when expected and avoided when not needed
 */
export const evaluateToolUsage = (
  output: CompletionOutput,
  expected: BehavioralCase['expectedBehavior'],
): EvaluationResult => {
  const toolCount = output.toolCalls.length
  const usedTools = toolCount > 0

  // Check if tool usage matches expectation
  if (expected.shouldUseTools && !usedTools) {
    return {
      score: 0,
      passed: false,
      reason: 'Expected tools to be used but none were called',
      metadata: { toolCount, expectedTools: true },
    }
  }

  if (!expected.shouldUseTools && usedTools) {
    return {
      score: 0.3, // Partial credit - tools were used unnecessarily
      passed: false,
      reason: `Tools were used (${toolCount}) when not expected`,
      metadata: { toolCount, expectedTools: false },
    }
  }

  // Check tool count bounds if specified
  if (expected.expectedToolCount) {
    const { min, max } = expected.expectedToolCount
    if (min !== undefined && toolCount < min) {
      return {
        score: 0.5,
        passed: false,
        reason: `Too few tool calls: ${toolCount} < ${min}`,
        metadata: { toolCount, min, max },
      }
    }
    if (max !== undefined && toolCount > max) {
      return {
        score: 0.7, // Minor penalty for over-calling
        passed: false,
        reason: `Too many tool calls: ${toolCount} > ${max}`,
        metadata: { toolCount, min, max },
      }
    }
  }

  return {
    score: 1.0,
    passed: true,
    reason: 'Tool usage matches expectations',
    metadata: { toolCount, usedTools },
  }
}

/**
 * Evaluate response formatting
 * Checks table usage, markdown compliance, etc.
 */
export const evaluateFormatting = (
  output: CompletionOutput,
  expected: BehavioralCase['expectedBehavior'],
): EvaluationResult => {
  const content = output.content

  // Check for table usage
  const hasTable = /\|.*\|.*\|/m.test(content) && content.includes('---')

  if (expected.shouldAvoidTables && hasTable) {
    return {
      score: 0.5,
      passed: false,
      reason: 'Response contains a table when tables should be avoided',
      metadata: { hasTable, shouldAvoidTables: true },
    }
  }

  // Check response length if specified
  if (expected.maxResponseLength !== undefined) {
    if (content.length > expected.maxResponseLength) {
      const overagePercent = ((content.length - expected.maxResponseLength) / expected.maxResponseLength) * 100
      return {
        score: Math.max(0, 1 - overagePercent / 100),
        passed: false,
        reason: `Response too long: ${content.length} > ${expected.maxResponseLength} (${overagePercent.toFixed(0)}% over)`,
        metadata: { length: content.length, maxLength: expected.maxResponseLength },
      }
    }
  }

  return {
    score: 1.0,
    passed: true,
    reason: 'Formatting meets expectations',
    metadata: { hasTable, length: content.length },
  }
}

/**
 * Evaluate search-first behavior
 * Checks if search tools were called before generating factual content
 */
export const evaluateSearchFirst = (
  output: CompletionOutput,
  expected: BehavioralCase['expectedBehavior'],
): EvaluationResult => {
  if (!expected.shouldBeSearchFirst) {
    return {
      score: 1.0,
      passed: true,
      reason: 'Search-first not required for this case',
    }
  }

  const searchTools = output.toolCalls.filter(
    (tc) =>
      tc.name.includes('search') || tc.name.includes('web') || tc.name.includes('fetch') || tc.name.includes('browse'),
  )

  if (searchTools.length === 0) {
    return {
      score: 0,
      passed: false,
      reason: 'Expected search-first behavior but no search tools were called',
      metadata: { searchToolCount: 0, allToolCalls: output.toolCalls.map((tc) => tc.name) },
    }
  }

  return {
    score: 1.0,
    passed: true,
    reason: `Search-first behavior confirmed (${searchTools.length} search calls)`,
    metadata: { searchToolCount: searchTools.length, searchTools: searchTools.map((tc) => tc.name) },
  }
}

/**
 * Evaluate response quality (basic heuristics)
 */
export const evaluateResponseQuality = (output: CompletionOutput): EvaluationResult => {
  const content = output.content

  // Check for empty response
  if (!content || content.trim().length === 0) {
    return {
      score: 0,
      passed: false,
      reason: 'Response is empty',
    }
  }

  // Check for common error patterns
  const errorPatterns = [/i don't have access/i, /i cannot browse/i, /as an ai/i, /i don't have the ability/i]

  for (const pattern of errorPatterns) {
    if (pattern.test(content)) {
      return {
        score: 0.3,
        passed: false,
        reason: 'Response contains capability limitation language',
        metadata: { pattern: pattern.toString() },
      }
    }
  }

  // Basic quality heuristics
  const hasSubstance = content.length > 50
  const notJustApology = !/^(i'm sorry|i apologize|unfortunately)/i.test(content.trim())

  if (!hasSubstance) {
    return {
      score: 0.5,
      passed: false,
      reason: 'Response lacks substance (too short)',
      metadata: { length: content.length },
    }
  }

  if (!notJustApology) {
    return {
      score: 0.4,
      passed: false,
      reason: 'Response starts with apology/limitation',
    }
  }

  return {
    score: 1.0,
    passed: true,
    reason: 'Response quality acceptable',
    metadata: { length: content.length },
  }
}

// ============================================================================
// NEW HEURISTIC EVALUATORS
// ============================================================================

/**
 * Evaluate tool efficiency
 * Checks if the model uses an appropriate number of tool calls (target: 3-5)
 */
export const evaluateToolEfficiency = (output: CompletionOutput): EvaluationResult => {
  const toolCount = output.toolCalls.length

  // No tools used - could be appropriate or not, give neutral score
  if (toolCount === 0) {
    return {
      score: 1.0,
      passed: true,
      reason: 'No tools used (may be appropriate for this query)',
      metadata: { toolCount },
    }
  }

  // Ideal range: 1-5 tool calls
  if (toolCount >= 1 && toolCount <= 5) {
    return {
      score: 1.0,
      passed: true,
      reason: `Efficient tool usage: ${toolCount} calls (within 1-5 target)`,
      metadata: { toolCount, target: '1-5' },
    }
  }

  // Slightly over: 6-8 calls
  if (toolCount <= 8) {
    return {
      score: 0.7,
      passed: true,
      reason: `Acceptable tool usage: ${toolCount} calls (slightly over 5 target)`,
      metadata: { toolCount, target: '1-5' },
    }
  }

  // Too many: 9+ calls
  const penalty = Math.min(0.5, (toolCount - 8) * 0.1)
  return {
    score: Math.max(0.2, 0.7 - penalty),
    passed: false,
    reason: `Excessive tool usage: ${toolCount} calls (target is 1-5)`,
    metadata: { toolCount, target: '1-5' },
  }
}

/**
 * Simple language detection based on character patterns
 */
const detectLanguage = (text: string): string => {
  // Remove code blocks and URLs for cleaner detection
  const cleanText = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim()

  if (!cleanText) return 'unknown'

  // Check for CJK characters (Chinese, Japanese, Korean)
  if (/[\u4e00-\u9fff]/.test(cleanText)) return 'chinese'
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(cleanText)) return 'japanese'
  if (/[\uac00-\ud7af]/.test(cleanText)) return 'korean'

  // Check for Cyrillic (Russian, etc.)
  if (/[\u0400-\u04ff]/.test(cleanText)) return 'cyrillic'

  // Check for Arabic
  if (/[\u0600-\u06ff]/.test(cleanText)) return 'arabic'

  // Check for Hebrew
  if (/[\u0590-\u05ff]/.test(cleanText)) return 'hebrew'

  // Check for common Spanish/Portuguese/French accented characters
  const latinExtended = (cleanText.match(/[àáâãäåèéêëìíîïòóôõöùúûüñçßæœ]/gi) || []).length
  const totalChars = cleanText.replace(/\s/g, '').length

  if (latinExtended / totalChars > 0.02) {
    // More than 2% accented chars suggests non-English
    if (/[ñ¿¡]/i.test(cleanText)) return 'spanish'
    if (/[ç]/.test(cleanText) && /[ão]/i.test(cleanText)) return 'portuguese'
    if (/[œæ]/i.test(cleanText)) return 'french'
    return 'romance' // Generic romance language
  }

  // Default to English
  return 'english'
}

/**
 * Evaluate language match
 * Checks if response is in the same language as the query
 */
export const evaluateLanguageMatch = (output: CompletionOutput, query: string): EvaluationResult => {
  const queryLang = detectLanguage(query)
  const responseLang = detectLanguage(output.content)

  // If we can't detect, give benefit of doubt
  if (queryLang === 'unknown' || responseLang === 'unknown') {
    return {
      score: 1.0,
      passed: true,
      reason: 'Language detection inconclusive',
      metadata: { queryLang, responseLang },
    }
  }

  // English query can get English response (most common case)
  if (queryLang === 'english' && responseLang === 'english') {
    return {
      score: 1.0,
      passed: true,
      reason: 'Response language matches query (English)',
      metadata: { queryLang, responseLang },
    }
  }

  // Non-English query should get same language response
  if (queryLang === responseLang) {
    return {
      score: 1.0,
      passed: true,
      reason: `Response language matches query (${queryLang})`,
      metadata: { queryLang, responseLang },
    }
  }

  // Mismatch - non-English query got English response
  if (queryLang !== 'english' && responseLang === 'english') {
    return {
      score: 0.3,
      passed: false,
      reason: `Language mismatch: query in ${queryLang}, response in English`,
      metadata: { queryLang, responseLang },
    }
  }

  // Other mismatches
  return {
    score: 0.5,
    passed: false,
    reason: `Language mismatch: query in ${queryLang}, response in ${responseLang}`,
    metadata: { queryLang, responseLang },
  }
}

// ============================================================================
// NEW LLM-AS-JUDGE EVALUATORS
// ============================================================================

const ERROR_RECOVERY_PROMPT = `You are evaluating how an AI assistant handles tool failures or errors.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Evaluation Criteria

1. **Error Detection**: Did the assistant acknowledge when a tool failed?
2. **Graceful Degradation**: Did it provide a helpful response despite the error?
3. **No Hallucination**: Did it avoid making up information to cover for the failure?
4. **User Communication**: Did it clearly communicate limitations to the user?
5. **Alternative Suggestions**: Did it suggest alternatives or next steps?

## Scoring Guide
- 1.0: Excellent error handling (acknowledged, provided alternatives, helpful)
- 0.7-0.9: Good handling (acknowledged error, still provided value)
- 0.4-0.6: Partial handling (some issues but didn't completely fail)
- 0.0-0.3: Poor handling (ignored error, hallucinated, or unhelpful)

If there were NO errors/failures in the interaction, score 1.0.`

/**
 * Evaluate error recovery behavior
 * Uses LLM to assess how well the model handles tool failures
 */
export const evaluateErrorRecovery = async (
  output: CompletionOutput,
  query: string,
  toolResults?: Array<{ tool: string; success: boolean; error?: string }>,
): Promise<EvaluationResult> => {
  // Check if there were any errors to recover from
  const hadErrors = toolResults?.some((r) => !r.success) ?? false

  if (!hadErrors && output.toolCalls.length === 0) {
    return {
      score: 1.0,
      passed: true,
      reason: 'No tool errors to recover from',
      metadata: { hadErrors: false },
    }
  }

  const inputsContent = `USER QUERY: ${query}

TOOL CALLS MADE: ${output.toolCalls.map((tc) => tc.name).join(', ') || 'None'}

TOOL RESULTS: ${
    toolResults
      ? toolResults.map((r) => `${r.tool}: ${r.success ? 'SUCCESS' : `FAILED - ${r.error}`}`).join('\n')
      : 'Results not available'
  }`

  const outputsContent = `ASSISTANT RESPONSE:
${output.content}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: ERROR_RECOVERY_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'error_recovery',
      choices: SCORE_CHOICES,
    })

    const result = await evaluator({
      inputs: inputsContent,
      outputs: outputsContent,
    })

    const score = typeof result.score === 'number' ? result.score : result.score ? 1.0 : 0.0

    return {
      score,
      passed: score >= 0.7,
      reason: String(result.comment || 'No reasoning provided'),
      metadata: { hadErrors, toolCount: output.toolCalls.length },
    }
  } catch (error) {
    return {
      score: 0.5,
      passed: false,
      reason: `Error recovery evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}

const PERSONA_CONSISTENCY_PROMPT = `You are evaluating whether an AI assistant maintains a consistent "executive assistant" persona.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Expected Persona: Executive Assistant

The assistant should:
1. **Professional tone**: Businesslike, efficient, not overly casual
2. **Helpful attitude**: Proactive, solution-oriented
3. **Concise communication**: Direct, not verbose or rambling
4. **Appropriate formality**: Polite but not stiff
5. **No character breaks**: Shouldn't say "As an AI" or break the assistant role

## Red Flags
- Overly casual language ("Hey!", "Wassup", excessive slang)
- Robotic/stiff responses ("I am an AI language model...")
- Excessive apologies or hedging
- Unprofessional tangents
- Character breaks (discussing being an AI)

## Scoring Guide
- 1.0: Perfect executive assistant persona
- 0.7-0.9: Mostly consistent, minor issues
- 0.4-0.6: Some persona inconsistencies
- 0.0-0.3: Significant persona breaks or inappropriate tone`

/**
 * Evaluate persona consistency
 * Uses LLM to assess if the response maintains the executive assistant persona
 */
export const evaluatePersonaConsistency = async (
  output: CompletionOutput,
  query: string,
): Promise<EvaluationResult> => {
  if (!output.content.trim()) {
    return {
      score: 0,
      passed: false,
      reason: 'No content to evaluate persona',
      metadata: { hasContent: false },
    }
  }

  const inputsContent = `USER QUERY: ${query}`
  const outputsContent = `ASSISTANT RESPONSE:
${output.content}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: PERSONA_CONSISTENCY_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'persona_consistency',
      choices: SCORE_CHOICES,
    })

    const result = await evaluator({
      inputs: inputsContent,
      outputs: outputsContent,
    })

    const score = typeof result.score === 'number' ? result.score : result.score ? 1.0 : 0.0

    return {
      score,
      passed: score >= 0.7,
      reason: String(result.comment || 'No reasoning provided'),
      metadata: { responseLength: output.content.length },
    }
  } catch (error) {
    return {
      score: 0.5,
      passed: false,
      reason: `Persona evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}

const CONTEXT_SUMMARIZATION_PROMPT = `You are evaluating how well an AI assistant summarizes and uses information from tool results.

<inputs>
{inputs}
</inputs>

<outputs>
{outputs}
</outputs>

## Evaluation Criteria

1. **Appropriate Length**: Is the summary proportional to the source material?
   - Long tool results should be distilled to key points
   - Short tool results can be relayed more directly

2. **Key Information Preserved**: Are the most important facts included?
   - Main findings should be present
   - Critical details shouldn't be lost

3. **Noise Removed**: Is irrelevant information filtered out?
   - Boilerplate, ads, navigation elements should be excluded
   - Focus on what's relevant to the query

4. **Coherent Synthesis**: Is information from multiple tools combined well?
   - Not just a list of tool outputs
   - Synthesized into a coherent response

## Scoring Guide
- 1.0: Excellent summarization (concise, complete, coherent)
- 0.7-0.9: Good summarization (minor issues)
- 0.4-0.6: Acceptable but could be better
- 0.0-0.3: Poor summarization (too long, missing info, or incoherent)

If no tools were used, evaluate based on response conciseness alone.`

/**
 * Evaluate context summarization
 * Uses LLM to assess how well the model summarizes tool results
 */
export const evaluateContextSummarization = async (
  output: CompletionOutput,
  query: string,
  toolResultsLength?: number,
): Promise<EvaluationResult> => {
  if (!output.content.trim()) {
    return {
      score: 0,
      passed: false,
      reason: 'No content to evaluate summarization',
      metadata: { hasContent: false },
    }
  }

  const inputsContent = `USER QUERY: ${query}

TOOLS USED: ${output.toolCalls.map((tc) => tc.name).join(', ') || 'None'}
APPROXIMATE TOOL RESULTS LENGTH: ${toolResultsLength ? `${toolResultsLength} characters` : 'Unknown'}`

  const outputsContent = `ASSISTANT RESPONSE (${output.content.length} characters):
${output.content}`

  try {
    const evaluator = createLLMAsJudge({
      prompt: CONTEXT_SUMMARIZATION_PROMPT,
      model: getJudgeModel(),
      feedbackKey: 'context_summarization',
      choices: SCORE_CHOICES,
    })

    const result = await evaluator({
      inputs: inputsContent,
      outputs: outputsContent,
    })

    const score = typeof result.score === 'number' ? result.score : result.score ? 1.0 : 0.0

    return {
      score,
      passed: score >= 0.7,
      reason: String(result.comment || 'No reasoning provided'),
      metadata: {
        responseLength: output.content.length,
        toolResultsLength,
        compressionRatio: toolResultsLength ? output.content.length / toolResultsLength : null,
      },
    }
  } catch (error) {
    return {
      score: 0.5,
      passed: false,
      reason: `Summarization evaluation failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}

// ============================================================================
// COMBINED EVALUATOR RUNNERS
// ============================================================================

/**
 * Run all evaluators on a completion output
 */
export const runAllEvaluators = (
  output: CompletionOutput,
  testCase: BehavioralCase,
): Record<string, EvaluationResult> => {
  return {
    toolUsage: evaluateToolUsage(output, testCase.expectedBehavior),
    formatting: evaluateFormatting(output, testCase.expectedBehavior),
    searchFirst: evaluateSearchFirst(output, testCase.expectedBehavior),
    responseQuality: evaluateResponseQuality(output),
  }
}

/**
 * Calculate overall score from individual evaluator results
 */
export const calculateOverallScore = (results: Record<string, EvaluationResult>): number => {
  const scores = Object.values(results).map((r) => r.score)
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

/**
 * Determine if all evaluations passed
 */
export const allEvaluationsPassed = (results: Record<string, EvaluationResult>): boolean => {
  return Object.values(results).every((r) => r.passed)
}
