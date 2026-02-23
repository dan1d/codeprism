# Python Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Prefer flat over nested**: Keep module hierarchies shallow; avoid deeply nested package structures that obscure imports and dependencies.
- **Use packages for namespacing**: Every directory should be a package with `__init__.py`; use absolute imports (`from package.module import name`) over relative imports.
- **Separate concerns cleanly**: Distinguish business logic, data access, presentation, and configuration layers; never mix I/O with computation in the same function.
- **Favor composition over inheritance**: Use composition and protocols/ABCs for flexibility; limit inheritance depth to 2-3 levels maximum.
- **Keep global state minimal**: Avoid module-level mutable state; prefer dependency injection or context managers for shared resources.
- **Design for testability**: Write pure functions where possible; isolate side effects (I/O, network, filesystem) at module boundaries.
- **Use properties for computed attributes**: Prefer `@property` decorators over getter methods; maintain the illusion of direct attribute access for simple derived values.

## Code Style

- **Follow PEP 8 strictly**: Use `pylint`, `flake8`, or `ruff` for enforcement; set line length to 80 characters (max 100 for complex expressions).
- **Names must be descriptive**: Use `snake_case` for functions/variables, `PascalCase` for classes, `UPPER_SNAKE_CASE` for constants; avoid single-letter names except loop counters.
- **Prefer implicit line continuation**: Use parentheses for line breaks over backslashes; always include trailing commas in multi-line collections.
- **Use comprehensions judiciously**: List/dict/set comprehensions are preferred for simple transformations; avoid multi-line comprehensions or nested loops—use regular loops instead.
- **Write idiomatic boolean checks**: Use `if seq:` not `if len(seq) > 0:`; use `is None` not `== None`; leverage truthiness for collections and strings.
- **Keep functions focused**: Limit functions to 40 lines; extract helper functions when logic branches or has multiple responsibilities.
- **Always use context managers**: Prefer `with` statements for files, locks, and resources; never manually open/close when a context manager exists.
- **Type annotate public APIs**: Use type hints for all function signatures in public modules; use `typing` module constructs (`list[str]`, `dict[str, int]`, `Optional[T]`).
- **Format strings with f-strings**: Prefer f-strings (`f"Hello {name}"`) over `.format()` or `%`; use `str.join()` for concatenating sequences.

## Testing

- **Use pytest as the standard**: Prefer pytest over unittest for its simplicity, fixture system, and assertion introspection; organize tests to mirror source structure.
- **Prefer fixtures over setup methods**: Use pytest fixtures with appropriate scope (`function`, `module`, `session`); avoid stateful test classes unless modeling a clear lifecycle.
- **Test behavior, not implementation**: Focus on public API contracts; avoid testing private methods directly; use mocking (`unittest.mock`) sparingly to isolate units.
- **Aim for 80%+ coverage on critical paths**: Use `pytest-cov` to measure; prioritize business logic and edge cases over boilerplate; don't chase 100% coverage blindly.
- **Parametrize related test cases**: Use `@pytest.mark.parametrize` to avoid duplicate test code; group related scenarios with clear parameter names.
- **Fast tests in isolation**: Unit tests should run in milliseconds; use in-memory databases or mocks for I/O; reserve integration tests for CI pipelines.

## Performance

- **Profile before optimizing**: Use `cProfile` and `line_profiler` to identify actual bottlenecks; never optimize based on assumptions.
- **Avoid N+1 queries**: Batch database/API calls; use eager loading for related data; prefer bulk operations over loops of single operations.
- **Use generators for large datasets**: Prefer generator expressions and `yield` over building full lists in memory; leverage itertools for efficient chaining.
- **Cache expensive computations**: Use `functools.lru_cache` for pure functions; implement application-level caching (Redis, memcached) for cross-request data.
- **Choose appropriate data structures**: Use `set` for membership tests, `dict` for lookups, `collections.deque` for queues; avoid lists for repeated insertion/deletion.
- **Minimize object creation in loops**: Hoist constant expressions outside loops; reuse objects when safe; use `__slots__` for memory-intensive classes.

## Security

- **Never trust user input**: Validate and sanitize all external data; use parameterized queries to prevent SQL injection; sanitize for XSS in templates.
- **Store secrets in environment variables**: Use `python-dotenv` or secret management services; never commit credentials to version control; rotate secrets regularly.
- **Implement authentication at the boundary**: Verify identity before processing requests; use established libraries (OAuth, JWT) rather than custom auth; enforce HTTPS in production.
- **Apply principle of least privilege**: Check authorization for every protected resource; separate read/write permissions; fail closed on ambiguous permissions.
- **Hash and salt passwords properly**: Use `bcrypt`, `argon2`, or `scrypt` via libraries like `passlib`; never use MD5/SHA1 for passwords; set appropriate cost factors.

## Anti-Patterns

- **Avoid bare `except:` clauses**: Catch specific exceptions; always let `KeyboardInterrupt` and `SystemExit` propagate; log unexpected exceptions with context.
- **Don't use mutable default arguments**: Never use `def func(items=[]):` patterns; use `None` and initialize inside the function to avoid shared state bugs.
- **Avoid wildcard imports**: Never use `from module import *`; explicitly name imports for clarity and to prevent namespace pollution.
- **Don't abuse `**kwargs` for laziness**: Explicitly declare expected parameters; use `**kwargs` only for true variadic cases (decorators, proxies); document expected keys.
- **Avoid premature abstraction**: Don't create base classes or frameworks until patterns emerge from 3+ concrete cases; prefer duplication over wrong abstraction.
- **Don't ignore type annotations after adding them**: Run `mypy` in CI; type hints are documentation that must stay accurate; prefer strict
