/**
 * LangSmith Provider
 *
 * Integrates with LangSmith for:
 * - Dataset management (sync test cases)
 * - Running evaluations using LangSmith's evaluate() function
 * - Experiment tracking with automatic syncing
 * - Fetching production traces for offline evaluation
 */

import { Client, type Run } from 'langsmith'
import { evaluate, type EvaluationResult } from 'langsmith/evaluation'
import type {
  Provider,
  Reporter,
  DatasetRef,
  ExperimentRef,
  Dataset,
  TraceFetchResult,
  TraceSampleOptions,
  Trace,
  SuiteResult,
  EvaluationConfig,
  TraceEvaluationConfig,
  TraceEvaluationResult,
  TestResult,
  EvalScore,
} from '../../core'
import type { ProviderOptions } from '../registry'
import { createLangSmithReporter } from './reporter'

export class LangSmithProvider implements Provider {
  readonly name = 'langsmith'
  readonly supportsTraces = true

  private client: Client | null = null
  private options: ProviderOptions

  constructor(options: ProviderOptions = {}) {
    this.options = options
  }

  async initialize(): Promise<void> {
    this.client = new Client()
  }

  async dispose(): Promise<void> {
    this.client = null
  }

  createReporter(experimentRef?: ExperimentRef): Reporter {
    if (!this.client) {
      throw new Error('LangSmithProvider not initialized. Call initialize() first.')
    }
    return createLangSmithReporter({
      client: this.client,
      experimentRef,
      verbose: this.options.verbose,
    })
  }

