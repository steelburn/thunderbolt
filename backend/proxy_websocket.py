import asyncio
import logging
from typing import Optional

import websockets
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)


class WebSocketProxyConfig:
    """Configuration for WebSocket proxy endpoints"""

    def __init__(
        self,
        target_url: str,
        api_key: Optional[str] = None,
        api_key_header: str = "Authorization",
        require_auth: bool = True,
    ):
        self.target_url = target_url.rstrip("/")
        self.api_key = api_key
        self.api_key_header = api_key_header
        self.require_auth = require_auth


class WebSocketProxyService:
    """Service to handle WebSocket proxying"""

    def __init__(self):
        self.configs = {}

    def register_proxy(self, path_prefix: str, config: WebSocketProxyConfig):
        """Register a new WebSocket proxy configuration"""
        self.configs[path_prefix] = config

    def get_config(self, path: str) -> Optional[WebSocketProxyConfig]:
        """Get the proxy configuration for a given path"""
        for prefix, config in self.configs.items():
            if path.startswith(prefix):
                return config
        return None

    async def proxy_websocket(
        self,
        client_ws: WebSocket,
        path: str,
        config: WebSocketProxyConfig,
    ):
        """Proxy WebSocket connection between client and target server"""
        # Build target URL
        target_url = f"{config.target_url}/{path}"

        # Prepare headers
        headers = {}
        if config.api_key:
            if config.api_key_header.lower() == "authorization":
                headers[config.api_key_header] = f"Bearer {config.api_key}"
            else:
                headers[config.api_key_header] = config.api_key

        # Extract additional headers from client
        client_headers = dict(client_ws.headers)
        for key, value in client_headers.items():
            if key.lower() not in [
                "host",
                "connection",
                "upgrade",
                "sec-websocket-key",
                "sec-websocket-version",
            ]:
                headers[key] = value

        server_ws = None
        try:
            # Connect to target server
            logger.info(f"Connecting to WebSocket: {target_url}")
            server_ws = await websockets.connect(
                target_url,
                extra_headers=headers,
            )

            # Create tasks for bidirectional message forwarding
            client_to_server = asyncio.create_task(
                self._forward_messages(client_ws, server_ws, "client->server")
            )
            server_to_client = asyncio.create_task(
                self._forward_messages_ws(server_ws, client_ws, "server->client")
            )

            # Wait for either task to complete (connection closed)
            done, pending = await asyncio.wait(
                [client_to_server, server_to_client],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Cancel pending tasks
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        except Exception as e:
            logger.error(f"WebSocket proxy error: {e}")
            if client_ws.client_state == WebSocketState.CONNECTED:
                await client_ws.close(code=1011, reason=str(e))
        finally:
            # Clean up connections
            if server_ws:
                await server_ws.close()

    async def _forward_messages(self, from_ws: WebSocket, to_ws, direction: str):
        """Forward messages from FastAPI WebSocket to websockets client"""
        try:
            while True:
                # Receive from FastAPI WebSocket
                data = await from_ws.receive()

                if "text" in data:
                    await to_ws.send(data["text"])
                elif "bytes" in data:
                    await to_ws.send(data["bytes"])
                else:
                    # Connection closing
                    break

        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected: {direction}")
        except Exception as e:
            logger.error(f"Error forwarding messages {direction}: {e}")

    async def _forward_messages_ws(self, from_ws, to_ws: WebSocket, direction: str):
        """Forward messages from websockets client to FastAPI WebSocket"""
        try:
            async for message in from_ws:
                if isinstance(message, str):
                    await to_ws.send_text(message)
                elif isinstance(message, bytes):
                    await to_ws.send_bytes(message)

        except websockets.exceptions.ConnectionClosed:
            logger.info(f"WebSocket closed: {direction}")
        except Exception as e:
            logger.error(f"Error forwarding messages {direction}: {e}")


# Global WebSocket proxy service instance
ws_proxy_service = WebSocketProxyService()


async def get_ws_proxy_service() -> WebSocketProxyService:
    """Dependency to get the WebSocket proxy service"""
    return ws_proxy_service
