/**
 * LLM-as-Judge Evaluators
 *
 * Uses LLMs to evaluate response quality with nuanced judgment.
 * Supports both Anthropic and OpenAI models via openevals library.
 *
 * Set LLM_JUDGE_MODEL env var to customize (format: "provider:model-name")
 *
 * ## Anthropic Models (Recommended for evaluation)
 *
 * ### Claude 4.5 Family (Latest - Best for Agents & Coding)
 *   - "anthropic:claude-sonnet-4-5-20250929" (best overall)
 *   - "anthropic:claude-haiku-4-5-20251001"  (fast + extended thinking)
 *
 * ### Claude 4 Family (Most Capable)
 *   - "anthropic:claude-opus-4-1-20250805"  (most capable, expensive)
 *   - "anthropic:claude-opus-4-20250514"
 *   - "anthropic:claude-sonnet-4-20250514"  (high performance)
 *
 * ### Claude 3.5 Family (Good Balance)
 *   - "anthropic:claude-3-5-haiku-20241022" (default - fast & cheap)
 *   - "anthropic:claude-3-7-sonnet-20250219"
 *
 * ### Claude 3 Family (Legacy)
 *   - "anthropic:claude-3-opus-20240229"    (excels at writing)
 *   - "anthropic:claude-3-haiku-20240307"   (previous fast model)
 *
 * ## OpenAI Models
 *   - "openai:gpt-4o"      (most capable)
 *   - "openai:gpt-4o-mini" (cost-effective)
 *   - "openai:gpt-4-turbo"
 *
 * ## Evaluation Accuracy Research
 *
 * For LLM-as-judge tasks, studies show:
 * 1. Claude Sonnet 4.5 - Best for agentic evaluation (tool use, reasoning)
 * 2. Claude Opus 4.1   - Most nuanced judgment, best for complex tasks
 * 3. GPT-4o           - Strong alternative, good at following rubrics
 * 4. Claude Haiku 4.5 - Fast with extended thinking, good cost/accuracy
 *
 * Default (claude-3-5-haiku) is a good balance of speed, cost, and accuracy.
 * For production evaluations, consider claude-sonnet-4-5 or claude-opus-4.
 */

import { createLLMAsJudge } from 'openevals'
import type { EvaluationResult } from './evaluators'

/**
 * Get the model to use for LLM-as-judge
 * Defaults to Claude 3.5 Haiku but can be configured via LLM_JUDGE_MODEL env var
 */
const getJudgeModel = (): string => {
  return process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022'
}

/**
 * Custom prompt for evaluating response correctness (without reference answers)
 * This evaluates whether the response appears factually correct and well-reasoned
 * Note: OpenEvals uses {input} for question and {output} for answer
 */
const CORRECTNESS_PROMPT = `You are evaluating whether an AI assistant's response appears factually correct and well-reasoned.

Consider:
1. Does the response contain obvious factual errors?
2. Are claims supported by reasoning or tool results?
3. Does the response acknowledge uncertainty when appropriate?
4. Is the logic sound and conclusions reasonable?

Note: You don't have access to ground truth, so evaluate based on internal consistency and apparent accuracy.

Question: {input}
Response: {output}

Provide a score from 0 to 1 where:
- 0.0-0.3: Contains clear errors or unsupported claims
- 0.4-0.6: Some concerns about accuracy or reasoning
- 0.7-0.9: Appears accurate with sound reasoning
- 1.0: Highly accurate and well-supported

Return JSON: {{"score": <number>, "reasoning": "<explanation>"}}`

/**
 * Custom prompt for evaluating correctness WITH a reference answer
 */
const CORRECTNESS_WITH_REFERENCE_PROMPT = `You are evaluating whether an AI assistant's response is correct compared to a reference answer.

Question: {input}
AI Response: {output}
Reference Answer: {reference}

Consider:
1. Does the AI response contain the key facts from the reference answer?
2. Are there any factual errors or contradictions with the reference?
3. Is the response complete enough to be useful?

Provide a score from 0 to 1 where:
- 0.0-0.3: Missing key facts or contains errors
- 0.4-0.6: Partially correct, missing some important details
- 0.7-0.9: Mostly correct, captures the essential information
- 1.0: Fully correct and complete

Return JSON: {{"score": <number>, "reasoning": "<explanation>"}}`

/**
 * Custom prompt for evaluating response conciseness
 */
