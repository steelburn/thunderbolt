import { getCorsOrigins, getSettings } from '@/config/settings'
import { safeErrorHandler } from '@/middleware/error-handling'
import { isPostHogConfigured } from '@/posthog/client'
import { createSSEStreamFromCompletion } from '@/utils/streaming'
import type { OpenAI as PostHogOpenAI } from '@posthog/ai'
import { Elysia } from 'elysia'
import { APIConnectionError, APIConnectionTimeoutError } from 'openai'
import type { ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import { getInferenceClient, type InferenceProvider } from './client'

const EHBP_ENCLAVE_HEADER = 'x-tinfoil-enclave-url'
const EHBP_KEY_HEADER = 'ehbp-encapsulated-key'

type Message = { role: string; content: unknown }

const privilegedRoles = new Set(['developer', 'system'])

/** Downgrade developer/system roles to user for all messages except the first (the legitimate system prompt). */
const sanitizeMessageRoles = (messages: Message[]): Message[] =>
  messages.map((msg, i) => (i > 0 && privilegedRoles.has(msg.role) ? { ...msg, role: 'user' } : msg))

type ModelConfig = {
  provider: InferenceProvider
  internalName: string
}

export const supportedModels: Record<string, ModelConfig> = {
  'gpt-oss-120b': {
    provider: 'thunderbolt',
    internalName: 'openai/gpt-oss-120b',
  },
  'mistral-medium-3.1': {
    provider: 'mistral',
    internalName: 'mistral-medium-2508',
  },
  'mistral-large-3': {
    provider: 'mistral',
    internalName: 'mistral-large-2512',
  },
  'sonnet-4.5': {
    provider: 'anthropic',
    internalName: 'claude-sonnet-4-5',
  },
}

/**
 * Allowed enclave hostnames (comma-separated). Used to validate X-Tinfoil-Enclave-Url to prevent SSRF.
 */
const getAllowedEnclaveHostnames = (settings: { tinfoilEnclaveAllowedHostnames: string }): Set<string> => {
  const raw = settings.tinfoilEnclaveAllowedHostnames
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
}

/**
 * Parse usage metrics from Tinfoil HTTP trailer.
 * Format: "prompt=67,completion=42,total=109"
 */
const parseUsageMetrics = (metricsString: string): { prompt: number; completion: number; total: number } => {
  const pairs = metricsString.split(',')
  const metrics: Record<string, number> = {}

  for (const pair of pairs) {
    const [key, value] = pair.split('=')
    if (!key || !value) continue
    const num = Number.parseInt(value.trim(), 10)
    if (!Number.isNaN(num) && num >= 0) {
      metrics[key.trim()] = num
    }
  }

  return {
    prompt: metrics.prompt ?? 0,
    completion: metrics.completion ?? 0,
    total: metrics.total ?? 0,
  }
}

/**
 * Log Tinfoil usage metrics to console.
 */
const logTinfoilUsage = (
  metrics: { prompt: number; completion: number; total: number },
  duration: number,
  model: string,
): void => {
  console.info('[Usage]', {
    model,
    provider: 'tinfoil',
    promptTokens: metrics.prompt,
    completionTokens: metrics.completion,
    totalTokens: metrics.total,
    durationMs: duration,
  })
}

/**
 * Validate CORS origin against allowed origins.
 */
const isOriginAllowed = (origin: string): boolean => {
  const settings = getSettings()
  const allowedOrigins = getCorsOrigins(settings)

  if (allowedOrigins instanceof RegExp) {
    return allowedOrigins.test(origin)
  }

  return allowedOrigins.includes(origin)
}

/**
 * Proxy EHBP-encrypted request to Tinfoil enclave using Node's https module.
 * Required to read Ehbp-Response-Nonce from headers (Fetch API doesn't support HTTP/2 properly).
 */
const proxyEhbpRequest = async (ctx: { request: Request }, enclaveBaseUrl: string): Promise<Response> => {
  const { getSettings } = await import('@/config/settings')
  const settings = getSettings()
  if (!settings.tinfoilApiKey) {
    throw new Error('TINFOIL_API_KEY not configured')
  }

  const parsedEnclaveUrl = (() => {
    try {
      return new URL(enclaveBaseUrl)
    } catch {
      throw new Error('Invalid X-Tinfoil-Enclave-Url')
    }
  })()
  if (parsedEnclaveUrl.protocol !== 'https:') {
    throw new Error('X-Tinfoil-Enclave-Url must use https')
  }
  const upstreamHostname = parsedEnclaveUrl.hostname.toLowerCase()
  const allowed = getAllowedEnclaveHostnames(settings)
  if (!allowed.has(upstreamHostname)) {
    throw new Error(`Enclave hostname "${upstreamHostname}" is not allowed`)
  }

  const pathname = new URL(ctx.request.url).pathname
  const upstreamUrl = enclaveBaseUrl.replace(/\/$/, '') + pathname
  const body = await ctx.request.arrayBuffer()
  const ehbpKey = ctx.request.headers.get(EHBP_KEY_HEADER)

  const https = await import('node:https')
  const parsedUrl = new URL(upstreamUrl)
  const requestStartTime = Date.now()

  return new Promise<Response>((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': ctx.request.headers.get('content-type') ?? 'application/json',
        Accept: ctx.request.headers.get('accept') ?? 'text/event-stream',
        'Content-Length': Buffer.byteLength(new Uint8Array(body)),
        Authorization: `Bearer ${settings.tinfoilApiKey}`,
        ...(ehbpKey && { 'Ehbp-Encapsulated-Key': ehbpKey }),
      },
    }

    const req = https.request(options, (res) => {
      const responseHeaders = new Headers()
      const nonce = res.headers['ehbp-response-nonce'] as string | undefined

      if (nonce) {
        responseHeaders.set('Ehbp-Response-Nonce', nonce)
      }

      const contentType = res.headers['content-type']
      if (contentType) {
        responseHeaders.set('Content-Type', contentType)
      }

      // Only set CORS headers when origin is in the configured allowlist (same as Elysia CORS).
      const origin = ctx.request.headers.get('origin')
      if (origin && isOriginAllowed(origin)) {
        responseHeaders.set('Access-Control-Allow-Origin', origin)
        responseHeaders.set('Access-Control-Allow-Credentials', 'true')
        responseHeaders.set('Access-Control-Expose-Headers', 'Ehbp-Response-Nonce')
      }

      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()

      // Use synchronous handler to avoid race conditions with concurrent writes
      res.on('data', (chunk: Buffer) => {
        writer.write(new Uint8Array(chunk)).catch((error) => {
          console.error('[EHBP] Error writing chunk:', error)
          req.destroy()
        })
      })

      res.on('end', async () => {
        try {
          // Extract usage metrics from HTTP trailers
          const usageMetrics = res.trailers?.['x-tinfoil-usage-metrics']
          if (usageMetrics && typeof usageMetrics === 'string') {
            const metrics = parseUsageMetrics(usageMetrics)
            const duration = Date.now() - requestStartTime
            logTinfoilUsage(metrics, duration, 'gpt-oss-120b')
          }

          await writer.close()
        } catch (error) {
          console.error('[EHBP] Error in end handler:', error)
          writer.abort(error as Error)
        }
      })

      res.on('error', (error: Error) => {
        console.error('[EHBP] Response stream error:', error)
        writer.abort(error)
        req.destroy()
      })

      resolve(
        new Response(readable, {
          status: res.statusCode || 200,
          headers: responseHeaders,
        }),
      )
    })

    req.on('error', (error: Error) => {
      console.error('[EHBP] Request error:', error)
      reject(new Error(`Failed to proxy request to Tinfoil: ${error.message}`))
    })

    // Add timeout to prevent indefinite hanging
    const PROXY_TIMEOUT_MS = 30_000 // 30 seconds
    req.setTimeout(PROXY_TIMEOUT_MS, () => {
      console.error('[EHBP] Request timeout after', PROXY_TIMEOUT_MS, 'ms')
      req.destroy()
      reject(new Error('Tinfoil proxy request timeout'))
    })

    req.write(Buffer.from(body))
    req.end()
  })
}

