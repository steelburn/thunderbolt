"""
Simple context class to replace MCP Context
"""

import logging


class SimpleContext:
    def __init__(self):
        self.logger = logging.getLogger(__name__)

    async def info(self, message: str):
        self.logger.info(message)

    async def error(self, message: str):
        self.logger.error(message)