const CONCISENESS_PROMPT = `You are evaluating whether an AI assistant's response is appropriately concise.

The system prompt instructs: "Be succinct—avoid repetition and unnecessary elaboration"

Consider:
1. Does the response directly answer the question without excessive preamble?
2. Is there unnecessary repetition or redundancy?
3. Are there filler phrases that don't add value?
4. Is the length appropriate for the complexity of the question?

Do NOT penalize for:
- Including necessary context or caveats
- Providing complete answers to complex questions

Question: {input}
Response: {output}

Provide a score from 0 to 1 where:
- 0.0-0.3: Very verbose, lots of unnecessary content
- 0.4-0.6: Could be more concise
- 0.7-0.9: Appropriately concise
- 1.0: Perfectly concise

Return JSON: {{"score": <number>, "reasoning": "<explanation>"}}`

/**
 * Custom prompt for evaluating tool usage appropriateness
 */
const TOOL_USAGE_PROMPT = `You are evaluating whether an AI assistant appropriately used tools (like web search) to answer a question.

Consider:
1. Did the question require real-time or current information? (weather, news, stock prices, recent events)
2. Did the question ask about facts that could change over time? (software versions, company leadership, prices)
3. Was the question about general knowledge that doesn't require search? (math, well-known historical facts, coding concepts)

If tools SHOULD have been used but weren't, score LOW.
If tools were used UNNECESSARILY (for questions the AI could answer from training), score MEDIUM.
If tool usage was APPROPRIATE for the question type, score HIGH.

Question: {input}
Response: {output}

Provide a score from 0 to 1 and brief reasoning.
Return JSON: {{"score": <number>, "reasoning": "<explanation>"}}`

/**
 * Custom prompt for evaluating response helpfulness
 */
const HELPFULNESS_PROMPT = `You are evaluating how helpful an AI assistant's response is to the user's question.

Consider:
1. Does the response directly address what the user asked?
2. Is the information provided relevant and useful?
3. Is the response clear and easy to understand?
4. Does it provide actionable information when appropriate?

Do NOT penalize for:
- Being concise (brevity is good)
- Not including unnecessary elaboration

Question: {input}
Response: {output}

Provide a score from 0 to 1 where:
- 0.0-0.3: Not helpful, doesn't address the question
- 0.4-0.6: Partially helpful
- 0.7-0.9: Helpful and addresses the question well
- 1.0: Extremely helpful

Return JSON: {{"score": <number>, "reasoning": "<explanation>"}}`

/**
 * Create the correctness evaluator using OpenEvals
 */
export const createCorrectnessEvaluator = () => {
  return createLLMAsJudge({
    prompt: CORRECTNESS_PROMPT,
    model: getJudgeModel(),
    feedbackKey: 'llm_correctness',
  })
}

/**
 * Create the conciseness evaluator using OpenEvals
 */
export const createConcisenessEvaluator = () => {
  return createLLMAsJudge({
    prompt: CONCISENESS_PROMPT,
    model: getJudgeModel(),
    feedbackKey: 'llm_conciseness',
  })
}

/**
 * Create the tool usage evaluator
 */
export const createToolUsageEvaluator = () => {
  return createLLMAsJudge({
    prompt: TOOL_USAGE_PROMPT,
    model: getJudgeModel(),
    feedbackKey: 'llm_tool_usage',
  })
}

/**
 * Create the helpfulness evaluator
 */
export const createHelpfulnessEvaluator = () => {
  return createLLMAsJudge({
    prompt: HELPFULNESS_PROMPT,
    model: getJudgeModel(),
    feedbackKey: 'llm_helpfulness',
  })
}

/**
 * Export the model getter for logging purposes
 */
export { getJudgeModel }

/**
 * Wrapper to run an OpenEvals LLM judge and convert to our EvaluationResult format
 */
