# Evaluation Framework Research

This document captures the research, decisions, and rationale behind the evaluation framework architecture.

## Purpose

The evaluation framework enables systematic testing and quality assurance of LLM responses. It supports:

1. **Behavioral Testing** - Validates HOW the model behaves (tool usage, formatting, search-first patterns)
2. **Quality Testing** - Validates WHAT the model answers (accuracy, faithfulness, hallucination detection)
3. **Trace Evaluation** - Evaluates production data without re-executing the model

The framework is designed to be **provider-agnostic**, allowing integration with different observability and evaluation platforms.

---

## Implemented Providers

### 1. Console Provider

**Status**: ✅ Implemented

The simplest provider - outputs results to terminal only. Always available, no configuration required.

**Use Cases**:

- Local development
- CI/CD pipelines
- Quick validation

**Capabilities**:
| Feature | Supported |
|---------|-----------|
| Output results | ✅ |
| Fetch traces | ❌ |
| Store scores | ❌ |
| Create experiments | ❌ |

---

### 2. LangSmith Provider

**Status**: ✅ Implemented

Full integration with LangChain's observability platform.

**API Used**:

- `langsmith` SDK (TypeScript)
- `langsmith/evaluation` for native experiment tracking

**Capabilities**:
| Feature | Supported | API |
|---------|-----------|-----|
| Output results | ✅ | Console |
| Fetch traces | ✅ | `client.listRuns()` |
| Store scores | ✅ | `client.createFeedback()` |
| Create experiments | ✅ | `evaluate()` from langsmith/evaluation |
| Dataset sync | ✅ | `client.createDataset()` |

**Key Implementation Details**:

- Uses `evaluate()` function for automatic experiment creation and tracking
- Attaches feedback scores to existing runs via `createFeedback()`
- Filters traces by metadata to exclude evaluation runs from production data
- Source tagging via `extra.metadata.source` field

---

### 3. Helicone Provider

**Status**: ✅ Implemented

Integration with Helicone's open-source observability platform.

**API Used**:

- REST API (no official SDK)
- `POST /v1/request/query` - Fetch traces
- `POST /v1/request/{requestId}/score` - Attach scores

**Capabilities**:
| Feature | Supported | API |
|---------|-----------|-----|
| Output results | ✅ | Console |
| Fetch traces | ✅ | `POST /v1/request/query` |
| Store scores | ✅ | `POST /v1/request/{id}/score` |
| Create experiments | ❌ | Not available via API |
| Dataset sync | ❌ | Via UI only |

**Key Implementation Details**:

- Uses REST API directly (no SDK dependency)
- Scores attached to original requests in Helicone dashboard
- Filtering by properties for source tagging
- Open-source platform (can be self-hosted)

**Important Limitation**:
Helicone provider only works for **trace evaluation** (evaluating existing production data).
For `behavioral` or `quality` evaluations that execute the model fresh, Helicone outputs
to console only - there are no pre-existing requests to attach scores to. Use LangSmith
for full experiment tracking with fresh evaluations.

**Helicone Proxy Integration (Observability)**:
The backend can route LLM requests through Helicone proxy for observability. When `HELICONE_API_KEY`
is set, supported providers automatically route through Helicone:

| Provider    | Base URL                        | Helicone Proxy              |
| ----------- | ------------------------------- | --------------------------- |
| Mistral     | `api.mistral.ai/v1`             | `mistral.helicone.ai/v1`    |
| Anthropic   | `api.anthropic.com/v1/`         | `anthropic.helicone.ai/v1/` |
| Fireworks   | `api.fireworks.ai/inference/v1` | ❌ No proxy available       |
| Thunderbolt | Internal URL                    | ❌ Not applicable           |

This enables Helicone trace evaluation on production user conversations.

---

## Providers NOT Implemented

### PromptLayer

**Status**: ❌ Not Recommended

**What It Is**: PromptLayer is a prompt management and versioning platform focused on prompt engineering workflows.

**Why Not Implemented**:

