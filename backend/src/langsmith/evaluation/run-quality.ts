#!/usr/bin/env bun
/**
 * Quality Evaluation Runner
 *
 * Runs comprehensive quality evaluations with multi-turn conversation execution
 * and real tool calls. Integrates with LangSmith's Datasets & Experiments workflow.
 *
 * Usage:
 *   bun run eval:quality                     # Run with synthetic test cases
 *   bun run eval:quality --production        # Run with production traces
 *   bun run eval:quality --traces id1,id2    # Run with specific trace IDs
 *   bun run eval:quality --model gpt-oss-120b # Use a specific model
 *   bun run eval:quality --verbose           # Show detailed output
 */

// Enable LangSmith tracing before any imports
process.env.LANGSMITH_TRACING = 'true'

import { Client } from 'langsmith'
import { evaluate } from 'langsmith/evaluation'
import { isLangSmithConfigured, getLangSmithProject } from '../client'
import { allQualityCases, type QualityCase } from './quality-datasets'
import {
  executeConversation,
  sampleProductionTraces,
  evaluateToolDecision,
  evaluateToolExecution,
  evaluateAnswerQuality,
  evaluateJourney,
  evaluateJourneyHeuristic,
  // New evaluators
  evaluateFaithfulness,
  evaluateHallucination,
  evaluateLatency,
  evaluateTokenEfficiency,
  evaluateConfidence,
  evaluateInstructionFollowing,
  type ConversationTrace,
  type ExecutorConfig,
} from './quality'

// Configuration from environment
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'
const DEFAULT_MODEL = process.env.EVAL_MODEL || 'mistral-large-3'
const DATASET_NAME = 'thunderbolt-quality-eval'

// Evaluation settings
const MAX_TURNS = 5
const TIMEOUT_MS = 60000 // 60 seconds
const MAX_CONCURRENT = 2

type RunOptions = {
  model?: string
  production?: boolean
  traceIds?: string[]
  hours?: number
  maxTraces?: number
  verbose?: boolean
  syncDataset?: boolean
  useLLMJudge?: boolean
}

/**
 * Parse command line arguments
 */
const parseArgs = (): RunOptions => {
  const args = process.argv.slice(2)
  const options: RunOptions = { useLLMJudge: true }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--production' || arg === '-p') {
      options.production = true
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true
    } else if (arg === '--sync') {
      options.syncDataset = true
    } else if (arg === '--no-llm-judge') {
      options.useLLMJudge = false
    } else if (arg === '--model' || arg === '-m') {
      options.model = args[++i]
    } else if (arg === '--traces' || arg === '-t') {
      options.traceIds = args[++i]?.split(',').map((s) => s.trim())
    } else if (arg === '--hours' || arg === '-h') {
      options.hours = parseInt(args[++i])
    } else if (arg === '--max') {
      options.maxTraces = parseInt(args[++i])
    }
  }

  return options
}

/**
 * Sync test cases to LangSmith dataset
 */
