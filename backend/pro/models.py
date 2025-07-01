"""
Pydantic models for Pro Tools API requests and responses
"""

from pydantic import BaseModel


# Request/Response models
class SearchRequest(BaseModel):
    query: str
    max_results: int = 10


class SearchResponse(BaseModel):
    results: str
    success: bool
    error: str | None = None


class FetchContentRequest(BaseModel):
    url: str


class FetchContentResponse(BaseModel):
    content: str
    success: bool
    error: str | None = None


class WeatherRequest(BaseModel):
    location: str
    days: int = 3  # Only used for forecast


class WeatherResponse(BaseModel):
    weather_data: str
    success: bool
    error: str | None = None


class LocationSearchRequest(BaseModel):
    query: str


class LocationSearchResponse(BaseModel):
    locations: str
    success: bool
    error: str | None = None
