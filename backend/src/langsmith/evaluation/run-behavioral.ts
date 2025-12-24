#!/usr/bin/env bun
/**
 * Behavioral Evaluation Script
 *
 * Tests HOW the model behaves (not WHAT it answers):
 * - Tool usage patterns
 * - Search-first behavior
 * - Formatting compliance
 * - Response structure
 *
 * Uses rule-based evaluators (fast, no LLM costs)
 *
 * Usage:
 *   bun run eval:behavioral
 *   bun run eval:behavioral --verbose
 */

import { Client } from 'langsmith'
import { evaluate } from 'langsmith/evaluation'
import type { EvaluationResult } from 'langsmith/evaluation'
import { isLangSmithConfigured } from '../client'
import {
  evaluateToolUsage,
  evaluateFormatting,
  evaluateSearchFirst,
  evaluateResponseQuality,
  // New evaluators
  evaluateToolEfficiency,
  evaluateLanguageMatch,
  evaluateErrorRecovery,
  evaluatePersonaConsistency,
  evaluateContextSummarization,
  type CompletionOutput,
} from './evaluators'

const BACKEND_URL = process.env.THUNDERBOLT_BACKEND_URL || 'http://localhost:8000'
const DEFAULT_MODEL = 'mistral-large-3'
const DATASET_NAME = 'thunderbolt-behavioral-eval'

type RunOptions = {
  model?: string
  verbose?: boolean
}

/**
 * Progress tracker for conversation execution
 * Shows clean, non-interleaved output
 */
class ProgressTracker {
  private completed = 0
  private total: number
  private verbose: boolean
  private startTime: number
  private passed = 0
  private failed = 0
  private results: Array<{ name: string; toolCount: number; latencyMs: number; error?: string }> = []

  constructor(total: number, verbose: boolean = false) {
    this.total = total
    this.verbose = verbose
    this.startTime = Date.now()
  }

  logResult(name: string, hasToolCalls: boolean, latencyMs: number, error?: string, toolCount: number = 0): void {
    this.completed++

    const statusIcon = error ? '❌' : '✅'
    if (error) this.failed++
    else this.passed++

    const toolStr = toolCount > 0 ? `🔧${toolCount}` : '   '
    const latencySec = (latencyMs / 1000).toFixed(1)

    // Store for summary
    this.results.push({ name, toolCount, latencyMs, error })

    // Print single line result
    const progress = `[${String(this.completed).padStart(2)}/${this.total}]`
    const nameCol = name.padEnd(40).slice(0, 40)
    console.log(`${progress} ${statusIcon} ${nameCol} ${toolStr}  ${latencySec}s`)

    if (this.verbose && error) {
      console.log(`         └─ Error: ${error}`)
    }
  }

  printSummary(): void {
    const elapsed = (Date.now() - this.startTime) / 1000
    const avgLatency =
      this.results.length > 0 ? this.results.reduce((sum, r) => sum + r.latencyMs, 0) / this.results.length / 1000 : 0
    console.log('')
    console.log('─'.repeat(60))
    console.log(
      `✅ Passed: ${this.passed}  ❌ Failed: ${this.failed}  ⏱ Total: ${elapsed.toFixed(1)}s  Avg: ${avgLatency.toFixed(1)}s/test`,
    )
  }
}

/**
 * Evaluation tracker for LLM-as-judge phase
 * Tracks evaluation scores per evaluator type
 */
class EvaluationTracker {
  private completed = 0
  private total: number
  private headerPrinted = false
  private startTime = 0
  private verbose: boolean
  private scores: Record<string, { scores: number[]; isLLM: boolean }> = {}

  constructor(totalTests: number, evaluatorsPerTest: number, verbose: boolean = false) {
    this.total = totalTests * evaluatorsPerTest
    this.verbose = verbose
  }

  private printHeader(): void {
    if (!this.headerPrinted) {
      this.headerPrinted = true
      this.startTime = Date.now()
      console.log('')
      console.log('─'.repeat(60))
      console.log('🧠 Running evaluations (📏 heuristic  🤖 LLM judge)...')
      console.log('─'.repeat(60))
    }
  }

  logEvaluation(testName: string, evaluatorName: string, score: number | null, isLLM: boolean): void {
    this.printHeader()
    this.completed++

    // Track scores per evaluator
    if (!this.scores[evaluatorName]) {
      this.scores[evaluatorName] = { scores: [], isLLM }
    }
    if (score !== null) {
      this.scores[evaluatorName].scores.push(score)
    }

    const progress = `[${String(this.completed).padStart(3)}/${this.total}]`
    const scoreStr = score !== null ? `${(score * 100).toFixed(0)}%` : 'N/A'
    const scoreIcon = score === null ? '⚪' : score >= 0.7 ? '🟢' : score >= 0.4 ? '🟡' : '🔴'
    const typeIcon = isLLM ? '🤖' : '📏'

    // Truncate names to fit
    const shortTest = testName.slice(0, 25).padEnd(25)
    const shortEval = evaluatorName.padEnd(18)

    if (this.verbose) {
      console.log(`${progress} ${typeIcon} ${shortTest} ${shortEval} ${scoreIcon} ${scoreStr}`)
    }
  }

