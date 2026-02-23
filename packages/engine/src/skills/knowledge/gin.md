# Gin (Go) Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Use `gin.New()` rather than `gin.Default()` in production to control which middleware is applied
- Group routes by resource with `router.Group("/api/v1/resource")` and keep handler registration centralized
- Keep handlers thin: extract business logic into service structs injected via constructor
- Use the repository pattern for data access; define repository interfaces in the domain layer
- Wire the application in `main.go` or a dedicated `wire.go`; use dependency injection (manual or Wire codegen)

## Code Style
- Name handler functions descriptively: `CreateUser`, `GetUserByID`, `ListUsers` — not `UserHandler`
- Return `c.JSON(http.StatusOK, response)` or `c.AbortWithStatusJSON(code, errResp)` — never mix returns and aborts
- Bind and validate request data with `c.ShouldBindJSON(&dto)` and return `400` if binding fails
- Define request/response structs with JSON tags and validation tags (`binding:"required,email"`)
- Follow standard Go style (gofmt + golangci-lint) — all exported symbols must have doc comments

## Testing
- Test handlers by creating a `*gin.Engine` in test mode (`gin.SetMode(gin.TestMode)`) with `httptest.NewRecorder`
- Inject mock services/repos via the same constructor used in production — no magic, no globals
- Use `net/http/httptest` for request construction; assert on `recorder.Code` and `recorder.Body`
- Apply table-driven tests for handlers with multiple input scenarios
- Test middleware by mounting it on a test router with a simple passthrough handler

## Performance
- Use `gin.SetMode(gin.ReleaseMode)` in production — debug mode logs every route registration
- Avoid allocating response structs on the hot path; use `sync.Pool` for frequently reused buffers
- Apply request timeouts with server-level `ReadTimeout` / `WriteTimeout` rather than per-handler logic
- Use streaming responses (`c.Stream`) for large payloads instead of buffering the full response in memory
- Profile with `pprof` middleware (`net/http/pprof`) in staging to identify handler bottlenecks

## Security
- Use a JWT middleware (e.g., `gin-jwt` or custom middleware using `golang-jwt/jwt`) for authentication
- Validate and sanitize all path params and query params — never pass them raw to database queries
- Apply CORS middleware with an explicit allowed-origins list; avoid wildcard `*` in production
- Enforce rate limiting with a middleware (e.g., `ulule/limiter`) to prevent abuse
- Set secure HTTP headers (HSTS, CSP, X-Content-Type-Options) in a security middleware registered globally

## Anti-Patterns to Flag
- Accessing `c.Request.Body` directly without binding — bypasses validation
- Using `c.Abort()` without `c.JSON`/`c.String` — leaves the client without a response body
- Registering handlers directly on the root router without versioned groups — makes future versioning painful
- Global mutable state in handlers — breaks concurrency safety; inject state via closures or structs
- Not handling `ShouldBindJSON` errors — silent failures when request body is malformed
- Logging full request/response bodies in production — risks leaking PII and credentials
