# Thunderbolt Backend

This repository contains the backend service for the Thunderbolt project. It is built using FastAPI and provides a unified proxy interface for accessing various APIs including OpenAI-compatible language models.

## Features

- Exposes OpenAI-compatible proxy endpoints at `/openai/*` for language model interactions
- Generic proxy system for external APIs with authentication handling
- Support for streaming responses (SSE) for chat completions
- CORS support for frontend integration

## Installation

1. Install dependencies using uv:

```bash
uv sync
```

2. Create a `.env` file with your API keys:

```bash
DEEPINFRA_API_KEY=your_deepinfra_api_key
WEATHER_API_KEY=your_weather_api_key  # Optional
```

## Running the Server

Start the development server:

```bash
uv run uvicorn backend.main:app --reload
```

The server will be available at `http://localhost:8000`.

## API Endpoints

1. **Health Check**: `GET /health`
2. **OpenAI-Compatible Proxy**: `/openai/*` - Proxies requests to DeepInfra's OpenAI-compatible API
3. **Generic Proxy**: `/proxy/*` - Configurable proxy for other external APIs

## OpenAI Proxy Usage

The OpenAI proxy at `/openai/*` provides transparent access to DeepInfra's language models using the OpenAI API format:

- `POST /openai/chat/completions` - Chat completions (supports streaming)
- `GET /openai/models` - List available models
- `POST /openai/completions` - Text completions
- `POST /openai/embeddings` - Generate embeddings

See `OPENAI_PROXY_README.md` for detailed usage examples.
