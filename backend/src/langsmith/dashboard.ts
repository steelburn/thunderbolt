/**
 * Dashboard Module
 *
 * Provides API routes and utilities for viewing evaluation metrics.
 * Creates a simple dashboard for monitoring prompt quality over time.
 */

import { Elysia } from 'elysia'
import {
  getEvaluationMetrics,
  getOnlineEvaluationConfig,
  configureOnlineEvaluation,
  type EvaluationMetrics,
  type OnlineEvaluationConfig,
} from './online-evaluation'
import { isLangSmithConfigured, getLangSmithProject, getLangSmithSamplingRate } from './client'
import { getSettings } from '@/config/settings'

export type DashboardStatus = {
  langsmith: {
    configured: boolean
    project: string | null
  }
  onlineEvaluation: {
    enabled: boolean
    samplingRate: number
    useLLMJudge: boolean
  }
  metrics: EvaluationMetrics
}

/**
 * Get current dashboard status
 */
export const getDashboardStatus = (): DashboardStatus => {
  const config = getOnlineEvaluationConfig()

  return {
    langsmith: {
      configured: isLangSmithConfigured(),
      project: isLangSmithConfigured() ? getLangSmithProject() : null,
    },
    onlineEvaluation: {
      enabled: config.samplingRate > 0,
      samplingRate: config.samplingRate,
      useLLMJudge: config.useLLMJudge,
    },
    metrics: getEvaluationMetrics(),
  }
}

/**
 * Format metrics for display
 */
export const formatMetricsForDisplay = (metrics: EvaluationMetrics): string => {
  if (metrics.totalEvaluated === 0) {
    return 'No evaluations recorded yet.'
  }

  const lines = [
    '📊 Evaluation Metrics',
    '=====================',
    '',
    `Total Evaluated: ${metrics.totalEvaluated}`,
    `Pass Rate: ${(metrics.passRate * 100).toFixed(1)}%`,
    `Average Score: ${(metrics.averageScore * 100).toFixed(1)}%`,
    '',
    '⏱️ Latency',
    `  p50: ${metrics.latencyP50.toFixed(0)}ms`,
    `  p95: ${metrics.latencyP95.toFixed(0)}ms`,
    '',
    `🔧 Tool Usage Rate: ${(metrics.toolUsageRate * 100).toFixed(1)}%`,
    '',
    '📈 Scores by Category:',
  ]

  for (const [category, scores] of Object.entries(metrics.scoresByCategory)) {
    lines.push(`  ${category}:`)
    lines.push(`    avg: ${(scores.avg * 100).toFixed(1)}%`)
    lines.push(`    pass: ${(scores.passRate * 100).toFixed(1)}%`)
  }

  return lines.join('\n')
}

/**
 * Alert thresholds for monitoring
 */
export type AlertThresholds = {
  minPassRate: number
  maxLatencyP95: number
  minAverageScore: number
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  minPassRate: 0.8, // Alert if pass rate drops below 80%
  maxLatencyP95: 5000, // Alert if p95 latency exceeds 5 seconds
  minAverageScore: 0.7, // Alert if average score drops below 70%
}

let thresholds: AlertThresholds = { ...DEFAULT_THRESHOLDS }

/**
 * Configure alert thresholds
 */
export const configureAlertThresholds = (newThresholds: Partial<AlertThresholds>): void => {
  thresholds = { ...thresholds, ...newThresholds }
}

/**
 * Check if any alerts should be triggered
 */
export type Alert = {
  type: 'pass_rate' | 'latency' | 'score'
  severity: 'warning' | 'critical'
  message: string
  currentValue: number
  threshold: number
}