  /**
   * Run evaluation using LangSmith's native evaluate() function
   *
   * This automatically:
   * - Creates runs for each test case
   * - Attaches evaluator feedback
   * - Tracks everything in the LangSmith experiment
   */
  async runEvaluation<TInput, TOutput, TExpected>(
    config: EvaluationConfig<TInput, TOutput, TExpected>,
  ): Promise<SuiteResult<TInput, TOutput>> {
    if (!this.client) {
      throw new Error('LangSmithProvider not initialized. Call initialize() first.')
    }

    const { suiteName, dataset, executor, evaluators, model, backendUrl, verbose = false, maxConcurrency = 2 } = config

    // First sync the dataset to LangSmith
    const datasetRef = await this.syncDataset(dataset)

    // Create experiment name
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
    const experimentName = `${suiteName.toLowerCase().replace(/\s+/g, '-')}-${model}-${timestamp}`

    console.log('')
    console.log('═'.repeat(60))
    console.log(`🧪 ${suiteName.toUpperCase()}`)
    console.log('═'.repeat(60))
    console.log(`Model: ${model}`)
    console.log(`Tests: ${dataset.cases.length}`)
    console.log(`Evaluators: ${evaluators.length}`)
    console.log(`Provider: LangSmith (auto-sync enabled)`)
    console.log(`Experiment: ${experimentName}`)
    console.log('')

    // Track results for our return value
    const results: TestResult<TInput, TOutput>[] = []
    let completed = 0
    const total = dataset.cases.length

    // Create target function that runs the executor
    const target = async (inputs: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const testCaseId = inputs.test_case_id as string
      const testCaseName = inputs.test_case_name as string

      // Find the original test case
      const testCase = dataset.cases.find((tc) => tc.id === testCaseId)
      if (!testCase) {
        throw new Error(`Test case not found: ${testCaseId}`)
      }

      const startTime = Date.now()

      try {
        const execResult = await executor.execute(testCase.input, {
          backendUrl,
          model,
          timeoutMs: 60000,
          sourceTags: ['evaluation', suiteName.toLowerCase().replace(/\s+/g, '-')],
        })

        const latencyMs = execResult.latencyMs

        // Log progress
        completed++
        const statusIcon = execResult.error ? '❌' : '✅'
        console.log(`[${completed}/${total}] ${statusIcon} ${testCaseName} (${(latencyMs / 1000).toFixed(1)}s)`)

        if (verbose && execResult.error) {
          console.log(`    Error: ${execResult.error}`)
        }

        // Store for our results
        const output = execResult.output as TOutput
        results.push({
          testCaseId,
          testCaseName,
          input: testCase.input,
          output,
          scores: {}, // Will be filled by LangSmith
          overallScore: 0,
          passed: !execResult.error,
          latencyMs,
          error: execResult.error,
        })

        // Return in format LangSmith expects
        // Handle both BehavioralOutput (.content) and QualityOutput (.answer)
        const outputRecord = output as Record<string, unknown>
        return {
          answer: outputRecord.answer || outputRecord.content || '',
          tool_calls: outputRecord.toolCalls || [],
          finish_reason: outputRecord.finishReason,
          turn_count: outputRecord.turnCount,
          latency_ms: latencyMs,
          status: outputRecord.status,
          error: execResult.error,
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Unknown error'
        const latencyMs = Date.now() - startTime

        completed++
        console.log(`[${completed}/${total}] ❌ ${testCaseName} (${(latencyMs / 1000).toFixed(1)}s)`)
        if (verbose) {
          console.log(`    Error: ${error}`)
        }

        results.push({
          testCaseId,
          testCaseName,
          input: testCase.input,
          output: {} as TOutput,
          scores: {},
          overallScore: 0,
          passed: false,
          latencyMs,
          error,
        })

        // Return error state instead of throwing - LangSmith will record this as a failed run
        return {
          answer: '',
          tool_calls: [],
          finish_reason: 'error',
          turn_count: 0,
          latency_ms: latencyMs,
          status: 'error',
          error,
        }
      }
    }

    // Convert our evaluators to LangSmith format
    const langsmithEvaluators = evaluators.map((evaluator) => {
      return async ({
        outputs,
        inputs,
      }: {
        outputs: Record<string, unknown>
        inputs: Record<string, unknown>
      }): Promise<EvaluationResult> => {
        const testCaseId = inputs.test_case_id as string
        const testCase = dataset.cases.find((tc) => tc.id === testCaseId)

        if (!testCase) {
          return { key: evaluator.name, score: 0, comment: 'Test case not found' }
        }

        // Build output in the format our evaluators expect
        // Provide both .content and .answer for compatibility with both evaluator types
        const output = {
          content: outputs.answer || '',
          answer: outputs.answer || '',
          toolCalls: outputs.tool_calls || [],
          finishReason: outputs.finish_reason,
          turnCount: outputs.turn_count,
          latencyMs: outputs.latency_ms,
          status: outputs.status,
        } as TOutput

        const ctx = {
          testCase,
          output,
          latencyMs: (outputs.latency_ms as number) || 0,
        }

        try {
          const score = await evaluator.evaluate(ctx)

          if (verbose) {
            const icon = score.value >= 0.7 ? '🟢' : score.value >= 0.4 ? '🟡' : '🔴'
            console.log(`    ${icon} ${evaluator.name}: ${(score.value * 100).toFixed(0)}%`)
          }

          return {
            key: evaluator.name,
            score: score.value,
            comment: score.reasoning,
          }
        } catch (e) {
          const error = e instanceof Error ? e.message : 'Unknown error'
          return {
            key: evaluator.name,
            score: 0,
            comment: `Evaluator error: ${error}`,
          }
        }
      }
    })

    // Run evaluation using LangSmith's evaluate()
    console.log('─'.repeat(60))

    const evalResults = await evaluate(target, {
      data: datasetRef.name,
      evaluators: langsmithEvaluators,
      experimentPrefix: experimentName,
      maxConcurrency,
    })

    // Consume results to get scores
    const scoresByEvaluator: Record<string, number[]> = {}
    let totalScore = 0
    let scoreCount = 0

    for await (const result of evalResults) {
      const testCaseId = result.example?.inputs?.test_case_id as string
      const testResult = results.find((r) => r.testCaseId === testCaseId)

      if (testResult && result.evaluationResults?.results) {
        for (const evalResult of result.evaluationResults.results) {
          const score = typeof evalResult.score === 'number' ? evalResult.score : 0
          testResult.scores[evalResult.key] = {
            value: score,
            passed: score >= 0.5,
            reasoning: evalResult.comment || '',
          }

          if (!scoresByEvaluator[evalResult.key]) {
            scoresByEvaluator[evalResult.key] = []
          }
          scoresByEvaluator[evalResult.key].push(score)

          totalScore += score
          scoreCount++
        }

        // Calculate overall score for this test
        const scores = Object.values(testResult.scores).map((s) => s.value)
        testResult.overallScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
        testResult.passed = testResult.overallScore >= 0.5
      }
    }

    // Print summary
    console.log('')
    console.log('═'.repeat(60))
    console.log('📊 RESULTS')
    console.log('═'.repeat(60))

    const passed = results.filter((r) => r.passed).length
    const failed = results.filter((r) => !r.passed && !r.error).length
    const errored = results.filter((r) => !!r.error).length
    const avgScore = scoreCount > 0 ? totalScore / scoreCount : 0

    console.log(`Passed: ${passed}/${total} (${((passed / total) * 100).toFixed(0)}%)`)
    console.log(`Avg Score: ${(avgScore * 100).toFixed(1)}%`)

    if (errored > 0) {
      console.log(`Errors: ${errored}`)
    }

    // Show per-evaluator scores
    console.log('')
    console.log('Scores by evaluator:')
    for (const [name, scores] of Object.entries(scoresByEvaluator)) {
      if (scores.length === 0) continue
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      const icon = avg >= 0.7 ? '🟢' : avg >= 0.4 ? '🟡' : '🔴'
      console.log(`  ${icon} ${name}: ${(avg * 100).toFixed(0)}%`)
    }

    const projectName = process.env.LANGSMITH_PROJECT || 'default'
    console.log('')
    console.log(`📈 View in LangSmith: https://smith.langchain.com/projects/${encodeURIComponent(projectName)}`)
    console.log(`   Experiment: ${experimentName}`)
    console.log('')

    // Build summary
    const avgLatencyMs = results.length > 0 ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length : 0

    const scoresByEvaluatorAvg: Record<string, number> = {}
    for (const [name, scores] of Object.entries(scoresByEvaluator)) {
      if (scores.length > 0) {
        scoresByEvaluatorAvg[name] = scores.reduce((a, b) => a + b, 0) / scores.length
      }
    }

    return {
      suiteName,
      timestamp: new Date(),
      model,
      provider: 'langsmith',
      results,
      summary: {
        total,
        passed,
        failed,
        errored,
        avgScore,
        avgLatencyMs,
        scoresByEvaluator: scoresByEvaluatorAvg,
      },
      url: `https://smith.langchain.com/projects/${encodeURIComponent(projectName)}`,
    }
  }

  /**
   * Fetch production traces from LangSmith
   */
  async fetchTraces(options: TraceSampleOptions = {}): Promise<TraceFetchResult> {
    if (!this.client) {
      throw new Error('LangSmithProvider not initialized. Call initialize() first.')
    }

    const projectName = process.env.LANGSMITH_PROJECT
    if (!projectName) {
      throw new Error('LANGSMITH_PROJECT environment variable is required for fetching traces')
    }

    const limit = options.limit || 50
    const traces: Trace[] = []
    const excludeTags = options.excludeTags ?? ['evaluation']
    const filters: string[] = []

    if (options.errorsOnly) {
      filters.push('eq(error, true)')
    }

    const runIterator = this.client.listRuns({
      projectName,
      startTime: options.since,
      filter: filters.length > 0 ? filters.join(' and ') : undefined,
      isRoot: true,
    })

    let count = 0
    for await (const run of runIterator) {
      if (count >= limit) break

      if (options.until && run.end_time && new Date(run.end_time) > options.until) {
        continue
      }

      const extra = run.extra as Record<string, unknown> | undefined
      const metadata = extra?.metadata as Record<string, unknown> | undefined
      const source = metadata?.source as string | undefined
      const sourceTags = metadata?.source_tags as string[] | undefined

      if (excludeTags.length > 0) {
        if (source && excludeTags.includes(source)) continue
        if (sourceTags?.some((tag) => excludeTags.includes(tag))) continue
      }

      const trace = langsmithRunToTrace(run)
      if (trace) {
        traces.push(trace)
        count++
      }
    }

    const finalTraces = options.random ? traces.sort(() => Math.random() - 0.5) : traces

    return { traces: finalTraces, total: finalTraces.length }
  }

  async syncDataset(dataset: Dataset): Promise<DatasetRef> {
    if (!this.client) {
      throw new Error('LangSmithProvider not initialized. Call initialize() first.')
    }

    let lsDataset
    try {
      lsDataset = await this.client.readDataset({ datasetName: dataset.name })

      const existingExamples = this.client.listExamples({ datasetId: lsDataset.id })
      const exampleIds: string[] = []
      for await (const example of existingExamples) {
        exampleIds.push(example.id)
      }
      if (exampleIds.length > 0) {
        await this.client.deleteExamples(exampleIds)
      }
    } catch {
      lsDataset = await this.client.createDataset(dataset.name, {
        description: dataset.description,
      })
    }

    const inputs: Record<string, unknown>[] = []
    const outputs: Record<string, unknown>[] = []
    const metadata: Record<string, unknown>[] = []

    for (const testCase of dataset.cases) {
      const inputData =
        typeof testCase.input === 'object' && testCase.input !== null
          ? (testCase.input as Record<string, unknown>)
          : { data: testCase.input }

      inputs.push({
        ...inputData,
        test_case_id: testCase.id,
        test_case_name: testCase.name,
      })

      outputs.push({ expected: testCase.expected })

      const metadataData =
        typeof testCase.metadata === 'object' && testCase.metadata !== null
          ? (testCase.metadata as Record<string, unknown>)
          : {}

      metadata.push({
        id: testCase.id,
        name: testCase.name,
        description: testCase.description,
        tags: testCase.tags,
        ...metadataData,
      })
    }

    await this.client.createExamples({
      datasetId: lsDataset.id,
      inputs,
      outputs,
      metadata,
    })

    return { id: lsDataset.id, name: dataset.name, provider: 'langsmith' }
  }

  async getDataset(name: string): Promise<DatasetRef | null> {
    if (!this.client) {
      throw new Error('LangSmithProvider not initialized. Call initialize() first.')
    }

    try {
      const dataset = await this.client.readDataset({ datasetName: name })
      return { id: dataset.id, name: dataset.name, provider: 'langsmith' }
    } catch {
      return null
    }
  }

  async createExperiment(name: string, datasetRef?: DatasetRef): Promise<ExperimentRef> {
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
    const experimentName = `${name}-${timestamp}`
    const projectName = process.env.LANGSMITH_PROJECT || 'default'
    const url = `https://smith.langchain.com/projects/${encodeURIComponent(projectName)}`

    return {
      id: experimentName,
      name: experimentName,
      provider: 'langsmith',
      datasetRef,
      url,
    }
  }

  /**
   * Run trace evaluation by attaching feedback to existing production runs
   *
   * This follows LangSmith's "online evaluation" pattern:
   * - Evaluates existing production traces WITHOUT re-executing
   * - Attaches feedback scores directly to the original runs using createFeedback()
   * - Results appear in LangSmith UI attached to the original traces
   */
  async runTraceEvaluation<TOutput, TExpected>(
    config: TraceEvaluationConfig<TOutput, TExpected>,
  ): Promise<TraceEvaluationResult> {
    if (!this.client) {
      throw new Error('LangSmithProvider not initialized. Call initialize() first.')
    }

    const { name, traces, evaluators, verbose = false } = config

    console.log('')
    console.log('═'.repeat(60))
    console.log(`🔍 ${name.toUpperCase()}`)
    console.log('═'.repeat(60))
    console.log(`Traces: ${traces.length}`)
    console.log(`Evaluators: ${evaluators.length}`)
    console.log(`Mode: Online evaluation (feedback attached to original runs)`)
    console.log('')

    const results: TraceEvaluationResult['results'] = []
    const scoresByEvaluator: Record<string, number[]> = {}

    let completed = 0
    const total = traces.length

    for (const trace of traces) {
      const traceScores: Record<string, number> = {}
      let hasError = false

      // Build output object for evaluators
      const output = {
        answer: trace.output.content,
        content: trace.output.content,
        toolCalls: (trace.output.toolCalls || []).map((tc) => ({
          tool: tc.name,
          arguments: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || '{}') : tc.arguments,
          result: tc.result || '',
        })),
        turnCount: 1,
        latencyMs: trace.latencyMs,
        status: trace.error ? 'error' : 'completed',
        error: trace.error,
      } as TOutput

      // Build test case for evaluators
      const testCase = {
        id: trace.id,
        name: trace.input.question || 'Trace',
        source: 'trace' as const,
        input: trace.input,
        expected: {} as TExpected,
        metadata: trace.metadata,
      }

      // Run each evaluator and attach feedback
      for (const evaluator of evaluators) {
        try {
          const ctx = {
            testCase,
            output,
            latencyMs: trace.latencyMs,
          }

          // Check if evaluator should be skipped
          if (evaluator.shouldSkip?.(ctx)) {
            if (verbose) {
              console.log(`    ⏭️  ${evaluator.name}: skipped`)
            }
            continue
          }

          const score = await evaluator.evaluate(ctx)

          traceScores[evaluator.name] = score.value

          if (!scoresByEvaluator[evaluator.name]) {
            scoresByEvaluator[evaluator.name] = []
          }
          scoresByEvaluator[evaluator.name].push(score.value)

          // Attach feedback to the original run in LangSmith
          await this.client.createFeedback(trace.id, evaluator.name, {
            score: score.value,
            comment: score.reasoning,
            value: score.passed ? 'pass' : 'fail',
          })

          if (verbose) {
            const icon = score.value >= 0.7 ? '🟢' : score.value >= 0.4 ? '🟡' : '🔴'
            console.log(`    ${icon} ${evaluator.name}: ${(score.value * 100).toFixed(0)}%`)
          }
        } catch (e) {
          hasError = true
          const error = e instanceof Error ? e.message : 'Unknown error'
          if (verbose) {
            console.log(`    ❌ ${evaluator.name}: ${error}`)
          }
        }
      }

      // Calculate overall score for this trace
      const scoreValues = Object.values(traceScores)
      const avgScore = scoreValues.length > 0 ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : 0
      const passed = avgScore >= 0.5

      // Attach overall feedback
      if (scoreValues.length > 0) {
        await this.client.createFeedback(trace.id, 'overall_score', {
          score: avgScore,
          comment: `Evaluated with ${evaluators.length} evaluators`,
          value: passed ? 'pass' : 'fail',
        })
      }

      completed++
      const statusIcon = hasError ? '❌' : passed ? '✅' : '⚠️'
      const traceName = (trace.input.question || trace.id).slice(0, 40)
      console.log(`[${completed}/${total}] ${statusIcon} ${traceName.padEnd(40)} ${(avgScore * 100).toFixed(0)}%`)

      results.push({
        traceId: trace.id,
        scores: traceScores,
        passed,
        error: hasError ? 'Evaluation error' : undefined,
      })
    }

    // Calculate summary
    const passed = results.filter((r) => r.passed).length
    const failed = results.filter((r) => !r.passed && !r.error).length
    const errored = results.filter((r) => !!r.error).length
    const allScores = results.flatMap((r) => Object.values(r.scores))
    const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0

    const avgByEvaluator: Record<string, number> = {}
    for (const [name, scores] of Object.entries(scoresByEvaluator)) {
      avgByEvaluator[name] = scores.reduce((a, b) => a + b, 0) / scores.length
    }

    // Print summary
    console.log('')
    console.log('═'.repeat(60))
    console.log('📊 RESULTS')
    console.log('═'.repeat(60))
    console.log(`Passed: ${passed}/${total} (${((passed / total) * 100).toFixed(0)}%)`)
    console.log(`Avg Score: ${(avgScore * 100).toFixed(1)}%`)
    if (errored > 0) {
      console.log(`Errors: ${errored}`)
    }

    console.log('')
    console.log('Scores by evaluator:')
    for (const [evalName, avg] of Object.entries(avgByEvaluator)) {
      const icon = avg >= 0.7 ? '🟢' : avg >= 0.4 ? '🟡' : '🔴'
      console.log(`  ${icon} ${evalName}: ${(avg * 100).toFixed(0)}%`)
    }

    const projectName = process.env.LANGSMITH_PROJECT || 'default'
    console.log('')
    console.log(
      `📈 View feedback in LangSmith: https://smith.langchain.com/projects/${encodeURIComponent(projectName)}`,
    )
    console.log(`   Feedback attached to ${total} original production traces`)
    console.log('')

    return {
      total,
      passed,
      failed,
      errored,
      avgScore,
      scoresByEvaluator: avgByEvaluator,
      results,
    }
  }
}

