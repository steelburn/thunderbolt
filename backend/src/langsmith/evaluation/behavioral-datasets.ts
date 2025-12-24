/**
 * Behavioral evaluation datasets
 *
 * These test cases evaluate HOW the model behaves, not WHAT it answers:
 * - Tool invocation accuracy (when tools should/shouldn't be used)
 * - Response formatting compliance
 * - Search-first behavior for factual queries
 * - Response structure
 *
 * For answer correctness evaluation, see quality-datasets.ts
 */

export type BehavioralCase = {
  id: string
  name: string
  description: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  expectedBehavior: {
    shouldUseTools: boolean
    expectedToolCount?: { min?: number; max?: number }
    shouldAvoidTables: boolean
    shouldBeSearchFirst?: boolean
    maxResponseLength?: number
  }
  tags: string[]
}

/**
 * Test cases for tool invocation accuracy
 */
export const toolInvocationCases: BehavioralCase[] = [
  {
    id: 'beh-tool-001',
    name: 'Current weather query',
    description: 'User asks about current weather - should use tools',
    messages: [{ role: 'user', content: "What's the weather like in San Francisco right now?" }],
    expectedBehavior: {
      shouldUseTools: true,
      expectedToolCount: { min: 1, max: 3 },
      shouldAvoidTables: true,
      shouldBeSearchFirst: true,
    },
    tags: ['weather', 'current-info', 'tool-required'],
  },
  {
    id: 'beh-tool-002',
    name: 'Simple math calculation',
    description: 'User asks for math - should NOT use tools',
    messages: [{ role: 'user', content: 'What is 15% of 250?' }],
    expectedBehavior: {
      shouldUseTools: false,
      shouldAvoidTables: true,
    },
    tags: ['math', 'no-tools'],
  },
  {
    id: 'beh-tool-003',
    name: 'Current news query',
    description: 'User asks about recent news - should use search tools',
    messages: [{ role: 'user', content: 'What are the top news stories today?' }],
    expectedBehavior: {
      shouldUseTools: true,
      expectedToolCount: { min: 1, max: 5 },
      shouldAvoidTables: true,
      shouldBeSearchFirst: true,
    },
    tags: ['news', 'current-info', 'tool-required'],
  },
  {
    id: 'beh-tool-004',
    name: 'Code generation',
    description: 'User asks for code help - should NOT use search tools',
    messages: [{ role: 'user', content: 'Write a Python function that reverses a string' }],
    expectedBehavior: {
      shouldUseTools: false,
      shouldAvoidTables: true,
    },
    tags: ['code', 'no-tools'],
  },
  {
    id: 'beh-tool-005',
    name: 'Product recommendation',
    description: 'User asks for product recommendations - should search',
    messages: [{ role: 'user', content: 'What are the best wireless earbuds under $100?' }],
    expectedBehavior: {
      shouldUseTools: true,
      expectedToolCount: { min: 2, max: 6 },
      shouldAvoidTables: true,
      shouldBeSearchFirst: true,
    },
    tags: ['products', 'recommendations', 'tool-required'],
  },
]

/**
 * Test cases for response formatting compliance
 */
export const formattingCases: BehavioralCase[] = [
  {
    id: 'beh-fmt-001',
    name: 'Simple factual question',
    description: 'Response should be concise, no tables',
    messages: [{ role: 'user', content: 'Who is the CEO of Apple?' }],
    expectedBehavior: {
      shouldUseTools: true,
      shouldAvoidTables: true,
      maxResponseLength: 500,
    },
    tags: ['factual', 'concise'],
  },
  {
    id: 'beh-fmt-002',
    name: 'Comparison request',
    description: 'Tables may be appropriate for comparisons',
    messages: [{ role: 'user', content: 'Compare the specs of iPhone 15 vs Samsung S24' }],
    expectedBehavior: {
      shouldUseTools: true,
      shouldAvoidTables: false, // Tables OK for spec comparisons
    },
    tags: ['comparison', 'products'],
  },
  {
    id: 'beh-fmt-003',
    name: 'Brief explanation request',
    description: 'Should give concise answer without over-explaining',
    messages: [{ role: 'user', content: 'What does API stand for?' }],
    expectedBehavior: {
      shouldUseTools: false,
      shouldAvoidTables: true,
      maxResponseLength: 300,
    },
    tags: ['definition', 'concise'],
  },
]

