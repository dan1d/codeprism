# Gin (Go) Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Organize by feature/domain, not by layer**: Group handlers, services, and repositories by business domain (e.g., `users/`, `orders/`) rather than technical layers (`handlers/`, `services/`)
- **Use handler → service → repository layering**: Handlers parse requests and format responses; services contain business logic; repositories handle data access
- **Inject dependencies through constructors**: Pass database connections, clients, and configuration to handlers/services via constructor functions, not global variables
- **Define interfaces at consumption point**: Declare service/repository interfaces in the package that uses them, not where they're implemented (dependency inversion)
- **Group routes using `gin.RouterGroup`**: Organize related endpoints under prefixed route groups (e.g., `v1.GET("/users/:id", handler.GetUser)`)
- **Use middleware composition for cross-cutting concerns**: Chain middleware for logging, authentication, rate limiting, and CORS rather than duplicating logic in handlers
- **Return structured errors from services**: Services should return domain errors (custom error types), not HTTP status codes; handlers translate errors to HTTP responses
- **Prefer `context.Context` propagation**: Thread request-scoped context through service and repository layers for cancellation, timeouts, and tracing

## Code Style

- **Name handlers with HTTP verb prefix**: Use `GetUser`, `CreateOrder`, `UpdateProfile` for handler function names to indicate the HTTP method intent
- **Keep handlers thin (< 30 lines)**: Handlers should validate input, call service layer, and format response—no business logic
- **Use `ShouldBindJSON` over `Bind` variants**: Prefer `ShouldBind*` methods that return errors instead of automatically aborting with 400 status
- **Bind request data to explicit structs**: Define request-specific structs with validation tags; never bind directly to domain models
- **Return early with `c.JSON()` or `c.AbortWithStatusJSON()`**: Avoid nested if-else blocks by returning immediately after error conditions
- **Use `binding` tags for validation**: Leverage struct tags (`binding:"required"`, `binding:"email"`) with `validator/v10` for declarative input validation
- **Name route parameters clearly**: Use descriptive names in route paths (`:userID` not `:id`) and bind to struct fields with `uri` tags
- **Group related response fields in structs**: Define response DTOs (e.g., `UserResponse`, `OrderListResponse`) rather than returning maps or raw models
- **Use constant HTTP status codes**: Reference `http.StatusOK`, `http.StatusBadRequest` etc. instead of numeric literals
- **Initialize Gin engine with `gin.New()` in production**: Use `gin.New()` instead of `gin.Default()` for explicit middleware control; add `gin.Recovery()` and custom logger

## Testing

- **Use `httptest` for handler testing**: Create `httptest.NewRecorder()` and `httptest.NewRequest()` to test handlers without starting a server
- **Mock service layer in handler tests**: Use interfaces and mock implementations (e.g., `testify/mock` or manual mocks) to isolate handler logic from services
- **Table-driven tests for multiple scenarios**: Structure tests with slice of test cases containing input, expected output, and assertions
- **Test middleware independently**: Write unit tests for custom middleware using minimal Gin context setup
- **Prefer integration tests for service layer**: Test services against real database (using Docker containers or test databases) to verify business logic and data access
- **Use test fixtures with cleanup**: Create helper functions to seed test data and defer cleanup operations (`t.Cleanup()`)
- **Aim for 80%+ coverage on business logic**: Focus coverage on service and repository layers; handlers with thin logic need fewer tests

## Performance

- **Use `gin.Context.ShouldBindQuery` efficiently**: Parse query parameters once per request; avoid repeated binding or manual parsing
- **Implement pagination on list endpoints**: Always limit and offset database queries; use cursor-based pagination for large datasets
- **Set appropriate timeout middleware**: Configure `context.WithTimeout` in middleware to prevent long-running requests from exhausting resources
- **Use connection pooling for databases**: Configure `sql.DB` `SetMaxOpenConns` and `SetMaxIdleConns` based on load testing results
- **Cache expensive computations with in-memory stores**: Use Redis or in-process cache (e.g., `go-cache`) for frequently accessed, slowly changing data
- **Profile with pprof in non-production**: Import `net/http/pprof` and expose on separate port for CPU and memory profiling during load tests
- **Avoid `c.Copy()` unless necessary**: Only copy Gin context when passing to goroutines; copying is expensive and usually unnecessary

## Security

- **Validate all input with `binding` tags and custom validators**: Never trust client input; use struct validation tags and implement custom validation logic for complex rules
- **Use middleware for authentication/authorization**: Implement JWT/session validation in middleware that populates context with user identity; check permissions before handler execution
- **Sanitize error messages to clients**: Return generic error messages (e.g., "Invalid credentials") in responses; log detailed errors server-side only
- **Set secure headers with middleware**: Use middleware to add `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` headers
- **Store secrets in environment variables or secret managers**: Never hardcode API keys, database credentials, or JWT secrets; use `os.Getenv()` or AWS Secrets Manager/HashiCorp Vault
- **Rate limit endpoints**: Apply rate limiting middleware (e.g., `gin-contrib/limiter`) to prevent abuse, especially on authentication and public endpoints
- **Use HTTPS in production**: Configure TLS certificates and redirect HTTP to HTTPS; terminate TLS at load balancer or reverse proxy if needed

## Anti-Patterns

- **Avoid global `gin.Engine` instances**: Don't use package-level variables for the Gin router; pass the engine through dependency injection or return from initialization functions
- **Don't put business logic in handlers**: Handlers should not contain calculations, database queries, or complex transformations—delegate to service layer
- **Never ignore binding errors**: Always check the error returned by `ShouldBind*` methods and return appropriate HTTP status codes
- **Avoid using `c.Keys` for dependency passing**: Don't
