/**
 * Token Efficiency Evaluator
 *
 * Checks if the response is appropriately sized - not too verbose, not too terse.
 * This is a heuristic evaluator (no LLM cost).
 */

import type { ConversationTrace, EvaluatorResult } from '../types'

// Character length guidelines (rough proxy for tokens, ~4 chars per token)
const LENGTH_GUIDELINES = {
  // Minimum lengths
  minForSimple: 50, // At least a sentence
  minForComplex: 200, // At least a paragraph

  // Ideal ranges
  idealMin: 100,
  idealMax: 2000,

  // Warning thresholds
  verboseThreshold: 4000, // Getting too long
  maxAllowed: 8000, // Too long, likely wasteful
}

/**
 * Detect query complexity based on keywords and structure
 */
const detectQueryComplexity = (query: string): 'simple' | 'moderate' | 'complex' => {
  const lowerQuery = query.toLowerCase()

  // Complex indicators
  const complexIndicators = [
    'compare',
    'analyze',
    'explain in detail',
    'comprehensive',
    'research',
    'investigate',
    'pros and cons',
    'advantages and disadvantages',
    'step by step',
    'how does',
    'why does',
    'what are the differences',
  ]

  // Simple indicators
  const simpleIndicators = ['what is', 'who is', 'when', 'where', 'define', 'name', 'list', 'how many', 'how much']

  const hasComplexIndicator = complexIndicators.some((ind) => lowerQuery.includes(ind))
  const hasSimpleIndicator = simpleIndicators.some((ind) => lowerQuery.includes(ind))

  if (hasComplexIndicator) return 'complex'
  if (hasSimpleIndicator && !hasComplexIndicator) return 'simple'
  return 'moderate'
}

/**
 * Evaluate token/response efficiency
 */
export const evaluateTokenEfficiency = (trace: ConversationTrace): EvaluatorResult => {
  const answer = trace.finalAnswer || ''
  const length = answer.length
  const complexity = detectQueryComplexity(trace.initialQuery)

  // No answer = fail
  if (length === 0) {
    return {
      score: 0,
      passed: false,
      reasoning: 'No response provided - cannot evaluate token efficiency',
      metadata: { length: 0, complexity },
    }
  }

  let score: number
  let reasoning: string

  // Check minimum length based on complexity
  const minRequired = complexity === 'simple' ? LENGTH_GUIDELINES.minForSimple : LENGTH_GUIDELINES.minForComplex

  if (length < minRequired) {
    score = 0.3 + (0.2 * length) / minRequired
    reasoning = `Response too brief (${length} chars) for ${complexity} query - expected at least ${minRequired} chars`
  } else if (length >= LENGTH_GUIDELINES.idealMin && length <= LENGTH_GUIDELINES.idealMax) {
    // Ideal range
    score = 1.0
    reasoning = `Good response length (${length} chars) - within ideal range for ${complexity} query`
  } else if (length > LENGTH_GUIDELINES.idealMax && length <= LENGTH_GUIDELINES.verboseThreshold) {
    // Slightly long but acceptable
    score = 0.8
    reasoning = `Response slightly long (${length} chars) but acceptable for ${complexity} query`
  } else if (length > LENGTH_GUIDELINES.verboseThreshold && length <= LENGTH_GUIDELINES.maxAllowed) {
    // Too verbose
    const excessRatio =
      (length - LENGTH_GUIDELINES.verboseThreshold) /
      (LENGTH_GUIDELINES.maxAllowed - LENGTH_GUIDELINES.verboseThreshold)
    score = 0.6 - 0.3 * excessRatio
    reasoning = `Response too verbose (${length} chars) - may be wasteful or unfocused`
  } else if (length > LENGTH_GUIDELINES.maxAllowed) {
    // Way too long
    score = 0.2
    reasoning = `Response excessively long (${length} chars) - likely contains unnecessary content`
  } else {
    // Between min and ideal min
    score = 0.7 + (0.3 * (length - minRequired)) / (LENGTH_GUIDELINES.idealMin - minRequired)
    reasoning = `Response acceptable length (${length} chars) for ${complexity} query`
  }

  // Estimate tokens (rough approximation)
  const estimatedTokens = Math.round(length / 4)

  return {
    score: Math.max(0, Math.min(1, score)),
    passed: score >= 0.7,
    reasoning,
    metadata: {
      length,
      estimatedTokens,
      complexity,
      idealRange: `${LENGTH_GUIDELINES.idealMin}-${LENGTH_GUIDELINES.idealMax}`,
    },
  }
}
