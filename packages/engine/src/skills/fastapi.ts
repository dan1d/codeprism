import type { Skill } from "./types.js";

export const fastapiSkill: Skill = {
  id: "fastapi",
  label: "FastAPI",
  searchTag: "FastAPI route Pydantic dependency",
  searchContextPrefix:
    "FastAPI Python service: focus on route handlers, Pydantic models, dependency injection, background tasks, and database sessions.",
  cardPromptHints:
    "This is a FastAPI application. Emphasize: APIRouter and route handlers with HTTP methods, Pydantic request/response models with validation, Depends() for dependency injection, async/await patterns, SQLAlchemy sessions via dependency, and background tasks.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.1,
    rules: 1.0,
    code_style: 1.0,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\/routers?\//, role: "domain" },
    { pattern: /\/schemas?\//, role: "domain" },
    { pattern: /\/models?\//, role: "domain" },
    { pattern: /\/dependencies\//, role: "shared_utility" },
    { pattern: /\/middleware\//, role: "shared_utility" },
  ],
  bestPractices: {
    architecture: [
      "Use APIRouter to organize routes by domain resource; register routers in main.py",
      "Use Depends() for dependency injection: database sessions, auth, pagination, etc.",
      "Define Pydantic models for all request bodies and response schemas — never use dict",
      "Separate schema models (Pydantic) from ORM models (SQLAlchemy) — they serve different purposes",
      "Use background tasks or Celery for work that should not block the HTTP response",
    ],
    codeStyle: [
      "Use async def for route handlers and async I/O operations",
      "Name request schemas XxxCreate/XxxUpdate and response schemas XxxResponse",
      "Raise HTTPException with explicit status_code and detail — never return raw error dicts",
      "Use response_model on route decorators to validate and serialize output",
      "Group related settings into a Settings class using pydantic-settings",
    ],
    testing: [
      "Use TestClient (Starlette) for synchronous tests; httpx.AsyncClient for async tests",
      "Override dependencies in tests with app.dependency_overrides",
      "Use pytest fixtures for test database sessions — roll back after each test",
      "Test each route: valid input, invalid input, authentication, and authorization",
    ],
    performance: [
      "Use async database drivers (asyncpg, databases) — avoid sync drivers in async routes",
      "Cache expensive Depends() results with functools.lru_cache at the dependency level",
      "Use streaming responses (StreamingResponse) for large file downloads",
      "Profile with pyinstrument or py-spy; enable uvicorn's --workers for multi-process serving",
    ],
    security: [
      "Use OAuth2PasswordBearer or HTTPBearer for token authentication",
      "Validate JWT tokens with python-jose or authlib — never implement JWT parsing manually",
      "Use CORS middleware with explicit origins — avoid allow_origins=['*'] in production",
      "Validate file uploads: restrict content_type and file size before processing",
      "Set timeout limits on any downstream HTTP calls via httpx timeouts",
    ],
    antiPatterns: [
      "Using dict instead of Pydantic models for request/response bodies",
      "Blocking I/O (requests library, time.sleep) inside async route handlers",
      "Sharing a single database session across requests (use Depends for per-request sessions)",
      "Catching all exceptions in a bare except and returning 200 OK",
      "Putting business logic directly in route handler functions",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.78,
    knownExceptions: [
      "Sync route handlers explicitly marked for use with run_in_executor",
      "Test files that use sync TestClient",
    ],
  },
};

export default fastapiSkill;
