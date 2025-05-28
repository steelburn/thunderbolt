import logging
from typing import Dict, Optional, Set
from urllib.parse import parse_qs, urlencode

import httpx
from fastapi import HTTPException, Request, Response
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)


class ProxyConfig:
    """Configuration for a specific proxy endpoint"""

    def __init__(
        self,
        target_url: str,
        api_key: Optional[str] = None,
        api_key_header: str = "X-API-Key",
        api_key_as_query_param: bool = False,
        api_key_query_param_name: str = "key",
        strip_headers: Optional[Set[str]] = None,
        strip_query_params: Optional[Set[str]] = None,
        require_auth: bool = True,
        supports_streaming: bool = False,
    ):
        self.target_url = target_url.rstrip("/")
        self.api_key = api_key
        self.api_key_header = api_key_header
        self.api_key_as_query_param = api_key_as_query_param
        self.api_key_query_param_name = api_key_query_param_name
        self.strip_headers = strip_headers or {
            "authorization",
            "x-forwarded-for",
            "x-real-ip",
            "x-forwarded-host",
            "x-forwarded-proto",
            "cookie",
        }
        # Only strip the specific API key parameter when server-configured API key is used
        self.strip_query_params = strip_query_params or (
            {api_key_query_param_name} if api_key and api_key_as_query_param else set()
        )
        self.require_auth = require_auth
        self.supports_streaming = supports_streaming