export const checkAlerts = (metrics: EvaluationMetrics): Alert[] => {
  const alerts: Alert[] = []

  if (metrics.totalEvaluated < 10) {
    // Not enough data for meaningful alerts
    return alerts
  }

  if (metrics.passRate < thresholds.minPassRate) {
    alerts.push({
      type: 'pass_rate',
      severity: metrics.passRate < thresholds.minPassRate * 0.8 ? 'critical' : 'warning',
      message: `Pass rate (${(metrics.passRate * 100).toFixed(1)}%) below threshold (${(thresholds.minPassRate * 100).toFixed(0)}%)`,
      currentValue: metrics.passRate,
      threshold: thresholds.minPassRate,
    })
  }

  if (metrics.latencyP95 > thresholds.maxLatencyP95) {
    alerts.push({
      type: 'latency',
      severity: metrics.latencyP95 > thresholds.maxLatencyP95 * 1.5 ? 'critical' : 'warning',
      message: `Latency p95 (${metrics.latencyP95.toFixed(0)}ms) exceeds threshold (${thresholds.maxLatencyP95}ms)`,
      currentValue: metrics.latencyP95,
      threshold: thresholds.maxLatencyP95,
    })
  }

  if (metrics.averageScore < thresholds.minAverageScore) {
    alerts.push({
      type: 'score',
      severity: metrics.averageScore < thresholds.minAverageScore * 0.8 ? 'critical' : 'warning',
      message: `Average score (${(metrics.averageScore * 100).toFixed(1)}%) below threshold (${(thresholds.minAverageScore * 100).toFixed(0)}%)`,
      currentValue: metrics.averageScore,
      threshold: thresholds.minAverageScore,
    })
  }

  return alerts
}

/**
 * Create dashboard API routes
 */
export const createDashboardRoutes = () => {
  return new Elysia({ prefix: '/eval' })
    .get('/status', () => {
      return getDashboardStatus()
    })
    .get('/metrics', () => {
      return getEvaluationMetrics()
    })
    .get('/metrics/text', () => {
      const metrics = getEvaluationMetrics()
      return new Response(formatMetricsForDisplay(metrics), {
        headers: { 'Content-Type': 'text/plain' },
      })
    })
    .get('/alerts', () => {
      const metrics = getEvaluationMetrics()
      return {
        alerts: checkAlerts(metrics),
        thresholds,
      }
    })
    .post('/config', async (ctx) => {
      const body = await ctx.request.json()

      if (body.samplingRate !== undefined) {
        configureOnlineEvaluation({ samplingRate: body.samplingRate })
      }
      if (body.useLLMJudge !== undefined) {
        configureOnlineEvaluation({ useLLMJudge: body.useLLMJudge })
      }
      if (body.thresholds) {
        configureAlertThresholds(body.thresholds)
      }

      return { success: true, config: getOnlineEvaluationConfig() }
    })
    .get('/health', () => {
      const metrics = getEvaluationMetrics()
      const alerts = checkAlerts(metrics)
      const hasCritical = alerts.some((a) => a.severity === 'critical')
      const hasWarning = alerts.some((a) => a.severity === 'warning')

      return {
        status: hasCritical ? 'critical' : hasWarning ? 'warning' : 'healthy',
        alertCount: alerts.length,
        metrics: {
          passRate: metrics.passRate,
          avgScore: metrics.averageScore,
          latencyP95: metrics.latencyP95,
        },
      }
    })
}

/**
 * Generate HTML dashboard (simple, no external dependencies)
 */
