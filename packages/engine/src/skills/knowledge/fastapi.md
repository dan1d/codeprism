# FastAPI Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Prefer dependency injection via `Depends()`** for all cross-cutting concerns (database sessions, authentication, services) rather than global state or manual instantiation
- **Separate routers by domain/resource** using `APIRouter` instances, each in its own module under a `routers/` or `api/` directory, then include them in the main app with `app.include_router()`
- **Use Pydantic models for all request/response schemas** with separate models for input (creation/update) and output (response) to enforce validation boundaries and avoid exposing internal fields
- **Implement a three-layer architecture**: API layer (routers) → Service layer (business logic) → Repository/Data layer (database access), with dependencies flowing inward
- **Define dependencies as generator functions with `yield`** for resource cleanup (database sessions, file handles, connections) to ensure proper teardown even on exceptions
- **Place background tasks in dedicated modules** and invoke via `BackgroundTasks` dependency rather than mixing async task logic with request handlers
- **Use lifespan events** (`@asynccontextmanager` with `app.router.lifespan`) for startup/shutdown logic like connection pools and cache initialization, not deprecated `@app.on_event()`
- **Structure configuration using Pydantic `BaseSettings`** with environment variable support, validating all config at startup and injecting via dependency injection

## Code Style

- **Name path operations with verb-prefixed functions** (`get_user`, `create_order`, `update_product`) that clearly describe the HTTP method and resource action
- **Keep path operation functions under 20 lines** by extracting business logic to service layer functions; route handlers should only handle HTTP concerns (validation, status codes, response formatting)
- **Use explicit response models** with `response_model` parameter on all endpoints to enforce output schema validation and automatic documentation generation
- **Prefer explicit status codes** using `status.HTTP_*` constants from `fastapi` rather than magic numbers for readability and correctness
- **Type annotate all function signatures** including path parameters, query parameters, request bodies, and return types; leverage FastAPI's automatic validation from type hints
- **Use descriptive variable names for dependencies**: `db: Session = Depends(get_db)`, `current_user: User = Depends(get_current_user)` rather than abbreviated or generic names
- **Order path operation parameters consistently**: path parameters, query parameters, request body, dependencies, then background tasks
- **Document endpoints with docstrings and parameter descriptions** using `Field(description="...")` for schema fields and function docstrings for operation summaries

## Testing

- **Use `TestClient` from `fastapi.testclient`** for integration tests, treating the API as a black box and testing full request/response cycles including validation
- **Override dependencies with `app.dependency_overrides`** to inject test doubles for databases, external services, and authentication rather than mocking at the function level
- **Prefer `pytest` fixtures for test clients and database setup** with appropriate scope (function/module/session) and use `yield` fixtures for cleanup
- **Separate unit tests (service/repository logic) from integration tests (API endpoints)**, placing them in parallel directory structures (`tests/unit/`, `tests/integration/`)
- **Use `httpx.AsyncClient` for testing async endpoints** and ensure test functions are marked `async` when testing asynchronous path operations
- **Aim for 80%+ coverage on business logic** (services, repositories) and all happy/error paths on public API endpoints, not 100% coverage on framework boilerplate
- **Use factory patterns or factory_boy** for test data generation rather than fixtures with hard-coded values to improve test readability and reduce coupling

## Performance

- **Use `async def` for I/O-bound operations** (database queries, HTTP calls, file access) and regular `def` only for CPU-bound or synchronous library code to avoid blocking the event loop
- **Implement response caching** with dependencies that check cache (Redis, in-memory) before executing expensive operations, using cache keys derived from request parameters
- **Prevent N+1 queries with eager loading** using ORM-specific techniques (SQLAlchemy's `joinedload`/`selectinload`) or DataLoader pattern for GraphQL-style endpoints
- **Enable response compression** with `GZipMiddleware` for large JSON payloads and configure appropriate size thresholds
- **Use database connection pooling** with appropriate pool sizes and timeouts configured via SQLAlchemy engine or async database drivers, never creating engines per-request
- **Profile with `cProfile` or async-aware tools** like `py-spy` to identify bottlenecks; add middleware for request timing and structured logging of slow endpoints

## Security

- **Use OAuth2 with JWT tokens** via `OAuth2PasswordBearer` dependency for stateless authentication, validating signatures and claims on every request
- **Implement permission checks as reusable dependencies** that raise `HTTPException(status_code=403)` when authorization fails, composing them with `Depends()` chains
- **Validate all input with Pydantic models** including path parameters, query strings, and request bodies; use constraints (`Field(gt=0, max_length=100)`) to enforce business rules at the boundary
- **Store secrets in environment variables or secure vaults**, never in code or config files; use Pydantic `SecretStr` type for sensitive configuration values to prevent logging
- **Enable CORS middleware explicitly** with specific origins rather than wildcards in production: `CORSMiddleware(allow_origins=["https://example.com"])`
- **Set security headers** using middleware for `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, and consider using `fastapi-security` or similar packages

## Anti-Patterns

- **Avoid global database connections or ORM sessions**; always use dependency injection with request-scoped sessions to prevent connection leaks and thread-safety issues
- **Never use mutable default arguments** in path operations or dependencies (`def get_items(ids: list = [])`); use `None` with conditional initialization or `Field(default_factory=list)`
- **Don't mix sync and async incorrectly**: never call blocking I/O in `async def` functions without `run_in_executor`, and don't make synchronous functions `async` just for consistency
- **