class ProxyService:
    """Service to handle proxying requests to external APIs"""

    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )
        self.configs: Dict[str, ProxyConfig] = {}

    def register_proxy(self, path_prefix: str, config: ProxyConfig):
        """Register a new proxy configuration for a path prefix"""
        self.configs[path_prefix] = config

    def get_config(self, path: str) -> Optional[ProxyConfig]:
        """Get the proxy configuration for a given path"""
        for prefix, config in self.configs.items():
            if path.startswith(prefix):
                return config
        return None

    async def verify_auth(self, request: Request) -> bool:
        """Verify the request has proper authentication"""
        # Implement your auth logic here
        # For now, just check if Authorization header exists
        return "authorization" in request.headers

    def prepare_headers(self, request: Request, config: ProxyConfig) -> Dict[str, str]:
        """Prepare headers for the proxied request"""
        headers = {}

        # Copy headers except the ones we want to strip
        for key, value in request.headers.items():
            if key.lower() not in config.strip_headers:
                headers[key] = value

        # Add API key as header if configured and not using query param mode
        if config.api_key and not config.api_key_as_query_param:
            # Special handling for Authorization header - add Bearer prefix if needed
            if (
                config.api_key_header.lower() == "authorization"
                and not config.api_key.startswith("Bearer ")
            ):
                headers[config.api_key_header] = f"Bearer {config.api_key}"
            else:
                headers[config.api_key_header] = config.api_key

        # Remove host header as it will be set by httpx
        headers.pop("host", None)

        return headers

    async def proxy_streaming_request(
        self, request: Request, path: str, config: ProxyConfig
    ) -> StreamingResponse:
        """Proxy a streaming request to the target URL"""

        # Build target URL
        target_url = f"{config.target_url}/{path}"

        # Handle query parameters
        if request.url.query or (config.api_key and config.api_key_as_query_param):
            # Parse existing query parameters
            query_params = {}
            if request.url.query:
                query_params = dict(
                    parse_qs(str(request.url.query), keep_blank_values=True)
                )
                # Convert lists to single values for simplicity
                query_params = {
                    k: v[0] if isinstance(v, list) and len(v) == 1 else v
                    for k, v in query_params.items()
                }

                # Remove any query parameters that should be stripped
                for param in config.strip_query_params:
                    if param in query_params:
                        logger.debug(
                            f"Stripping query parameter '{param}' from client request"
                        )
                    query_params.pop(param, None)

            # Add API key as query parameter if configured
            # This ensures the server-configured API key always takes precedence
            if config.api_key and config.api_key_as_query_param:
                query_params[config.api_key_query_param_name] = config.api_key

            # Build query string
            query_string = urlencode(query_params, doseq=True)
            if query_string:
                target_url = f"{target_url}?{query_string}"

        # Prepare headers
        headers = self.prepare_headers(request, config)

        # Get request body
        body = await request.body()

        try:
            # Make the proxied request with streaming
            logger.info(f"Proxying streaming request to: {target_url}")

            async def stream_response():
                async with self.client.stream(
                    method=request.method,
                    url=target_url,
                    headers=headers,
                    content=body,
                    follow_redirects=False,
                ) as response:
                    response.raise_for_status()

                    # Stream the response content
                    async for chunk in response.aiter_bytes():
                        yield chunk

            # For streaming, we directly create the streaming response
            return StreamingResponse(
                stream_response(),
                media_type="text/event-stream",
            )

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Gateway timeout")
        except httpx.RequestError as e:
            logger.error(f"Proxy streaming request failed: {e}")
            raise HTTPException(status_code=502, detail="Bad gateway")

    async def proxy_request(
        self, request: Request, path: str, config: ProxyConfig
    ) -> Response:
        """Proxy a request to the target URL"""

        # Check if this is a streaming request
        is_streaming = False
        if config.supports_streaming:
            # Check for streaming indicators
            content_type = request.headers.get("content-type", "")
            accept = request.headers.get("accept", "")

            # Parse request body to check for stream parameter
            if request.method == "POST" and "application/json" in content_type:
                try:
                    import json

                    body_bytes = await request.body()
                    body_json = json.loads(body_bytes)
                    is_streaming = body_json.get("stream", False)
                    # Put the body back for later use
                    request._body = body_bytes
                except:
                    pass

            # Also check accept header
            if "text/event-stream" in accept:
                is_streaming = True

        # Use streaming proxy if needed
        if is_streaming:
            return await self.proxy_streaming_request(request, path, config)

        # Build target URL
        target_url = f"{config.target_url}/{path}"

        # Handle query parameters
        if request.url.query or (config.api_key and config.api_key_as_query_param):
            # Parse existing query parameters
            query_params = {}
            if request.url.query:
                query_params = dict(
                    parse_qs(str(request.url.query), keep_blank_values=True)
                )
                # Convert lists to single values for simplicity
                query_params = {
                    k: v[0] if isinstance(v, list) and len(v) == 1 else v
                    for k, v in query_params.items()
                }

                # Remove any query parameters that should be stripped
                for param in config.strip_query_params:
                    if param in query_params:
                        logger.debug(
                            f"Stripping query parameter '{param}' from client request"
                        )
                    query_params.pop(param, None)

            # Add API key as query parameter if configured
            # This ensures the server-configured API key always takes precedence
            if config.api_key and config.api_key_as_query_param:
                query_params[config.api_key_query_param_name] = config.api_key

            # Build query string
            query_string = urlencode(query_params, doseq=True)
            if query_string:
                target_url = f"{target_url}?{query_string}"

        # Prepare headers
        headers = self.prepare_headers(request, config)

        # Get request body
        body = await request.body() if not hasattr(request, "_body") else request._body

        try:
            # Make the proxied request
            logger.info(f"Proxying request to: {target_url}")
            logger.info(f"Request headers: {headers}")
            response = await self.client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                follow_redirects=False,
            )

            # Create response headers
            response_headers = dict(response.headers)

            # httpx automatically decompresses content when accessing response.content
            # So we need to remove compression-related headers
            content = response.content

            # Log for debugging
            logger.info(f"Response headers before cleanup: {response_headers}")

            # Remove headers that are no longer valid after decompression
            response_headers.pop("content-encoding", None)
            response_headers.pop("content-length", None)
            response_headers.pop("transfer-encoding", None)

            return Response(
                content=content,
                status_code=response.status_code,
                headers=response_headers,
            )

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Gateway timeout")
        except httpx.RequestError as e:
            logger.error(f"Proxy request failed: {e}")
            raise HTTPException(status_code=502, detail="Bad gateway")

    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()


# Global proxy service instance
proxy_service = ProxyService()


async def get_proxy_service() -> ProxyService:
    """Dependency to get the proxy service"""
    return proxy_service
