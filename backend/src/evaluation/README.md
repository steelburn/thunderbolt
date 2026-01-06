# LLM Evaluation & Red Teaming with Promptfoo

This directory contains Promptfoo configurations for evaluating and testing the Thunderbolt LLM backend.

## Quick Start

```bash
# 1. Start the backend
cd backend && bun run dev

# 2. Run evaluations
bun run eval:quality      # Answer correctness (includes tool usage)
bun run eval:behavioral   # Response behavior (tone, safety, formatting)
bun run eval              # All tests

# 3. View results
bun run eval:view         # Opens http://localhost:15500
```

## Test Organization

### Quality Tests (`quality.yaml`) - 19 tests

Tests **answer correctness**, including whether tools are used appropriately:

| Category           | Tests                                         | Tool Usage           |
| ------------------ | --------------------------------------------- | -------------------- |
| **Real-time Info** | Weather, news, stocks, versions, sports       | MUST use tools       |
| **Factual**        | CEO, historical dates, constants, definitions | Tools optional       |
| **Reasoning**      | Math, logic, word problems                    | Should NOT use tools |
| **Technical**      | Code, concepts, comparisons                   | Should NOT use tools |
| **Hallucination**  | Future predictions, subjective questions      | N/A                  |
| **Instruction**    | Count constraints, length limits              | N/A                  |

### Behavioral Tests (`behavioral.yaml`) - 18 tests

Tests **response behavior**, not answer content:

| Category        | Tests                               | What it evaluates         |
| --------------- | ----------------------------------- | ------------------------- |
| **Tone**        | Greetings, professional, empathy    | Appropriate style         |
| **Formatting**  | Conciseness, lists, avoiding tables | Structure choices         |
| **Language**    | Spanish, French, Portuguese         | Matching query language   |
| **Safety**      | Hacking, malware, drugs, self-harm  | Refusing harmful requests |
| **Context**     | Ambiguity, incomplete info          | Handling uncertainty      |
| **Calibration** | Predictions, medical limits         | Knowing boundaries        |

### Red Team Tests (`redteam.yaml`)

Security testing against **OWASP LLM Top 10** vulnerabilities.

## Running Tests for Specific Models

By default, tests run against all 4 models. To test a specific model:

```bash
# Test only gpt-oss-120b
bun run eval:quality -- --filter-providers gpt-oss

# Test only sonnet-4.5
bun run eval:behavioral -- --filter-providers sonnet

# Test Mistral models
bun run eval:quality -- --filter-providers mistral
```

## Output Format

Each evaluation response includes structured data:

```
TOOLS_CALLED: YES
TOOL_NAMES: weather_search, web_search
TOOL_DETAILS:
- weather_search({"location": "Paris"})

RESPONSE:
[The actual model response]
```

This enables evaluating:

1. **Whether tools were called** when they should be
2. **The quality/behavior** of the response

## CLI Reference

```bash
# Basic commands
bun run eval              # All tests, all models
bun run eval:quality      # Quality tests only
bun run eval:behavioral   # Behavioral tests only
bun run eval:redteam      # Red team security tests
bun run eval:view         # View results in browser
bun run eval:share        # Share results (optional)

# Filter by model
--filter-providers <pattern>   # Regex match on provider label

# Filter by test count
--filter-first-n <number>      # Run only first N tests

# Output options
--output <path>                # Save to file (csv, json, html)
```

## Debugging Tool Calling Issues

If a model isn't calling tools for real-time queries:

```bash
# 1. Run quality tests on specific model
bun run eval:quality -- --filter-providers gpt-oss

# 2. Check output for TOOLS_CALLED: NO on real-time tests
#    Weather, news, stock tests should show TOOLS_CALLED: YES

# 3. Compare across models
bun run eval:quality -- --filter-first-n 5
```

## Environment Variables

**Required:**

- `ANTHROPIC_API_KEY` - For LLM-as-judge evaluations

**Backend Requirements:**

- Backend running on `http://localhost:8000`
- Backend API keys configured for tested models

## Files

| File                   | Purpose                              |
| ---------------------- | ------------------------------------ |
| `promptfooconfig.yaml` | Providers, SSE parsing, judge config |
| `quality.yaml`         | Answer correctness tests             |
| `behavioral.yaml`      | Response behavior tests              |
| `redteam.yaml`         | Security/adversarial tests           |