/**
 * Inference API routes
 */
export const createInferenceRoutes = () => {
  return new Elysia({
    prefix: '/chat',
  })
    .onError(safeErrorHandler)
    .post('/completions', async (ctx) => {
      const req = ctx.request
      const headerReq = req.clone()
      const enclaveUrl = headerReq.headers.get(EHBP_ENCLAVE_HEADER)
      const hasEhbpKey = headerReq.headers.get(EHBP_KEY_HEADER)
      const isEhbpRequest =
        typeof enclaveUrl === 'string' &&
        enclaveUrl.startsWith('https://') &&
        typeof hasEhbpKey === 'string' &&
        hasEhbpKey.length > 0
      if (isEhbpRequest) {
        return proxyEhbpRequest({ request: req }, enclaveUrl as string)
      }

      const body = await req.json()

      if (!body.stream) {
        throw new Error('Non-streaming requests are not supported')
      }

      const modelConfig = supportedModels[body.model]
      if (!modelConfig) {
        throw new Error('Model not found')
      }

      const { provider, internalName } = modelConfig

      const { client } = getInferenceClient(provider)

      console.info(`Routing model "${body.model}" to ${provider} provider`)

      try {
        const completion = await (client as PostHogOpenAI).chat.completions.create({
          model: internalName,
          messages: sanitizeMessageRoles(body.messages) as ChatCompletionMessageParam[],
          temperature: body.temperature,
          tools: body.tools,
          tool_choice: body.tool_choice,
          stream: true,
          ...(isPostHogConfigured() && {
            posthogProperties: {
              model_provider: provider,
              endpoint: '/chat/completions',
              has_tools: !!body.tools,
              temperature: body.temperature,
            },
          }),
        })

        const stream = createSSEStreamFromCompletion(completion as Stream<ChatCompletionChunk>, body.model)

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      } catch (error) {
        if (error instanceof APIConnectionError) {
          console.error('Failed to connect to inference provider', error.cause)
          throw new Error('Failed to connect to inference provider')
        }
        if (error instanceof APIConnectionTimeoutError) {
          console.error('Connection timeout to inference provider', error.cause)
          throw new Error('Connection timeout to inference provider')
        }
        throw error
      }
    })
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use createInferenceRoutes instead
 */
export const createOpenAIRoutes = createInferenceRoutes