export const generateDashboardHTML = (): string => {
  const status = getDashboardStatus()
  const alerts = checkAlerts(status.metrics)

  const alertsHTML =
    alerts.length > 0
      ? alerts.map((a) => `<div class="alert ${a.severity}">⚠️ ${a.message}</div>`).join('')
      : '<div class="alert ok">✅ All metrics within thresholds</div>'

  return `<!DOCTYPE html>
<html>
<head>
  <title>Thunderbolt Evaluation Dashboard</title>
  <meta http-equiv="refresh" content="30">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #00d9ff; }
    .card { background: #16213e; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #333; }
    .metric:last-child { border-bottom: none; }
    .metric-value { font-weight: bold; color: #00d9ff; }
    .alert { padding: 12px; border-radius: 4px; margin: 8px 0; }
    .alert.warning { background: #4a3f00; border-left: 4px solid #ffc107; }
    .alert.critical { background: #4a0000; border-left: 4px solid #dc3545; }
    .alert.ok { background: #003a00; border-left: 4px solid #28a745; }
    .status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
    .status.configured { background: #28a745; }
    .status.not-configured { background: #6c757d; }
    .category { margin-left: 20px; color: #aaa; }
  </style>
</head>
<body>
  <h1>🔬 Evaluation Dashboard</h1>
  
  <div class="card">
    <h2>System Status</h2>
    <div class="metric">
      <span>LangSmith</span>
      <span class="status ${status.langsmith.configured ? 'configured' : 'not-configured'}">
        ${status.langsmith.configured ? `✓ ${status.langsmith.project}` : '✗ Not configured'}
      </span>
    </div>
    <div class="metric">
      <span>Online Evaluation</span>
      <span class="status ${status.onlineEvaluation.enabled ? 'configured' : 'not-configured'}">
        ${status.onlineEvaluation.enabled ? `✓ ${(status.onlineEvaluation.samplingRate * 100).toFixed(0)}% sampling` : '✗ Disabled'}
      </span>
    </div>
  </div>

  <div class="card">
    <h2>Alerts</h2>
    ${alertsHTML}
  </div>

  <div class="card">
    <h2>Metrics</h2>
    <div class="metric">
      <span>Total Evaluated</span>
      <span class="metric-value">${status.metrics.totalEvaluated}</span>
    </div>
    <div class="metric">
      <span>Pass Rate</span>
      <span class="metric-value">${(status.metrics.passRate * 100).toFixed(1)}%</span>
    </div>
    <div class="metric">
      <span>Average Score</span>
      <span class="metric-value">${(status.metrics.averageScore * 100).toFixed(1)}%</span>
    </div>
    <div class="metric">
      <span>Latency p50</span>
      <span class="metric-value">${status.metrics.latencyP50.toFixed(0)}ms</span>
    </div>
    <div class="metric">
      <span>Latency p95</span>
      <span class="metric-value">${status.metrics.latencyP95.toFixed(0)}ms</span>
    </div>
    <div class="metric">
      <span>Tool Usage Rate</span>
      <span class="metric-value">${(status.metrics.toolUsageRate * 100).toFixed(1)}%</span>
    </div>
  </div>

  <div class="card">
    <h2>Scores by Category</h2>
    ${Object.entries(status.metrics.scoresByCategory)
      .map(
        ([cat, scores]) => `
      <div class="metric">
        <span>${cat}</span>
        <span class="metric-value">${(scores.avg * 100).toFixed(1)}% avg / ${(scores.passRate * 100).toFixed(1)}% pass</span>
      </div>
    `,
      )
      .join('')}
  </div>

  <p style="color: #666; text-align: center; margin-top: 40px;">
    Auto-refreshes every 30 seconds • <a href="/v1/eval/metrics" style="color: #00d9ff;">JSON API</a>
  </p>
</body>
</html>`
}

/**
 * Create full dashboard routes including HTML view
 */
export const createFullDashboardRoutes = () => {
  return new Elysia({ prefix: '/eval' })
    .use(createDashboardRoutes())
    .get('/dashboard', () => {
      return new Response(generateDashboardHTML(), {
        headers: { 'Content-Type': 'text/html' },
      })
    })
    .get('/debug', () => {
      // Debug endpoint to check configuration
      const settings = getSettings()
      return {
        langsmith: {
          configured: isLangSmithConfigured(),
          apiKeySet: !!settings.langsmithApiKey,
          apiKeyPrefix: settings.langsmithApiKey ? settings.langsmithApiKey.slice(0, 10) + '...' : null,
          tracingEnabled: settings.langsmithTracingEnabled,
          project: settings.langsmithProject,
          samplingRate: settings.langsmithSamplingRate,
        },
        env: {
          LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY ? 'SET' : 'NOT SET',
          LANGSMITH_TRACING_ENABLED: process.env.LANGSMITH_TRACING_ENABLED ?? 'NOT SET',
          LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT ?? 'NOT SET',
        },
      }
    })
}