  printSummary(): void {
    if (!this.headerPrinted) return

    const elapsed = (Date.now() - this.startTime) / 1000

    // Print per-evaluator averages
    console.log('')
    console.log('📊 Scores by Evaluator:')
    console.log('')

    // Group by type
    const heuristic = Object.entries(this.scores).filter(([, v]) => !v.isLLM)
    const llmJudge = Object.entries(this.scores).filter(([, v]) => v.isLLM)

    const printGroup = (entries: [string, { scores: number[] }][]) => {
      for (const [name, data] of entries) {
        if (data.scores.length === 0) continue
        const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length
        const avgPercent = (avg * 100).toFixed(0)
        const icon = avg >= 0.7 ? '🟢' : avg >= 0.4 ? '🟡' : '🔴'
        console.log(`   ${icon} ${name.padEnd(20)} ${avgPercent}%`)
      }
    }

    if (heuristic.length > 0) {
      console.log('   📏 Heuristic:')
      printGroup(heuristic)
    }

    if (llmJudge.length > 0) {
      console.log('   🤖 LLM Judge:')
      printGroup(llmJudge)
    }

    console.log('')
    console.log('─'.repeat(60))
    console.log(`✅ Evaluated ${this.completed} criteria in ${elapsed.toFixed(1)}s`)
  }
}

// Global evaluation tracker
let evalTracker: EvaluationTracker | null = null

/**
 * Call the inference API and collect the response
 */