/**
 * Convert a LangSmith run to our Trace format
 */
const langsmithRunToTrace = (run: Run): Trace | null => {
  try {
    const inputs = run.inputs as Record<string, unknown> | undefined
    const outputs = run.outputs as Record<string, unknown> | undefined

    if (!inputs || !outputs) return null

    const messages = (inputs.messages as Array<{ role: string; content: string }>) || []
    const question =
      (inputs.question as string) || (inputs.input as string) || messages.find((m) => m.role === 'user')?.content || ''

    const content = (outputs.content as string) || (outputs.output as string) || (outputs.text as string) || ''

    const startTime = run.start_time ? new Date(run.start_time) : new Date()
    const endTime = run.end_time ? new Date(run.end_time) : new Date()
    const latencyMs = endTime.getTime() - startTime.getTime()

    return {
      id: run.id,
      timestamp: startTime,
      model: ((run.extra as Record<string, unknown>)?.model as string) || 'unknown',
      input: {
        messages: messages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant' | 'tool',
          content: m.content,
        })),
        question,
      },
      output: {
        content,
        toolCalls: extractToolCalls(outputs),
      },
      latencyMs,
      tokens: extractTokens(run),
      metadata: {
        runType: run.run_type,
        tags: run.tags,
        ...((run.extra as Record<string, unknown>) || {}),
      },
      error: run.error || undefined,
    }
  } catch {
    return null
  }
}

const extractToolCalls = (
  outputs: Record<string, unknown>,
): Array<{ name: string; arguments: string; result?: string }> => {
  const toolCalls = outputs.tool_calls as
    | Array<{
        name?: string
        function?: { name: string; arguments: string }
        arguments?: string
      }>
    | undefined

  if (!toolCalls) return []

  return toolCalls.map((tc) => ({
    name: tc.name || tc.function?.name || 'unknown',
    arguments: tc.arguments || tc.function?.arguments || '{}',
    result: undefined,
  }))
}

const extractTokens = (run: Run): { input: number; output: number; total: number } | undefined => {
  const extra = run.extra as Record<string, unknown> | undefined
  const usage = extra?.token_usage as Record<string, number> | undefined

  if (!usage) return undefined

  return {
    input: usage.prompt_tokens || usage.input_tokens || 0,
    output: usage.completion_tokens || usage.output_tokens || 0,
    total: usage.total_tokens || 0,
  }
}
