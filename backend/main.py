from contextlib import asynccontextmanager
from functools import lru_cache

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.config import Settings
from backend.proxy import ProxyConfig, ProxyService, get_proxy_service


@lru_cache
def get_settings():
    return Settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    settings = get_settings()
    proxy_service = await get_proxy_service()

    # Register proxy configurations
    # Weather API proxy - only register if API key is provided
    if settings.weather_api_key:
        proxy_service.register_proxy(
            "/proxy/weather",
            ProxyConfig(
                target_url="https://api.weatherapi.com/v1",
                api_key=settings.weather_api_key,
                api_key_as_query_param=True,  # Use API key as query parameter
                api_key_query_param_name="key",  # WeatherAPI uses 'key' as the param name
                require_auth=True,
            ),
        )

    # DeepInfra OpenAI-compatible proxy
    if settings.deepinfra_api_key:
        proxy_service.register_proxy(
            "/openai",
            ProxyConfig(
                target_url="https://api.deepinfra.com/v1/openai",
                api_key=settings.deepinfra_api_key,
                api_key_header="Authorization",
                api_key_as_query_param=False,
                require_auth=False,  # Frontend doesn't need to authenticate
                supports_streaming=True,  # Enable streaming support
            ),
        )

    # Add more proxy configurations as needed
    # proxy_service.register_proxy("/proxy/another-api", ProxyConfig(...))

    yield

    # Shutdown
    await proxy_service.close()


app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

settings = get_settings()


@app.get("/health")
async def health():
    return {"status": "ok"}


# OpenAI-compatible endpoints
@app.api_route(
    "/openai/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
)
async def openai_proxy_endpoint(
    path: str,
    request: Request,
    proxy_service: ProxyService = Depends(get_proxy_service),
):
    """OpenAI-compatible proxy endpoint"""

    # Handle OPTIONS preflight requests
    if request.method == "OPTIONS":
        return {"status": "ok"}

    # Get the configuration for this path
    config = proxy_service.get_config("/openai")
    if not config:
        raise HTTPException(status_code=404, detail="OpenAI proxy not configured")

    # No auth required for this endpoint - it's handled by the proxy

    # Proxy the request
    return await proxy_service.proxy_request(request, path, config)


@app.api_route(
    "/proxy/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
)
async def proxy_endpoint(
    path: str,
    request: Request,
    proxy_service: ProxyService = Depends(get_proxy_service),
):
    """Generic proxy endpoint that routes based on path"""

    # Handle OPTIONS preflight requests
    if request.method == "OPTIONS":
        return {"status": "ok"}

    # Get the configuration for this path
    config = proxy_service.get_config(f"/proxy/{path}")
    if not config:
        raise HTTPException(status_code=404, detail="Proxy path not configured")

    # Verify authentication if required
    if config.require_auth and not await proxy_service.verify_auth(request):
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Remove the proxy prefix from the path
    # Extract the actual path after the service name
    service_prefix = None
    for prefix in proxy_service.configs:
        if f"/proxy/{path}".startswith(prefix):
            service_prefix = prefix
            break

    if service_prefix:
        actual_path = path[len(service_prefix.replace("/proxy/", "")) :]
        actual_path = actual_path.lstrip("/")
    else:
        actual_path = path

    # Proxy the request
    return await proxy_service.proxy_request(request, actual_path, config)
