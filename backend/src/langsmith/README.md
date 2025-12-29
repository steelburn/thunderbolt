# LangSmith Integration for Thunderbolt

This module provides LangSmith-specific integrations for tracing and online evaluation.

> **📦 Evaluation System Moved!**
>
> The evaluation framework has been moved to a new, provider-agnostic architecture at:
>
> **`src/evaluation/`**
>
> See [`src/evaluation/README.md`](../evaluation/README.md) for:
>
> - Quick start commands
> - Adding new evaluators
> - Adding new providers
> - Architecture documentation

## What's Here

| File                   | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `client.ts`            | LangSmith client configuration and helpers         |
| `tracing.ts`           | Trace helpers for inference calls                  |
| `streaming.ts`         | Traced streaming for chat completions              |
| `online-evaluation.ts` | Automatic evaluation on sampled production traffic |
| `dashboard.ts`         | Metrics dashboard and API routes                   |

## Quick Start

### 1. Set up environment variables

Add to `.env`:

```bash
# Required
LANGSMITH_API_KEY="lsv2_..."
LANGSMITH_TRACING_ENABLED="true"

# Optional
LANGSMITH_PROJECT="thunderbolt"
LANGSMITH_SAMPLING_RATE="1.0"
```

### 2. Run evaluations

```bash
# Make sure backend is running
bun run dev

# In another terminal - use the new evaluation framework:
bun run eval behavioral --provider langsmith
bun run eval quality --provider langsmith
bun run eval traces --provider langsmith --limit 50

# See all options
bun run eval --help
```

---

## Online Evaluation (Production Sampling)

Automatic evaluation runs on sampled production traffic. This is different from the CLI-based evaluation framework - it evaluates live requests in real-time.

### Configuration

```typescript
import { configureOnlineEvaluation } from '@/langsmith'

configureOnlineEvaluation({
  samplingRate: 0.1, // Evaluate 10% of requests
  useLLMJudge: false, // Disable for cost savings in prod
})
```

### Dashboard

Available at `/v1/eval/dashboard` when the server is running.

| Endpoint                 | Description         |
| ------------------------ | ------------------- |
| `GET /v1/eval/dashboard` | HTML dashboard      |
| `GET /v1/eval/metrics`   | Metrics JSON        |
| `GET /v1/eval/health`    | Health check        |
| `GET /v1/eval/debug`     | Debug configuration |

---

## Environment Variables Reference

| Variable                    | Default       | Description                   |
| --------------------------- | ------------- | ----------------------------- |
| `LANGSMITH_API_KEY`         | (required)    | Your LangSmith API key        |
| `LANGSMITH_PROJECT`         | `thunderbolt` | Project name in LangSmith     |
| `LANGSMITH_TRACING_ENABLED` | `false`       | Enable automatic tracing      |
| `LANGSMITH_SAMPLING_RATE`   | `1.0`         | Fraction of requests to trace |

---

## Troubleshooting

### "LangSmith not configured"

Check your `.env` has:

```bash
LANGSMITH_API_KEY="lsv2_..."
LANGSMITH_TRACING_ENABLED="true"
```

### Tracing not working

Ensure the backend is running and check the logs for LangSmith-related errors.

---

## See Also

- **[Evaluation Framework](../evaluation/README.md)** - CLI-based evaluation system
- **[LangSmith Docs](https://docs.smith.langchain.com/)** - Official LangSmith documentation
