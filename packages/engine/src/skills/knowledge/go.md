# Go Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Follow standard project layout: `cmd/` for binaries, `internal/` for private packages, `pkg/` for public libraries
- Use the repository pattern for data access: define interfaces in the domain layer, implement in `internal/repository/`
- Depend on interfaces, not concrete types — inject dependencies through constructors
- Keep `main.go` thin: wire dependencies, configure, and start the server; delegate all logic to packages
- Use layered architecture: handler → service → repository; avoid cross-layer imports

## Code Style
- Use `gofmt` (or `goimports`) — all code must be formatted before committing
- Name exported types and functions with `PascalCase`; unexported with `camelCase`
- Return errors as values; never use `panic` for expected error conditions
- Wrap errors with `fmt.Errorf("context: %w", err)` to preserve the error chain
- Keep functions short — if it doesn't fit on a screen, break it into helpers
- Accept interfaces, return concrete types in constructors

## Testing
- Use table-driven tests with `t.Run` and a slice of test cases — the standard Go testing pattern
- Place test files alongside the code they test (`foo_test.go` next to `foo.go`)
- Use the `testify` suite or plain `testing` package; avoid mocking frameworks except for interfaces
- Generate mocks with `mockery` or `moq` from interfaces — mock only at layer boundaries
- Use `t.Parallel()` in tests that don't share state; it speeds up the test suite significantly

## Performance
- Profile before optimizing — use `pprof` (CPU and heap profiles) to find actual bottlenecks
- Reuse objects with `sync.Pool` for short-lived allocations in hot paths
- Use buffered channels to avoid goroutine blocking in producer/consumer pipelines
- Pre-allocate slices and maps when length is known: `make([]T, 0, n)` avoids repeated allocations
- Avoid reflecting types at runtime — prefer code generation for serialization-heavy code

## Security
- Validate all external inputs at the HTTP handler boundary using a validation library or custom logic
- Use parameterized queries (never string-concatenated SQL) — use `sqlx` or `pgx` with named params
- Store secrets in environment variables or a secrets manager; never hardcode credentials
- Set timeouts on all HTTP clients and servers to prevent goroutine leaks from hung connections
- Use `crypto/rand` for all random values that affect security; never `math/rand`

## Anti-Patterns to Flag
- Ignoring returned errors — every `err` must be handled or explicitly discarded with `_` and a comment
- Using `interface{}` / `any` where a concrete type or typed interface would work
- Global mutable state — thread-safety bugs are silent; use dependency injection instead
- Goroutine leaks — every goroutine spawned must have a clear exit condition; use `context.Context` for cancellation
- Naked `return` in long functions — reduces readability; use named returns only for very short functions
- Large structs passed by value — use pointers for structs larger than ~64 bytes to avoid copying overhead