1. **No Trace Fetching API**
   - PromptLayer focuses on prompt history, not request/response observability
   - No equivalent to `listRuns()` or `/v1/request/query`
   - Cannot fetch production conversations for offline evaluation

2. **Evaluation Paradigm Mismatch**
   - PromptLayer's evaluation is UI-driven, not API-driven
   - Designed for human annotation of prompt outputs
   - No programmatic `createFeedback()` or scoring API

3. **Limited Integration Points**

   ```
   Our Architecture:
   fetchTraces() → evaluators → attachScores()

   PromptLayer:
   ❌ No fetchTraces() equivalent
   ⚠️ Score API exists but different paradigm
   ```

4. **Primary Use Case Mismatch**
   - PromptLayer: Prompt versioning and A/B testing
   - Our Need: Production trace evaluation and quality assurance

**Conclusion**: PromptLayer is excellent for prompt management but lacks the observability foundation required for our trace evaluation workflow.

---

### Promptfoo

**Status**: ❌ Not Suitable (Different Purpose)

**What It Is**: Promptfoo is an open-source CLI tool for local LLM testing, evaluation, and red-teaming.

**Why Not Implemented**:

1. **Local-Only Evaluation**
   - Promptfoo runs evaluations locally via CLI
   - No cloud dashboard or centralized results storage
   - Results are file-based (JSON, CSV) or local web UI

2. **No Observability Features**
   - No trace collection from production
   - No `fetchTraces()` capability
   - Designed for pre-deployment testing, not post-deployment monitoring

3. **Different Evaluation Model**

   ```
   Promptfoo Model:
   YAML config → Local execution → Local results

   Our Model:
   Production traces → Evaluators → Provider dashboard
   ```

4. **Overlapping Functionality**
   - Promptfoo's evaluator system overlaps with our `evaluators/` directory
   - We already have heuristic and LLM-as-judge evaluators
   - Adding Promptfoo would duplicate functionality without adding value

5. **No Score Attachment**
   - Cannot attach scores to existing production runs
   - Results are standalone, not linked to original requests

**Potential Future Use**: Promptfoo could be useful as a **local testing tool** during development (pre-commit checks, CI/CD), but it doesn't fit our provider architecture which requires:

- Remote trace fetching
- Score attachment to original runs
- Centralized result viewing

**Conclusion**: Promptfoo is a great tool for local LLM testing but fundamentally different from our observability-focused evaluation needs.

---

## Provider Comparison Matrix

| Feature                   | Console | LangSmith  | Helicone    | PromptLayer | Promptfoo  |
| ------------------------- | ------- | ---------- | ----------- | ----------- | ---------- |
| **Type**                  | Output  | Cloud      | Cloud (OSS) | Cloud       | Local CLI  |
| **Trace Fetching**        | ❌      | ✅         | ✅          | ❌          | ❌         |
| **Score Attachment**      | ❌      | ✅         | ✅          | ⚠️          | ❌         |
| **Experiments**           | ❌      | ✅         | ❌          | ❌          | ✅ (local) |
| **Dataset Sync**          | ❌      | ✅         | ❌          | ⚠️          | ✅ (local) |
| **SDK**                   | N/A     | TypeScript | REST        | TypeScript  | CLI/YAML   |
| **Self-Hostable**         | N/A     | ❌         | ✅          | ❌          | ✅         |
| **Implementation Status** | ✅      | ✅         | ✅          | ❌          | ❌         |

---

## Architecture Decisions

### 1. Session/Conversation Tracking

**Decision**: Track multi-turn conversations using provider-specific session mechanisms.

**Rationale**:

- Evaluating single messages out of context is meaningless
- Conversations reveal model behavior patterns over time
- Both LangSmith and Helicone support session grouping

**Implementation**:
| Provider | Mechanism | Headers |
|----------|-----------|---------|
| LangSmith | `session_id` in metadata | N/A (SDK) |
| Helicone | Session headers | `Helicone-Session-Id`, `Helicone-Session-Path`, `Helicone-Session-Name` |

