#!/usr/bin/env bun
/**
 * Sync local test cases to LangSmith as Datasets
 *
 * This script creates or updates datasets in LangSmith with our test cases.
 * Run this once to set up datasets, then run evaluations against them.
 *
 * Usage:
 *   bun run eval:sync              # Sync both datasets
 *   bun run eval:sync behavioral   # Sync only behavioral dataset
 *   bun run eval:sync quality      # Sync only quality dataset
 */

import { Client } from 'langsmith'
import { allBehavioralCases, type BehavioralCase } from './behavioral-datasets'
import { allQualityCases, type QualityCase } from './quality-datasets'
import { isLangSmithConfigured, getLangSmithProject } from '../client'

const BEHAVIORAL_DATASET_NAME = 'thunderbolt-behavioral-eval'
const BEHAVIORAL_DATASET_DESCRIPTION = 'Behavioral test cases: tool usage, formatting, search-first patterns'

const QUALITY_DATASET_NAME = 'thunderbolt-quality-eval'
const QUALITY_DATASET_DESCRIPTION = 'Quality test cases with reference answers for correctness evaluation'

/**
 * Convert behavioral test case to LangSmith example format
 */
const convertBehavioralToExample = (testCase: BehavioralCase) => {
  const userMessage = testCase.messages.filter((m) => m.role === 'user').pop()

  return {
    inputs: {
      question: userMessage?.content || '',
      messages: testCase.messages,
      test_case_id: testCase.id,
      test_case_name: testCase.name,
    },
    outputs: {
      // Expected behavior metadata (not ground truth answers)
      expected_behavior: testCase.expectedBehavior,
    },
    metadata: {
      id: testCase.id,
      name: testCase.name,
      description: testCase.description,
      tags: testCase.tags,
      type: 'behavioral',
    },
  }
}

/**
 * Convert quality test case to LangSmith example format
 */
const convertQualityToExample = (testCase: QualityCase) => {
  const userMessage = testCase.messages.filter((m) => m.role === 'user').pop()

  return {
    inputs: {
      question: userMessage?.content || '',
      messages: testCase.messages,
      test_case_id: testCase.id,
      test_case_name: testCase.name,
      category: testCase.category,
    },
    outputs: {
      // Reference answer for LLM-as-judge comparison
      reference_answer: testCase.referenceAnswer,
      evaluation_criteria: testCase.evaluationCriteria,
    },
    metadata: {
      id: testCase.id,
      name: testCase.name,
      description: testCase.description,
      tags: testCase.tags,
      category: testCase.category,
      type: 'quality',
    },
  }
}

/**
 * Sync a dataset to LangSmith
 */
const syncDatasetToLangSmith = async (
  client: Client,
  datasetName: string,
  datasetDescription: string,
  examples: Array<{
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
    metadata: Record<string, unknown>
  }>,
) => {
  let dataset

  try {
    dataset = await client.readDataset({ datasetName })
    console.log(`\n📂 Found existing dataset: ${datasetName}`)

    // Delete existing examples to replace them
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
    // Dataset doesn't exist, create it
    console.log(`\n📂 Creating new dataset: ${datasetName}`)
    dataset = await client.createDataset(datasetName, {
      description: datasetDescription,
    })
    console.log(`   Created dataset: ${dataset.id}`)
  }

  // Add all test cases as examples
  console.log('📝 Adding test cases...')
  await client.createExamples({
    datasetId: dataset.id,
    inputs: examples.map((e) => e.inputs),
    outputs: examples.map((e) => e.outputs),
    metadata: examples.map((e) => e.metadata),
  })

  console.log(`   Added ${examples.length} examples`)
  return dataset
}

/**
 * Main sync function
 */
const syncDatasets = async (target: 'all' | 'behavioral' | 'quality' = 'all') => {
  console.log('🔄 Syncing test cases to LangSmith...')
  console.log('=====================================')

  if (!isLangSmithConfigured()) {
    console.error('❌ LangSmith not configured. Set LANGSMITH_API_KEY and LANGSMITH_TRACING_ENABLED=true')
    process.exit(1)
  }

  const client = new Client()
  const project = getLangSmithProject()

  console.log(`Project: ${project}`)
  console.log(`Target: ${target}`)

  try {
    const results: { name: string; id: string; count: number }[] = []

    // Sync behavioral dataset
    if (target === 'all' || target === 'behavioral') {
      console.log(`\n━━━ Behavioral Dataset ━━━`)
      console.log(`Test cases: ${allBehavioralCases.length}`)

      const behavioralExamples = allBehavioralCases.map(convertBehavioralToExample)
      const behavioralDataset = await syncDatasetToLangSmith(
        client,
        BEHAVIORAL_DATASET_NAME,
        BEHAVIORAL_DATASET_DESCRIPTION,
        behavioralExamples,
      )
      results.push({
        name: BEHAVIORAL_DATASET_NAME,
        id: behavioralDataset.id,
        count: behavioralExamples.length,
      })
    }

    // Sync quality dataset
    if (target === 'all' || target === 'quality') {
      console.log(`\n━━━ Quality Dataset ━━━`)
      console.log(`Test cases: ${allQualityCases.length}`)

      const qualityExamples = allQualityCases.map(convertQualityToExample)
      const qualityDataset = await syncDatasetToLangSmith(
        client,
        QUALITY_DATASET_NAME,
        QUALITY_DATASET_DESCRIPTION,
        qualityExamples,
      )
      results.push({
        name: QUALITY_DATASET_NAME,
        id: qualityDataset.id,
        count: qualityExamples.length,
      })
    }

    // Summary
    console.log('\n✅ Sync complete!')
    console.log('=================')
    for (const r of results) {
      console.log(`\n${r.name}:`)
      console.log(`  Examples: ${r.count}`)
      console.log(`  URL: https://smith.langchain.com/datasets/${r.id}`)
    }

    console.log('\n📋 Next steps:')
    console.log('  bun run eval:behavioral   # Test behavioral patterns')
    console.log('  bun run eval:quality      # Test answer quality')
    console.log('  bun run eval:all          # Run both')
  } catch (error) {
    console.error('\n❌ Error syncing dataset:', error)
    process.exit(1)
  }
}

// Parse CLI argument
const target = process.argv[2] as 'all' | 'behavioral' | 'quality' | undefined
syncDatasets(target || 'all')