const syncToLangSmith = async (cases: QualityCase[]): Promise<string> => {
  const client = new Client()

  // Check if dataset exists, create if not
  let dataset
  try {
    dataset = await client.readDataset({ datasetName: DATASET_NAME })
    console.log(`📚 Found existing dataset: ${DATASET_NAME}`)

    // Clear existing examples
    console.log('   Clearing existing examples...')
    const existingExamples = client.listExamples({ datasetId: dataset.id })
    const exampleIds: string[] = []
    for await (const example of existingExamples) {
      exampleIds.push(example.id)
    }
    if (exampleIds.length > 0) {
      await client.deleteExamples(exampleIds)
      console.log(`   Deleted ${exampleIds.length} existing examples`)
    }
  } catch {
    dataset = await client.createDataset(DATASET_NAME, {
      description: 'Thunderbolt quality evaluation - multi-turn conversations with tool execution',
    })
    console.log(`📚 Created new dataset: ${DATASET_NAME}`)
  }

  // Add examples
  const inputs: Record<string, unknown>[] = []
  const outputs: Record<string, unknown>[] = []
  const metadata: Record<string, unknown>[] = []

  for (const testCase of cases) {
    const userMessage = testCase.messages.find((m) => m.role === 'user')
    if (!userMessage) continue

    inputs.push({
      question: userMessage.content,
      test_case_id: testCase.id,
      test_case_name: testCase.name,
    })

    outputs.push({
      reference_answer: testCase.referenceAnswer,
      required_facts: testCase.evaluationCriteria.requiredFacts || [],
    })

    metadata.push({
      id: testCase.id,
      name: testCase.name,
      category: testCase.category,
      tags: testCase.tags,
      requires_current_info: testCase.evaluationCriteria.requiresCurrentInfo,
    })
  }

  await client.createExamples({
    datasetId: dataset.id,
    inputs,
    outputs,
    metadata,
  })

  console.log(`✅ Synced ${cases.length} test cases to LangSmith`)
  return dataset.id
}

/**
 * Progress tracker for concurrent execution
 * Shows clean, non-interleaved output
 */
class ProgressTracker {
  private completed = 0
  private total: number
  private verbose: boolean
  private startTime: number
  private results: Array<{
    name: string
    status: string
    turns: number
    tools: number
    latency: number
    error?: string
  }> = []

  constructor(total: number, verbose: boolean = false) {
    this.total = total
    this.verbose = verbose
    this.startTime = Date.now()
  }

  logResult(trace: ConversationTrace): void {
    this.completed++

    const name = trace.metadata?.testCaseName || trace.initialQuery.slice(0, 35)
    const statusIcon = trace.status === 'completed' ? '✅' : trace.status === 'error' ? '❌' : '⚠️'
    const toolCount = trace.toolInvocations.length
    const toolStr = toolCount > 0 ? `🔧${toolCount}` : '  '
    const latencySec = (trace.totalLatencyMs / 1000).toFixed(1)

    // Store for summary
    this.results.push({
      name,
      status: trace.status,
      turns: trace.turnCount,
      tools: toolCount,
      latency: trace.totalLatencyMs,
      error: trace.error,
    })

    // Print single line result
    const progress = `[${String(this.completed).padStart(2)}/${this.total}]`
    const nameCol = name.padEnd(40).slice(0, 40)
    console.log(`${progress} ${statusIcon} ${nameCol} ${toolStr}  ${trace.turnCount}t  ${latencySec}s`)

    if (this.verbose && trace.error) {
      console.log(`         └─ Error: ${trace.error}`)
    }

    if (this.verbose && trace.finalAnswer) {
      const preview = trace.finalAnswer.slice(0, 60).replace(/\n/g, ' ')
      console.log(`         └─ "${preview}..."`)
    }
  }

  printSummary(): void {
    const elapsed = (Date.now() - this.startTime) / 1000
    const passed = this.results.filter((r) => r.status === 'completed').length
    const failed = this.results.filter((r) => r.status === 'error').length
    const avgLatency = this.results.reduce((sum, r) => sum + r.latency, 0) / this.results.length / 1000

    console.log('')
    console.log('─'.repeat(60))
    console.log(
      `✅ Passed: ${passed}  ❌ Failed: ${failed}  ⏱ Total: ${elapsed.toFixed(1)}s  Avg: ${avgLatency.toFixed(1)}s/test`,
    )
  }
}

/**
 * Create the target function for LangSmith evaluate()
 * This executes multi-turn conversations and returns the trace
 */
