# FastAPI Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Organize routes with `APIRouter` per domain feature; register all routers in `main.py`
- Use dependency injection via `Depends()` for DB sessions, current user, settings, and shared services
- Define request/response schemas with Pydantic models; keep them in a separate `schemas/` directory
- Separate data access into repository classes injected through dependencies
- Use lifespan events (`@asynccontextmanager` on `lifespan`) for startup/shutdown instead of deprecated `on_event`

## Code Style
- Use async route handlers (`async def`) for all endpoints that perform I/O
- Declare response models explicitly with `response_model=` to control what gets serialized
- Use `Annotated` for field validation metadata instead of `Field(...)` at the function signature level
- Prefix router paths consistently (e.g., `/api/v1/`) at the `include_router` level, not inside handlers
- Name path operation functions descriptively — they appear in OpenAPI docs as operation summaries

## Testing
- Use `httpx.AsyncClient` with `ASGITransport` for async test client; avoid `TestClient` for async code
- Override dependencies with `app.dependency_overrides` in test fixtures to swap real DBs and services
- Use `pytest-asyncio` with `asyncio_mode = "auto"` in `pyproject.toml` for clean async test setup
- Test each layer separately: route tests (integration), service tests (unit), repo tests (DB)
- Use `anyio` markers for tests that must be transport-agnostic

## Performance
- Use async SQLAlchemy (`asyncpg` driver) for database access — sync drivers block the event loop
- Apply `BackgroundTasks` for fire-and-forget work (email, logging); use Celery/ARQ for durable jobs
- Stream large responses with `StreamingResponse` rather than loading full payloads into memory
- Cache frequently read, rarely changed data with `fastapi-cache2` or custom Redis middleware
- Set connection pool sizes appropriately in SQLAlchemy engine configuration

## Security
- Use OAuth2 with JWT via `fastapi.security`; validate tokens in a reusable `get_current_user` dependency
- Apply CORS middleware with explicit allowed origins — avoid `allow_origins=["*"]` in production
- Rate-limit endpoints with `slowapi` to prevent abuse
- Validate uploaded files for type, size, and content before processing
- Use HTTPS-only cookies for session tokens; set `Secure`, `HttpOnly`, and `SameSite` attributes

## Anti-Patterns to Flag
- Using `dict` as request/response types instead of Pydantic models — bypasses validation and docs
- Blocking I/O inside `async def` routes (e.g., `requests.get`, `time.sleep`) — blocks the event loop
- Putting business logic in route handler functions — move to service layer
- Global SQLAlchemy `Session` objects — use per-request sessions via dependency injection
- Returning raw SQLAlchemy ORM objects without `response_model` — exposes internal schema
- Skipping `status_code` on non-200 responses — always declare the correct HTTP status