/**
 * Test cases for search-first behavior
 */
export const searchFirstCases: BehavioralCase[] = [
  {
    id: 'beh-search-001',
    name: 'Software version query',
    description: 'Should search for current version info',
    messages: [{ role: 'user', content: "What's the latest version of Node.js?" }],
    expectedBehavior: {
      shouldUseTools: true,
      shouldBeSearchFirst: true,
      shouldAvoidTables: true,
    },
    tags: ['software', 'version', 'search-required'],
  },
  {
    id: 'beh-search-002',
    name: 'Historical fact',
    description: 'May not need search for well-established facts',
    messages: [{ role: 'user', content: 'When did World War II end?' }],
    expectedBehavior: {
      shouldUseTools: false, // Historical facts are stable
      shouldAvoidTables: true,
    },
    tags: ['history', 'factual'],
  },
  {
    id: 'beh-search-003',
    name: 'Current event query',
    description: 'Should definitely search for current events',
    messages: [{ role: 'user', content: 'What happened in the stock market today?' }],
    expectedBehavior: {
      shouldUseTools: true,
      shouldBeSearchFirst: true,
      shouldAvoidTables: true,
    },
    tags: ['finance', 'current-info', 'search-required'],
  },
]

/**
 * Test cases for multi-turn conversations and complex research tasks
 */
export const complexResearchCases: BehavioralCase[] = [
  {
    id: 'beh-research-001',
    name: 'IPO document discovery',
    description: 'User asks where to find IPO filing documents - requires search for SEC/regulatory info',
    messages: [
      {
        role: 'user',
        content:
          'Equipment Share (the company) is planning to go public. Where can I find the documents they have to publish to do so?',
      },
    ],
    expectedBehavior: {
      shouldUseTools: true,
      expectedToolCount: { min: 1, max: 5 },
      shouldBeSearchFirst: true,
      shouldAvoidTables: true,
    },
    tags: ['finance', 'ipo', 'search-required', 'research'],
  },
  {
    id: 'beh-research-002',
    name: 'IPO document analysis follow-up',
    description: 'Multi-turn: user asks for analysis of IPO documents after finding them',
    messages: [
      {
        role: 'user',
        content:
          'Equipment Share (the company) is planning to go public. Where can I find the documents they have to publish to do so?',
      },
      {
        role: 'assistant',
        content:
          'For EquipmentShare\'s IPO, you can find their required SEC filings on the SEC\'s EDGAR database (sec.gov/edgar). Companies planning to go public must file an S-1 Registration Statement, which includes their prospectus with detailed financial information, business model, risk factors, and use of proceeds. You can search for "EquipmentShare" on EDGAR to find their filings once submitted.',
      },
      {
        role: 'user',
        content: "Please review them and share your thoughts on the company's health.",
      },
    ],
    expectedBehavior: {
      shouldUseTools: true,
      expectedToolCount: { min: 2, max: 8 },
      shouldBeSearchFirst: true,
      shouldAvoidTables: false,
    },
    tags: ['finance', 'ipo', 'search-required', 'research', 'analysis', 'multi-turn'],
  },
]

/**
 * All behavioral evaluation cases combined
 */
export const allBehavioralCases: BehavioralCase[] = [
  ...toolInvocationCases,
  ...formattingCases,
  ...searchFirstCases,
  ...complexResearchCases,
]

/**
 * Get behavioral cases by tag
 */
export const getBehavioralCasesByTag = (tag: string): BehavioralCase[] =>
  allBehavioralCases.filter((c) => c.tags.includes(tag))

/**
 * Get behavioral cases by expected tool usage
 */
export const getBehavioralCasesByToolExpectation = (shouldUseTools: boolean): BehavioralCase[] =>
  allBehavioralCases.filter((c) => c.expectedBehavior.shouldUseTools === shouldUseTools)