const createTargetFunction = (config: ExecutorConfig, tracker: ProgressTracker) => {
  return async (inputs: { question: string; test_case_id?: string; test_case_name?: string }) => {
    const trace = await executeConversation(inputs.question, config, {
      testCaseId: inputs.test_case_id,
      testCaseName: inputs.test_case_name,
    })

    // Log result (single line, only when complete)
    tracker.logResult(trace)

    // Return structured output for evaluators
    return {
      answer: trace.finalAnswer || '',
      tool_calls: trace.toolInvocations.map((t) => ({
        tool: t.tool,
        arguments: t.arguments,
        result: t.result.slice(0, 500), // Truncate for readability
        error: t.error,
      })),
      turn_count: trace.turnCount,
      latency_ms: trace.totalLatencyMs,
      status: trace.status,
      error: trace.error,
      // Include full trace for evaluators
      _trace: trace,
    }
  }
}

/**
 * Evaluation progress tracker for LLM judge phase
 */
class EvaluationTracker {
  private completed = 0
  private total: number
  private headerPrinted = false
  private startTime = 0
  private verbose: boolean

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
      console.log('🧠 Running LLM-as-judge evaluations...')
      console.log('─'.repeat(60))
    }
  }

  logEvaluation(testName: string, evaluatorName: string, score: number | null, isLLM: boolean): void {
    this.printHeader()
    this.completed++

    const progress = `[${String(this.completed).padStart(2)}/${this.total}]`
    const scoreStr = score !== null ? `${(score * 100).toFixed(0)}%` : 'N/A'
    const scoreIcon = score === null ? '⚪' : score >= 0.7 ? '🟢' : score >= 0.4 ? '🟡' : '🔴'
    const typeIcon = isLLM ? '🤖' : '📏'

    // Truncate names to fit
    const shortTest = testName.slice(0, 25).padEnd(25)
    const shortEval = evaluatorName.padEnd(16)

    console.log(`${progress} ${typeIcon} ${shortTest} ${shortEval} ${scoreIcon} ${scoreStr}`)
  }

  printSummary(): void {
    if (this.headerPrinted) {
      const elapsed = (Date.now() - this.startTime) / 1000
      console.log('─'.repeat(60))
      console.log(`✅ Evaluated ${this.completed} criteria in ${elapsed.toFixed(1)}s`)
    }
  }
}

// Global evaluation tracker (set during evaluation run)
let evalTracker: EvaluationTracker | null = null

/**
 * Create LangSmith-compatible evaluator from our quality evaluator
 */
const createLangSmithEvaluator = (
  name: string,
  evalFn: (trace: ConversationTrace) => Promise<{ score: number; passed: boolean; reasoning: string } | null>,
  isLLM: boolean = true,
) => {
  return async ({
    run,
    example,
  }: {
    run: { outputs?: Record<string, unknown> }
    example: { inputs?: Record<string, unknown> }
  }) => {
    const outputs = run.outputs || {}
    const trace = outputs._trace as ConversationTrace | undefined
    const testName =
      trace?.metadata?.testCaseName || (example?.inputs as { test_case_name?: string })?.test_case_name || 'Unknown'

    if (!trace) {
      evalTracker?.logEvaluation(testName, name, 0, isLLM)
      return {
        key: name,
        score: 0,
        comment: 'No trace available for evaluation',
      }
    }

    try {
      const result = await evalFn(trace)
      if (!result) {
        evalTracker?.logEvaluation(testName, name, null, isLLM)
        return {
          key: name,
          score: null, // N/A
          comment: 'Evaluation not applicable (e.g., no tools used)',
        }
      }

      evalTracker?.logEvaluation(testName, name, result.score, isLLM)
      return {
        key: name,
        score: result.score,
        comment: result.reasoning,
      }
    } catch (error) {
      evalTracker?.logEvaluation(testName, name, 0, isLLM)
      return {
        key: name,
        score: 0,
        comment: `Evaluation failed: ${(error as Error).message}`,
      }
    }
  }
}

/**
 * Create heuristic-based evaluator (no LLM, fast)
 */