export const runLLMJudge = async (
  evaluator: ReturnType<typeof createLLMAsJudge>,
  question: string,
  answer: string,
  toolCalls?: string,
): Promise<EvaluationResult> => {
  try {
    // OpenEvals expects 'input' (singular) for the question and 'output' for the answer
    // The prompt variables are filled from these top-level keys
    const result = await evaluator({
      input: question,
      output: answer,
      // Additional context passed via inputs object
      inputs: { tool_calls: toolCalls || 'none' },
    })

    // OpenEvals returns { key, score, comment? }
    const score = typeof result.score === 'number' ? result.score : 0
    const comment = result.comment || result.reasoning || 'No reasoning provided'

    return {
      score,
      passed: score >= 0.7, // Consider 70%+ as passing
      reason: String(comment),
      metadata: { evaluator: result.key, rawResult: result },
    }
  } catch (error) {
    console.error('[LLM Judge] Error:', error)
    return {
      score: 0,
      passed: false,
      reason: `LLM judge failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}

/**
 * Create the correctness evaluator with reference answer support
 */
export const createCorrectnessWithReferenceEvaluator = () => {
  return createLLMAsJudge({
    prompt: CORRECTNESS_WITH_REFERENCE_PROMPT,
    model: getJudgeModel(),
    feedbackKey: 'llm_correctness_ref',
  })
}

/**
 * Run LLM judge with optional reference answer
 */
export const runLLMJudgeWithReference = async (
  evaluator: ReturnType<typeof createLLMAsJudge>,
  question: string,
  answer: string,
  referenceAnswer?: string,
  toolCalls?: string,
): Promise<EvaluationResult> => {
  try {
    const result = await evaluator({
      input: question,
      output: answer,
      reference: referenceAnswer || '',
      inputs: { tool_calls: toolCalls || 'none' },
    })

    const score = typeof result.score === 'number' ? result.score : 0
    const comment = result.comment || result.reasoning || 'No reasoning provided'

    return {
      score,
      passed: score >= 0.7,
      reason: String(comment),
      metadata: { evaluator: result.key, rawResult: result },
    }
  } catch (error) {
    console.error('[LLM Judge] Error:', error)
    return {
      score: 0,
      passed: false,
      reason: `LLM judge failed: ${(error as Error).message}`,
      metadata: { error: true },
    }
  }
}

/**
 * Run all LLM-as-judge evaluators on a completion
 * @param referenceAnswer - Optional reference answer for correctness evaluation
 */
export const runAllLLMJudges = async (
  question: string,
  answer: string,
  toolCalls: Array<{ name: string; arguments: string }>,
  referenceAnswer?: string,
): Promise<Record<string, EvaluationResult>> => {
  const toolCallsStr = toolCalls.length > 0 ? JSON.stringify(toolCalls.map((tc) => tc.name)) : 'none'

  // Use reference-aware correctness evaluator if reference is provided
  const correctnessPromise = referenceAnswer
    ? runLLMJudgeWithReference(
        createCorrectnessWithReferenceEvaluator(),
        question,
        answer,
        referenceAnswer,
        toolCallsStr,
      )
    : runLLMJudge(createCorrectnessEvaluator(), question, answer, toolCallsStr)

  // Run evaluators in parallel for speed
  const [correctness, conciseness, helpfulness, toolUsage] = await Promise.all([
    correctnessPromise,
    runLLMJudge(createConcisenessEvaluator(), question, answer, toolCallsStr),
    runLLMJudge(createHelpfulnessEvaluator(), question, answer, toolCallsStr),
    runLLMJudge(createToolUsageEvaluator(), question, answer, toolCallsStr),
  ])

  return {
    llm_correctness: correctness,
    llm_conciseness: conciseness,
    llm_helpfulness: helpfulness,
    llm_tool_usage: toolUsage,
  }
}

/**
 * Configuration for which LLM judges to run
 */
export type LLMJudgeConfig = {
  correctness: boolean
  conciseness: boolean
  helpfulness: boolean
  toolUsage: boolean
}

export const defaultLLMJudgeConfig: LLMJudgeConfig = {
  correctness: true,
  conciseness: true,
  helpfulness: true,
  toolUsage: true,
}

/**
 * Run selected LLM judges based on config
 */
export const runSelectedLLMJudges = async (
  question: string,
  answer: string,
  toolCalls: Array<{ name: string; arguments: string }>,
  config: Partial<LLMJudgeConfig> = {},
): Promise<Record<string, EvaluationResult>> => {
  const finalConfig = { ...defaultLLMJudgeConfig, ...config }
  const toolCallsStr = toolCalls.length > 0 ? JSON.stringify(toolCalls.map((tc) => tc.name)) : 'none'

  const results: Record<string, EvaluationResult> = {}
  const promises: Promise<void>[] = []

  if (finalConfig.correctness) {
    promises.push(
      runLLMJudge(createCorrectnessEvaluator(), question, answer, toolCallsStr).then((r) => {
        results.llm_correctness = r
      }),
    )
  }

  if (finalConfig.conciseness) {
    promises.push(
      runLLMJudge(createConcisenessEvaluator(), question, answer, toolCallsStr).then((r) => {
        results.llm_conciseness = r
      }),
    )
  }

  if (finalConfig.helpfulness) {
    promises.push(
      runLLMJudge(createHelpfulnessEvaluator(), question, answer, toolCallsStr).then((r) => {
        results.llm_helpfulness = r
      }),
    )
  }

  if (finalConfig.toolUsage) {
    promises.push(
      runLLMJudge(createToolUsageEvaluator(), question, answer, toolCallsStr).then((r) => {
        results.llm_tool_usage = r
      }),
    )
  }

  await Promise.all(promises)
  return results
}