**Client Requirements**:

- Frontend must pass `X-Conversation-Id` header with each request
- Optional `X-Turn-Number` header for turn ordering (defaults to 1)

```typescript
// Example client usage
fetch('/v1/chat/completions', {
  headers: {
    'X-Conversation-Id': 'uuid-of-conversation',
    'X-Turn-Number': '3',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ model: 'sonnet-4.5', messages: [...] }),
})
```

### 2. Provider Registry Pattern

**Decision**: Use a declarative registry for provider configuration.

**Rationale**:

- Explicit provider selection (no "smart defaults")
- Easy to add new providers
- Clear environment variable requirements
- CLI integration via `--list-providers`

```typescript
// registry.ts
{
  name: 'helicone',
  description: 'Helicone for observability and trace evaluation',
  requiredEnv: 'HELICONE_API_KEY',
  create: (opts) => new HeliconeProvider(opts),
}
```

### 2. Source Tagging

**Decision**: Tag all traces with source metadata to distinguish production vs evaluation data.

**Rationale**:

- Prevents evaluation runs from polluting production analytics
- Enables filtered trace fetching
- Works across providers (metadata storage varies)

**Implementation**:
| Provider | Storage Location |
|----------|------------------|
| LangSmith | `extra.metadata.source` |
| Helicone | `properties.source` |

### 3. Offline Executor

**Decision**: Create a dedicated executor for evaluating existing traces without re-execution.

**Rationale**:

- Production traces already have responses
- Re-execution wastes compute and money
- Enables evaluation of historical data

```typescript
// Offline executor returns existing data, no API call
execute(input: OfflineInput) {
  return {
    output: input.existingOutput,
    latencyMs: input.latencyMs,
  }
}
```

### 4. Two Trace Evaluation Modes

**Decision**: Support both "feedback mode" and "experiment mode" for trace evaluation.

**Rationale**:

- **Feedback Mode** (`eval traces`): Annotates original runs, no experiment created
- **Experiment Mode** (`eval quality --from-traces`): Creates proper experiment for comparison

**Use Cases**:

- Feedback mode: Quick quality checks, annotating production data
- Experiment mode: Formal evaluation with full suite, model comparison

---

## Considerations

### Why Not a Universal Adapter?

We considered creating a universal adapter that abstracts all providers behind a single interface. This was rejected because:

1. **Provider capabilities vary significantly** - LangSmith has experiments, Helicone doesn't
2. **API semantics differ** - Some use SDKs, others REST
3. **The Provider interface already abstracts** - Optional methods handle capability differences

### Future Provider Candidates

If we expand provider support, consider:

1. **Weights & Biases (W&B)** - Has trace support via Weave
2. **Arize Phoenix** - Open-source observability with evaluation
3. **Braintrust** - Evaluation-focused platform

### SDK vs REST

**LangSmith**: Uses official SDK

- Pro: Type safety, maintained by LangChain
- Con: Dependency overhead

**Helicone**: Uses REST API directly

- Pro: No dependencies, simpler
- Con: Manual type definitions

**Recommendation**: Prefer REST for simpler providers, SDK when it provides significant value (like LangSmith's `evaluate()` function).

---

## References

### Documentation Consulted

- [LangSmith Evaluation Docs](https://docs.smith.langchain.com/evaluation)
- [LangSmith SDK (langsmith)](https://github.com/langchain-ai/langsmith-sdk)
- [Helicone API Reference](https://docs.helicone.ai)
- [Promptfoo Documentation](https://promptfoo.dev)
- [PromptLayer Documentation](https://docs.promptlayer.com)

### Key API Endpoints

**LangSmith**:

- `client.listRuns()` - Fetch traces
- `client.createFeedback()` - Attach scores
- `evaluate()` from `langsmith/evaluation` - Run experiments

**Helicone**:

- `POST /v1/request/query` - Fetch traces
- `POST /v1/request/{id}/score` - Attach scores
