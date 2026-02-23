# Go Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Avoid mutable globals**: Use dependency injection instead of global variables; if globals are necessary, wrap them in functions that return values
- **Verify interface compliance at compile time**: Use `var _ InterfaceName = (*TypeName)(nil)` to ensure types implement interfaces
- **Avoid embedding types in public structs**: Embedding leaks implementation details and breaks backward compatibility; prefer explicit fields
- **Exit only in main()**: Call `os.Exit` or `log.Fatal` only in `main()` to allow proper cleanup and testing; return errors instead
- **Avoid `init()`**: Prefer explicit initialization for deterministic, testable setup; if unavoidable, ensure init is deterministic and avoids goroutines
- **Function grouping**: Group functions by receiver type, then by similar functionality; place exported functions before unexported ones
- **Channel sizing**: Use unbuffered channels (size 0) for synchronization or buffered channels with size 1; avoid arbitrary buffer sizes
- **Package boundaries**: Keep package names short, concise, lowercase, single-word; package name should match import path last element

## Code Style

- **Reduce nesting**: Handle errors and edge cases first, return early; avoid `else` blocks when `if` block returns
- **Pointer receivers for interfaces**: Use pointer receivers when implementing interfaces if any method requires mutation or if the struct is large
- **Local variable declarations**: Use `:=` for local variables; use `var` only for zero-value initialization or when type differs from right-hand side
- **Use field names in struct initialization**: Always specify field names except for small, stable structs (e.g., `Point{x, y}`)
- **Omit zero-value fields**: Don't explicitly set fields to their zero values in struct literals
- **Prefix unexported globals with `_`**: Name package-level unexported variables `_varName` to clearly distinguish from local variables
- **Import grouping**: Three groups separated by blank lines: standard library, third-party, local; order alphabetically within groups
- **Raw string literals**: Use backticks for strings with escape characters or multi-line strings to improve readability
- **Avoid naked parameters**: Use comment syntax `/* paramName */` for boolean or unclear primitive parameters to improve call-site clarity
- **nil slices are valid**: Prefer `var s []int` over `s := []int{}`; nil slices work with `append`, `len`, and `range`

## Testing

- **Use table-driven tests**: Define test cases as slices of structs with input/expected fields; iterate with `t.Run` for parallel execution
- **Wait for goroutines**: Use `sync.WaitGroup` or channels to ensure goroutines complete before test ends; never fire-and-forget in tests
- **Test error types appropriately**: Use `errors.Is` for sentinel errors, `errors.As` for error types with additional fields
- **Handle type assertions in tests**: Always use comma-ok idiom `val, ok := i.(Type)` to avoid panics
- **Verify interface compliance in tests**: Add compile-time checks like `var _ io.Reader = (*MyReader)(nil)` in test files
- **No goroutines in init()**: Keep initialization synchronous and deterministic; spawn goroutines explicitly after setup

## Performance

- **Prefer strconv over fmt**: Use `strconv.Itoa`, `strconv.FormatInt` instead of `fmt.Sprint` for primitive-to-string conversions
- **Avoid repeated string-to-byte conversions**: Store `[]byte` result when converting strings multiple times; `[]byte(s)` creates a copy
- **Specify container capacity**: Preallocate slices and maps with `make([]T, 0, size)` and `make(map[K]V, size)` when size is known
- **Copy slices and maps at boundaries**: Defensive copy when storing or returning user-provided slices/maps to prevent unexpected mutations
- **Use atomic operations**: Prefer `go.uber.org/atomic` over `sync/atomic` for type-safe atomic operations with cleaner APIs
- **Defer performance**: Be aware defer has small overhead; avoid in tight loops, but prioritize correctness over premature optimization

## Security

- **Don't fire-and-forget goroutines**: Always ensure goroutines have exit conditions and cleanup mechanisms to prevent leaks
- **Handle errors once**: Either handle an error (log, retry, degrade) or return it; never both to avoid double-logging and confusion
- **Avoid panic in libraries**: Return errors instead; panic only for unrecoverable programmer errors in application code
- **Use `time` package for time operations**: Never use arithmetic on `time.Time` or `time.Duration` for calendar calculations; use `AddDate` and methods
- **Type assertion safety**: Always use two-value form `val, ok := i.(Type)` to prevent panics from invalid assertions

## Anti-Patterns

- **No pointers to interfaces**: Interfaces are reference types; use `Interface` not `*Interface` (exception: rare cases needing to modify interface value itself)
- **Don't ignore mutex zero-values**: Embed `sync.Mutex` directly in structs; don't pass mutexes by value (copy breaks synchronization)
- **Avoid built-in name shadowing**: Don't use `new`, `make`, `len`, `cap`, `copy`, `append`, `error`, etc. as variable names
- **Start enums at non-zero**: Begin custom enum types at 1, not 0, to distinguish set values from zero-value defaults
- **Don't use `fmt` for format strings outside Printf**: Declare format strings as `const` outside `fmt.Sprintf`; name Printf-style functions with `f` suffix
- **Avoid overly long lines**: Target 99 characters; break long lines at logical boundaries for readability
- **Never embed `time.Time`**: Embedded time fields break JSON/YAML marshaling and add confusing methods to your type's API
