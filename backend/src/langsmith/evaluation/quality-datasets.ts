/**
 * Quality evaluation datasets
 *
 * These test cases evaluate WHAT the model answers:
 * - Factual correctness (against reference answers)
 * - Helpfulness and completeness
 * - Conciseness and clarity
 *
 * Each case includes a reference answer for LLM-as-judge evaluation.
 * For behavioral evaluation (tool usage, formatting), see behavioral-datasets.ts
 */

export type QualityCase = {
  id: string
  name: string
  description: string
  category: 'factual' | 'reasoning' | 'creative' | 'technical' | 'research'
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  referenceAnswer: string
  evaluationCriteria: {
    /** Key facts that MUST be present in the answer */
    requiredFacts?: string[]
    /** Facts that should NOT be present (outdated/wrong info) */
    forbiddenFacts?: string[]
    /** Whether the answer requires current/real-time information */
    requiresCurrentInfo: boolean
    /** Acceptable answer length range */
    lengthGuidance?: 'brief' | 'moderate' | 'detailed'
  }
  tags: string[]
}

/**
 * Factual knowledge questions with verifiable answers
 */
export const factualCases: QualityCase[] = [
  {
    id: 'qual-fact-001',
    name: 'Company CEO identification',
    description: 'Simple factual question about a company executive',
    category: 'factual',
    messages: [{ role: 'user', content: 'Who is the CEO of Apple?' }],
    referenceAnswer:
      'Tim Cook is the CEO of Apple. He has held this position since August 2011, succeeding Steve Jobs.',
    evaluationCriteria: {
      requiredFacts: ['Tim Cook', 'CEO'],
      requiresCurrentInfo: true,
      lengthGuidance: 'brief',
    },
    tags: ['business', 'leadership', 'factual'],
  },
  {
    id: 'qual-fact-002',
    name: 'Historical date',
    description: 'Question about a well-established historical fact',
    category: 'factual',
    messages: [{ role: 'user', content: 'When did World War II end?' }],
    referenceAnswer:
      "World War II ended in 1945. In Europe, it ended on May 8, 1945 (V-E Day) with Germany's surrender. In the Pacific, it ended on September 2, 1945 (V-J Day) with Japan's formal surrender.",
    evaluationCriteria: {
      requiredFacts: ['1945', 'September', 'Japan'],
      requiresCurrentInfo: false,
      lengthGuidance: 'brief',
    },
    tags: ['history', 'factual'],
  },
  {
    id: 'qual-fact-003',
    name: 'Technical acronym',
    description: 'Definition of a common technical term',
    category: 'technical',
    messages: [{ role: 'user', content: 'What does API stand for?' }],
    referenceAnswer:
      'API stands for Application Programming Interface. It is a set of protocols, routines, and tools that allow different software applications to communicate with each other.',
    evaluationCriteria: {
      requiredFacts: ['Application Programming Interface'],
      requiresCurrentInfo: false,
      lengthGuidance: 'brief',
    },
    tags: ['technical', 'definition'],
  },
  {
    id: 'qual-fact-004',
    name: 'Scientific fact',
    description: 'Basic scientific knowledge question',
    category: 'factual',
    messages: [{ role: 'user', content: 'What is the speed of light?' }],
    referenceAnswer:
      'The speed of light in a vacuum is approximately 299,792,458 meters per second (about 300,000 km/s or 186,000 miles per second). This is denoted by the constant "c" in physics.',
    evaluationCriteria: {
      requiredFacts: ['299,792,458', 'meters per second'],
      requiresCurrentInfo: false,
      lengthGuidance: 'brief',
    },
    tags: ['science', 'physics', 'factual'],
  },
]

/**
 * Reasoning and analysis questions
 */
export const reasoningCases: QualityCase[] = [
  {
    id: 'qual-reason-001',
    name: 'Simple math problem',
    description: 'Basic arithmetic that requires correct calculation',
    category: 'reasoning',
    messages: [{ role: 'user', content: 'What is 15% of 250?' }],
    referenceAnswer: '15% of 250 is 37.5. This is calculated by multiplying 250 by 0.15.',
    evaluationCriteria: {
      requiredFacts: ['37.5'],
      requiresCurrentInfo: false,
      lengthGuidance: 'brief',
    },
    tags: ['math', 'calculation'],
  },
  {
    id: 'qual-reason-002',
    name: 'Logical deduction',
    description: 'Question requiring step-by-step reasoning',
    category: 'reasoning',
    messages: [
      {
        role: 'user',
        content:
          'If all roses are flowers, and some flowers fade quickly, can we conclude that some roses fade quickly?',
      },
    ],
    referenceAnswer:
      'No, we cannot conclude that some roses fade quickly. This is a logical fallacy. While all roses are flowers, the flowers that fade quickly might not include any roses. The statement "some flowers fade quickly" doesn\'t specify which flowers, so roses might be among the flowers that don\'t fade quickly.',
    evaluationCriteria: {
      requiredFacts: ['No', 'cannot conclude', 'fallacy'],
      requiresCurrentInfo: false,
      lengthGuidance: 'moderate',
    },
    tags: ['logic', 'reasoning'],
  },
  {
    id: 'qual-reason-003',
    name: 'Comparison analysis',
    description: 'Analyzing pros and cons of two options',
    category: 'reasoning',
    messages: [
      {
        role: 'user',
        content: 'What are the main differences between Python and JavaScript for backend development?',
      },
    ],
    referenceAnswer:
      'Key differences: (1) Runtime: Python runs on CPython/PyPy, JavaScript on Node.js/Deno. (2) Syntax: Python uses indentation, JavaScript uses braces. (3) Concurrency: Python has GIL limitations, Node.js excels at async I/O. (4) Ecosystem: Python strong in data science/ML (Django, Flask), JavaScript in real-time apps (Express, Fastify). (5) Type systems: Both have optional typing (Python type hints, TypeScript).',
    evaluationCriteria: {
      requiredFacts: ['Node.js', 'async', 'Django', 'Express'],
      requiresCurrentInfo: false,
      lengthGuidance: 'moderate',
    },
    tags: ['programming', 'comparison', 'technical'],
  },
]

