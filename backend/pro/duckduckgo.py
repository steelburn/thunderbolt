"""
DuckDuckGo search functionality
"""

import asyncio
import sys
import traceback
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import httpx
from bs4 import BeautifulSoup

from .context import SimpleContext


@dataclass
class SearchResult:
    title: str
    link: str
    snippet: str
    position: int


class RateLimiter:
    """Rate limiter to avoid being blocked by DuckDuckGo"""

    def __init__(self, requests_per_minute: int = 30):
        self.requests_per_minute = requests_per_minute
        self.requests: list[datetime] = []

    async def acquire(self) -> None:
        now = datetime.now()
        # Remove requests older than 1 minute
        self.requests = [
            req for req in self.requests if now - req < timedelta(minutes=1)
        ]

        if len(self.requests) >= self.requests_per_minute:
            # Wait until we can make another request
            wait_time = 60 - (now - self.requests[0]).total_seconds()
            if wait_time > 0:
                await asyncio.sleep(wait_time)

        self.requests.append(now)


class DuckDuckGoSearcher:
    """DuckDuckGo searcher using HTML endpoint for reliable results"""

    BASE_URL = "https://html.duckduckgo.com/html"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    def __init__(self):
        self.rate_limiter = RateLimiter()

    async def search(
        self, query: str, ctx: SimpleContext, max_results: int = 10
    ) -> list[dict[str, Any]]:
        """Search DuckDuckGo and return results"""
        try:
            # Apply rate limiting
            await self.rate_limiter.acquire()

            # Create form data for POST request
            data = {
                "q": query,
                "b": "",
                "kl": "",
            }

            await ctx.info(f"Searching DuckDuckGo for: {query}")

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.BASE_URL, data=data, headers=self.HEADERS, timeout=30.0
                )
                response.raise_for_status()

            # Parse HTML response
            soup = BeautifulSoup(response.text, "html.parser")
            if not soup:
                await ctx.error("Failed to parse HTML response")
                return []

            results: list[SearchResult] = []
            for result in soup.select(".result"):
                title_elem = result.select_one(".result__title")
                if not title_elem:
                    continue

                link_elem = title_elem.find("a")
                if not link_elem:
                    continue

                title = link_elem.get_text(strip=True)
                # Check if element has get method (Tag) vs NavigableString
                if hasattr(link_elem, "get"):
                    link = link_elem.get("href", "")
                else:
                    continue

                # Ensure link is a string
                if not isinstance(link, str):
                    continue

                # Skip ad results
                if "y.js" in link:
                    continue

                # Clean up DuckDuckGo redirect URLs
                if link.startswith("//duckduckgo.com/l/?uddg="):
                    link = urllib.parse.unquote(link.split("uddg=")[1].split("&")[0])

                snippet_elem = result.select_one(".result__snippet")
                snippet = snippet_elem.get_text(strip=True) if snippet_elem else ""

                results.append(
                    SearchResult(
                        title=title,
                        link=link,
                        snippet=snippet,
                        position=len(results) + 1,
                    )
                )

                if len(results) >= max_results:
                    break

            await ctx.info(f"Successfully found {len(results)} results")

            # Convert to the expected format
            formatted_results = []
            for result in results:
                formatted_results.append(
                    {
                        "title": result.title,
                        "url": result.link,
                        "snippet": result.snippet,
                        "position": result.position,
                    }
                )

            return formatted_results

        except httpx.TimeoutException:
            await ctx.error("Search request timed out")
            return []
        except httpx.HTTPError as e:
            await ctx.error(f"HTTP error occurred: {str(e)}")
            return []
        except Exception as e:
            await ctx.error(f"Unexpected error during search: {str(e)}")
            traceback.print_exc(file=sys.stderr)
            return []

    def format_results_for_llm(self, results: list[dict[str, Any]]) -> str:
        """Format results in a natural language style that's easier for LLMs to process"""
        if not results:
            return "No results were found for your search query. This could be due to DuckDuckGo's bot detection or the query returned no matches. Please try rephrasing your search or try again in a few minutes."

        output = []
        output.append(f"Found {len(results)} search results:\n")

        for result in results:
            output.append(
                f"{result.get('position', 0)}. {result.get('title', 'No title')}"
            )
            output.append(f"   URL: {result.get('url', '')}")
            output.append(f"   Summary: {result.get('snippet', '')}")
            output.append("")  # Empty line between results

        return "\n".join(output)