const createHeuristicEvaluator = () => {
  return async ({
    run,
    example,
  }: {
    run: { outputs?: Record<string, unknown> }
    example: { inputs?: Record<string, unknown> }
  }) => {
    const outputs = run.outputs || {}
    const trace = outputs._trace as ConversationTrace | undefined
    const testName =
      trace?.metadata?.testCaseName || (example?.inputs as { test_case_name?: string })?.test_case_name || 'Unknown'

    if (!trace) {
      evalTracker?.logEvaluation(testName, 'heuristic', 0, false)
      return { key: 'journey_heuristic', score: 0, comment: 'No trace available' }
    }

    const result = evaluateJourneyHeuristic(trace)
    evalTracker?.logEvaluation(testName, 'heuristic', result.score, false)
    return {
      key: 'journey_heuristic',
      score: result.score,
      comment: result.reasoning,
    }
  }
}

/**
 * Main evaluation function
 */
const runQualityEvaluation = async (options: RunOptions = {}): Promise<void> => {
  const model = options.model || DEFAULT_MODEL
  const verbose = options.verbose || false
  const useLLMJudge = options.useLLMJudge !== false

  console.log('🔬 Thunderbolt Quality Evaluation')
  console.log('═'.repeat(40))
  console.log(`Backend: ${BACKEND_URL}`)
  console.log(`Model: ${model}`)
  console.log(`Max Turns: ${MAX_TURNS}`)
  console.log(`Timeout: ${TIMEOUT_MS / 1000}s`)
  console.log(`LangSmith: ${isLangSmithConfigured() ? 'Enabled' : 'Disabled'}`)
  console.log(
    `LLM Judge: ${useLLMJudge ? process.env.LLM_JUDGE_MODEL || 'anthropic:claude-3-5-haiku-20241022' : 'Disabled (heuristics only)'}`,
  )

  if (!isLangSmithConfigured()) {
    console.error('\n❌ LangSmith not configured. Set LANGSMITH_API_KEY and LANGSMITH_TRACING_ENABLED=true')
    process.exit(1)
  }

  const config: ExecutorConfig = {
    backendUrl: BACKEND_URL,
    model,
    maxTurns: MAX_TURNS,
    timeoutMs: TIMEOUT_MS,
    temperature: 0.7,
  }

  // Handle production traces mode
  if (options.production || options.traceIds) {
    console.log('\n📥 Production trace evaluation not yet integrated with LangSmith experiments')
    console.log('   Use --sync and run without --production for experiment mode')

    // For now, run the old way for production traces
    const traces = await sampleProductionTraces({
      source: options.traceIds ? 'manual' : 'recent',
      traceIds: options.traceIds,
      hoursBack: options.hours || 24,
      maxTraces: options.maxTraces || 20,
      filters: { hasToolCalls: true },
    })

    if (traces.length === 0) {
      console.log('⚠️ No production traces found')
      return
    }

    console.log(`   Found ${traces.length} traces - evaluating...`)

    for (const trace of traces) {
      const results = await Promise.all([
        evaluateToolDecision(trace),
        evaluateToolExecution(trace),
        evaluateAnswerQuality(trace),
        useLLMJudge ? evaluateJourney(trace) : Promise.resolve(evaluateJourneyHeuristic(trace)),
      ])

      const validScores = results.filter((r) => r !== null).map((r) => r!.score)
      const avgScore = validScores.length > 0 ? validScores.reduce((a, b) => a + b, 0) / validScores.length : 0

      const icon = avgScore >= 0.7 ? '✅' : '❌'
      console.log(`\n${icon} ${trace.initialQuery.slice(0, 50)}...`)
      console.log(`   Score: ${(avgScore * 100).toFixed(0)}% | Turns: ${trace.turnCount} | Status: ${trace.status}`)

      if (verbose) {
        for (let i = 0; i < results.length; i++) {
          const r = results[i]
          if (r) {
            const names = ['Tool Decision', 'Tool Execution', 'Answer Quality', 'Journey']
            console.log(`   - ${names[i]}: ${(r.score * 100).toFixed(0)}% - ${r.reasoning.slice(0, 60)}...`)
          }
        }
      }
    }

    return
  }

  // Sync dataset if needed
  console.log('\n📚 Syncing dataset to LangSmith...')
  await syncToLangSmith(allQualityCases)

  // Create evaluators
  // Heuristic evaluators (no LLM cost): 3
  // LLM judge evaluators: 8
  const heuristicEvaluatorCount = 3
  const llmEvaluatorCount = 8
  const evaluatorCount = useLLMJudge ? heuristicEvaluatorCount + llmEvaluatorCount : heuristicEvaluatorCount

  const evaluators: Array<
    (args: {
      run: { outputs?: Record<string, unknown> }
      example: { inputs?: Record<string, unknown> }
    }) => Promise<{ key: string; score: number | null; comment: string }>
  > = [
    // Heuristic evaluators (fast, no LLM cost)
    createHeuristicEvaluator(), // Journey heuristic
    createLangSmithEvaluator('latency', async (trace) => evaluateLatency(trace), false),
    createLangSmithEvaluator('token_efficiency', async (trace) => evaluateTokenEfficiency(trace), false),
  ]

  if (useLLMJudge) {
    evaluators.push(
      // Core evaluators
      createLangSmithEvaluator('tool_decision', evaluateToolDecision, true),
      createLangSmithEvaluator('tool_execution', evaluateToolExecution, true),
      createLangSmithEvaluator('answer_quality', evaluateAnswerQuality, true),
      createLangSmithEvaluator('journey', evaluateJourney, true),
      // New LLM evaluators
      createLangSmithEvaluator('faithfulness', evaluateFaithfulness, true),
      createLangSmithEvaluator('hallucination', evaluateHallucination, true),
      createLangSmithEvaluator('confidence', evaluateConfidence, true),
      createLangSmithEvaluator('instruction_following', evaluateInstructionFollowing, true),
    )
  }

  // Create experiment name
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '')
  const experimentName = `quality-${model}-${timestamp}`

  // Create progress trackers
  const totalCases = allQualityCases.length
  const tracker = new ProgressTracker(totalCases, verbose)
  evalTracker = new EvaluationTracker(totalCases, evaluatorCount, verbose)

  console.log(`\n🧪 Experiment: ${experimentName}`)
  console.log(`   Dataset: ${DATASET_NAME} (${totalCases} tests)`)
  console.log(`   Evaluators: ${evaluators.length} (${useLLMJudge ? 'heuristic + LLM judge' : 'heuristic only'})`)
  console.log(`   Concurrency: ${MAX_CONCURRENT}`)
  console.log('')
  console.log('─'.repeat(60))
  console.log('[##/##] ST  Test Name                               Tools Turns Time')
  console.log('─'.repeat(60))

  try {
    // Run LangSmith evaluate()
    const results = await evaluate(createTargetFunction(config, tracker), {
      data: DATASET_NAME,
      evaluators,
      experimentPrefix: experimentName,
      maxConcurrency: MAX_CONCURRENT,
    })

    // Print execution summary
    tracker.printSummary()

    // Consume results iterator (triggers evaluators and collects scores)
    let totalScore = 0
    let scoreCount = 0

    for await (const result of results) {
      const scores = result.evaluationResults?.results || []
      const numericScores = scores.map((s) => s.score).filter((s): s is number => typeof s === 'number')
      if (numericScores.length > 0) {
        totalScore += numericScores.reduce((sum, s) => sum + s, 0) / numericScores.length
        scoreCount++
      }
    }

    // Print evaluation phase summary
    evalTracker?.printSummary()

    // Final summary with scores and link
    console.log('')
    console.log('═'.repeat(60))
    console.log('📊 EVALUATION SCORES')
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

// Run the evaluation
const options = parseArgs()
runQualityEvaluation(options).catch(console.error)