/**
 * Technical questions requiring accurate code or explanations
 */
export const technicalCases: QualityCase[] = [
  {
    id: 'qual-tech-001',
    name: 'Code implementation',
    description: 'Request for a specific code solution',
    category: 'technical',
    messages: [{ role: 'user', content: 'Write a Python function that reverses a string' }],
    referenceAnswer: `def reverse_string(s: str) -> str:
    return s[::-1]

# Alternative implementation:
def reverse_string_loop(s: str) -> str:
    result = ""
    for char in s:
        result = char + result
    return result`,
    evaluationCriteria: {
      requiredFacts: ['def', 'return', '[::-1]'],
      requiresCurrentInfo: false,
      lengthGuidance: 'moderate',
    },
    tags: ['code', 'python', 'technical'],
  },
  {
    id: 'qual-tech-002',
    name: 'Technical concept explanation',
    description: 'Explaining a programming concept clearly',
    category: 'technical',
    messages: [{ role: 'user', content: 'Explain what a closure is in JavaScript' }],
    referenceAnswer:
      'A closure in JavaScript is a function that has access to variables from its outer (enclosing) scope, even after the outer function has returned. Closures "close over" these variables, preserving them. Example: a function inside another function can access the outer function\'s variables even when called later.',
    evaluationCriteria: {
      requiredFacts: ['outer', 'scope', 'access', 'variables'],
      requiresCurrentInfo: false,
      lengthGuidance: 'moderate',
    },
    tags: ['javascript', 'concept', 'technical'],
  },
]

/**
 * Research questions requiring current information
 */
export const researchCases: QualityCase[] = [
  {
    id: 'qual-research-001',
    name: 'Current software version',
    description: 'Question requiring up-to-date information lookup',
    category: 'research',
    messages: [{ role: 'user', content: "What's the latest LTS version of Node.js?" }],
    referenceAnswer:
      'The latest LTS (Long Term Support) version of Node.js should be looked up from the official Node.js website (nodejs.org) as it changes over time. As of late 2024, Node.js 20.x is the active LTS line.',
    evaluationCriteria: {
      requiredFacts: ['LTS', 'nodejs.org'],
      requiresCurrentInfo: true,
      lengthGuidance: 'brief',
    },
    tags: ['software', 'current-info', 'research'],
  },
  {
    id: 'qual-research-002',
    name: 'IPO filing information',
    description: 'Research question about regulatory filings',
    category: 'research',
    messages: [
      {
        role: 'user',
        content:
          'A company is planning to go public. Where can I find the documents they need to publish for their IPO?',
      },
    ],
    referenceAnswer:
      "IPO documents are filed with the SEC (Securities and Exchange Commission) and available on the EDGAR database at sec.gov/edgar. The key document is the S-1 Registration Statement, which includes the prospectus with financial information, business model, risk factors, management details, and use of proceeds. You can search for specific companies on EDGAR once they've filed.",
    evaluationCriteria: {
      requiredFacts: ['SEC', 'EDGAR', 'S-1', 'Registration Statement'],
      requiresCurrentInfo: false,
      lengthGuidance: 'moderate',
    },
    tags: ['finance', 'ipo', 'regulatory', 'research'],
  },
]

/**
 * All quality evaluation cases combined
 */
export const allQualityCases: QualityCase[] = [...factualCases, ...reasoningCases, ...technicalCases, ...researchCases]

/**
 * Get quality cases by category
 */
export const getQualityCasesByCategory = (category: QualityCase['category']): QualityCase[] =>
  allQualityCases.filter((c) => c.category === category)

/**
 * Get quality cases by tag
 */
export const getQualityCasesByTag = (tag: string): QualityCase[] => allQualityCases.filter((c) => c.tags.includes(tag))

/**
 * Get quality cases that require current information (need search)
 */
export const getQualityCasesRequiringCurrentInfo = (): QualityCase[] =>
  allQualityCases.filter((c) => c.evaluationCriteria.requiresCurrentInfo)