const runInference = async (
  messages: Array<{ role: string; content: string }>,
  model: string,
): Promise<CompletionOutput> => {
  const response = await fetch(`${BACKEND_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
      tools: [
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web for information',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string', description: 'Search query' } },
              required: ['query'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'fetch_content',
            description: 'Fetch content from a URL',
            parameters: {
              type: 'object',
              properties: { url: { type: 'string', description: 'URL to fetch' } },
              required: ['url'],
            },
          },
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Inference failed: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  const lines = text.split('\n').filter((line) => line.startsWith('data: '))

  let content = ''
  const toolCalls: CompletionOutput['toolCalls'] = []
  const toolCallsInProgress: Map<number, { name: string; arguments: string }> = new Map()
  let finishReason: string | undefined

  for (const line of lines) {
    const data = line.slice(6)
    if (data === '[DONE]') break

    try {
      const chunk = JSON.parse(data)
      const choice = chunk.choices?.[0]

      if (choice?.delta?.content) content += choice.delta.content

      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          let existing = toolCallsInProgress.get(tc.index)
          if (!existing) {
            existing = { name: '', arguments: '' }
            toolCallsInProgress.set(tc.index, existing)
          }
          if (tc.function?.name) existing.name = tc.function.name
          if (tc.function?.arguments) existing.arguments += tc.function.arguments
        }
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason
    } catch {
      // Skip malformed chunks
    }
  }

  for (const tc of toolCallsInProgress.values()) {
    if (tc.name) toolCalls.push(tc)
  }

  return { content, toolCalls, finishReason }
}

/**
 * Main evaluation function
 */
const runBehavioralEvaluation = async (options: RunOptions = {}) => {
  const { model = DEFAULT_MODEL, verbose = false } = options

  console.log('🔬 Behavioral Evaluation')
  console.log('========================')
  console.log(`Backend: ${BACKEND_URL}`)
  console.log(`Model: ${model}`)
  console.log(`Dataset: ${DATASET_NAME}`)

  if (!isLangSmithConfigured()) {
    console.error('\n❌ LangSmith not configured.')
    console.error('   Set LANGSMITH_API_KEY and LANGSMITH_TRACING_ENABLED=true in .env')
    process.exit(1)
  }

  const client = new Client()

  // Check dataset exists and count examples
  let totalCases = 0
  try {
    const dataset = await client.readDataset({ datasetName: DATASET_NAME })
    // Count examples
    const examples = client.listExamples({ datasetId: dataset.id })
    for await (const _ of examples) {
      totalCases++
    }
    console.log(`   Test cases: ${totalCases}`)
  } catch {
    console.error(`\n❌ Dataset "${DATASET_NAME}" not found.`)
    console.error('   Run: bun run eval:sync')
    process.exit(1)
  }

  // Create progress tracker
  const tracker = new ProgressTracker(totalCases, verbose)

  // Create evaluation tracker (9 evaluators: 6 heuristic + 3 LLM judge)
  evalTracker = new EvaluationTracker(totalCases, 9, verbose)

  // Target function
  const target = async (inputs: Record<string, any>): Promise<Record<string, any>> => {
    const testName = inputs.test_case_name || inputs.test_case_id || 'Unknown'
    const startMs = Date.now()

    try {
      const messages = inputs.messages || [{ role: 'user', content: inputs.question }]
      const output = await runInference(messages, model)

      const toolCount = output.toolCalls.length
      tracker.logResult(testName, toolCount > 0, Date.now() - startMs, undefined, toolCount)

      return {
        answer: output.content,
        tool_calls: output.toolCalls,
        finish_reason: output.finishReason,
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error'
      tracker.logResult(testName, false, Date.now() - startMs, error, 0)
      throw e
    }
  }

  // Rule-based evaluators
  const toolUsageEvaluator = ({
    outputs,
    referenceOutputs,
    inputs,
  }: {
    outputs: Record<string, any>
    referenceOutputs?: Record<string, any>
    inputs?: Record<string, any>
  }): EvaluationResult => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const expected = referenceOutputs?.expected_behavior || {}
    const result = evaluateToolUsage(completionOutput, expected)
    evalTracker?.logEvaluation(testName, 'tool_usage', result.score, false)
    return { key: 'tool_usage', score: result.score, comment: result.reason }
  }

  const formattingEvaluator = ({
    outputs,
    referenceOutputs,
    inputs,
  }: {
    outputs: Record<string, any>
    referenceOutputs?: Record<string, any>
    inputs?: Record<string, any>
  }): EvaluationResult => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const expected = referenceOutputs?.expected_behavior || {}
    const result = evaluateFormatting(completionOutput, expected)
    evalTracker?.logEvaluation(testName, 'formatting', result.score, false)
    return { key: 'formatting', score: result.score, comment: result.reason }
  }

  const searchFirstEvaluator = ({
    outputs,
    referenceOutputs,
    inputs,
  }: {
    outputs: Record<string, any>
    referenceOutputs?: Record<string, any>
    inputs?: Record<string, any>
  }): EvaluationResult => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const expected = referenceOutputs?.expected_behavior || {}
    const result = evaluateSearchFirst(completionOutput, expected)
    evalTracker?.logEvaluation(testName, 'search_first', result.score, false)
    return { key: 'search_first', score: result.score, comment: result.reason }
  }

  const responseQualityEvaluator = ({
    outputs,
    inputs,
  }: {
    outputs: Record<string, any>
    inputs?: Record<string, any>
  }): EvaluationResult => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const result = evaluateResponseQuality(completionOutput)
    evalTracker?.logEvaluation(testName, 'response_quality', result.score, false)
    return { key: 'response_quality', score: result.score, comment: result.reason }
  }

  // New heuristic evaluators
  const toolEfficiencyEvaluator = ({
    outputs,
    inputs,
  }: {
    outputs: Record<string, any>
    inputs?: Record<string, any>
  }): EvaluationResult => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const result = evaluateToolEfficiency(completionOutput)
    evalTracker?.logEvaluation(testName, 'tool_efficiency', result.score, false)
    return { key: 'tool_efficiency', score: result.score, comment: result.reason }
  }

  const languageMatchEvaluator = ({
    outputs,
    inputs,
  }: {
    outputs: Record<string, any>
    inputs?: Record<string, any>
  }): EvaluationResult => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const query = inputs?.question || inputs?.messages?.[0]?.content || ''
    const result = evaluateLanguageMatch(completionOutput, query)
    evalTracker?.logEvaluation(testName, 'language_match', result.score, false)
    return { key: 'language_match', score: result.score, comment: result.reason }
  }

  // New LLM-as-judge evaluators
  const errorRecoveryEvaluator = async ({
    outputs,
    inputs,
  }: {
    outputs: Record<string, any>
    inputs?: Record<string, any>
  }): Promise<EvaluationResult> => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const query = inputs?.question || inputs?.messages?.[0]?.content || ''
    const result = await evaluateErrorRecovery(completionOutput, query)
    evalTracker?.logEvaluation(testName, 'error_recovery', result.score, true)
    return { key: 'error_recovery', score: result.score, comment: result.reason }
  }

  const personaConsistencyEvaluator = async ({
    outputs,
    inputs,
  }: {
    outputs: Record<string, any>
    inputs?: Record<string, any>
  }): Promise<EvaluationResult> => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const query = inputs?.question || inputs?.messages?.[0]?.content || ''
    const result = await evaluatePersonaConsistency(completionOutput, query)
    evalTracker?.logEvaluation(testName, 'persona_consistency', result.score, true)
    return { key: 'persona_consistency', score: result.score, comment: result.reason }
  }

  const contextSummarizationEvaluator = async ({
    outputs,
    inputs,
  }: {
    outputs: Record<string, any>
    inputs?: Record<string, any>
  }): Promise<EvaluationResult> => {
    const completionOutput: CompletionOutput = {
      content: outputs?.answer || '',
      toolCalls: outputs?.tool_calls || [],
    }
    const testName = inputs?.test_case_name || 'Unknown'
    const query = inputs?.question || inputs?.messages?.[0]?.content || ''
    const result = await evaluateContextSummarization(completionOutput, query)
    evalTracker?.logEvaluation(testName, 'context_summarization', result.score, true)
    return { key: 'context_summarization', score: result.score, comment: result.reason }
  }

  // Combine all evaluators: 6 heuristic + 3 LLM judge = 9 total
  const evaluators = [
    // Heuristic (fast, free)
    toolUsageEvaluator,
    formattingEvaluator,
    searchFirstEvaluator,
    responseQualityEvaluator,
    toolEfficiencyEvaluator,
    languageMatchEvaluator,
    // LLM-as-judge (slower, costs API calls)
    errorRecoveryEvaluator,
    personaConsistencyEvaluator,
    contextSummarizationEvaluator,
  ]

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  const experimentName = `behavioral-${model}-${timestamp}`

  console.log(`\n🧪 Experiment: ${experimentName}`)
  console.log(`   Evaluators: ${evaluators.length} (6 heuristic + 3 LLM judge)`)
  console.log(`   Concurrency: 2`)
  console.log('')
  console.log('─'.repeat(60))
  console.log('[##/##] ST  Test Name                                      Tools Time')
  console.log('─'.repeat(60))

  try {
    const results = await evaluate(target, {
      data: DATASET_NAME,
      evaluators,
      experimentPrefix: experimentName,
      maxConcurrency: 2,
    })

    // Print execution summary
    tracker.printSummary()

    // Consume results and calculate scores
    let totalScore = 0
    let scoreCount = 0

    for await (const result of results) {
      for (const evalResult of result.evaluationResults?.results || []) {
        const score = typeof evalResult.score === 'number' ? evalResult.score : 0
        totalScore += score
        scoreCount++
      }
    }

    // Print evaluation tracker summary (per-evaluator breakdown)
    evalTracker?.printSummary()

    // Final summary
    console.log('')
    console.log('═'.repeat(60))
    console.log('📊 OVERALL SCORE')
    console.log('═'.repeat(60))
    if (scoreCount > 0) {
      const avgPercent = (totalScore / scoreCount) * 100
      const scoreIcon = avgPercent >= 70 ? '✅' : avgPercent >= 50 ? '⚠️' : '❌'
      console.log(`${scoreIcon} Average Score: ${avgPercent.toFixed(1)}%`)
    }
    console.log('')
    console.log(`📈 View detailed results in LangSmith:`)
    console.log(`   → Datasets & Testing → ${DATASET_NAME} → Experiments`)
    console.log(`   → Experiment: ${experimentName}`)
  } catch (error) {
    console.error('\n❌ Evaluation failed:', error)
    process.exit(1)
  }
}

// Parse CLI arguments
const args = process.argv.slice(2)
const options: RunOptions = {}

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--model':
      options.model = args[++i]
      break
    case '--verbose':
    case '-v':
      options.verbose = true
      break
    case '--help':
    case '-h':
      console.log(`
Behavioral Evaluation - Tests model behavior patterns

Usage: bun run eval:behavioral [options]

Options:
  --model <name>    Model to use (default: mistral-large-3)
  --verbose, -v     Show detailed output
  --help, -h        Show this help

What it tests (9 evaluators):

  Heuristic (fast, free):
  • Tool usage - Does the model use tools when appropriate?
  • Search-first - Does it search before answering real-time queries?
  • Formatting - Does it avoid tables when not needed?
  • Response quality - Is the response non-empty and reasonable?
  • Tool efficiency - Does it use 1-5 tool calls (not excessive)?
  • Language match - Does it respond in the user's language?

  LLM-as-Judge (Claude):
  • Error recovery - Does it handle tool failures gracefully?
  • Persona consistency - Does it maintain executive assistant tone?
  • Context summarization - Does it summarize tool results well?

Prerequisites:
  1. Set LANGSMITH_API_KEY in .env
  2. Set ANTHROPIC_API_KEY in .env (for LLM judges)
  3. Run: bun run eval:sync
`)
      process.exit(0)
  }
}

runBehavioralEvaluation(options)
