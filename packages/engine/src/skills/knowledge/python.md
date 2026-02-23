# Python Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Structure projects with a `src/` layout to separate source from configuration and tests
- Use dependency injection over module-level singletons for testability
- Define interfaces with `Protocol` (structural subtyping) rather than abstract base classes for flexibility
- Separate I/O from business logic — pure functions are easier to test and reason about
- Use `pyproject.toml` as the single source of truth for project metadata and tool configuration

## Code Style
- Follow PEP 8; enforce with `ruff` (replaces flake8 + isort + pyupgrade) and `black` for formatting
- Use type hints on all public functions and methods; run `mypy` or `pyright` in strict mode
- Prefer `dataclasses` or `pydantic` models over plain dicts for structured data
- Use f-strings for all string formatting; avoid `%` formatting and `.format()` except in logging
- Keep functions small and single-purpose; extract helpers rather than stacking logic vertically

## Testing
- Use `pytest` with `pytest-cov` for coverage; structure tests in `tests/` mirroring `src/`
- Use `@pytest.mark.parametrize` for table-driven tests with multiple input/output cases
- Mock external I/O with `pytest-mock` (`mocker.patch`); prefer dependency injection to reduce mocking
- Use `pytest-asyncio` for async test functions; mark async tests with `@pytest.mark.asyncio`
- Aim for tests that test behavior (inputs → outputs), not implementation details

## Performance
- Profile with `cProfile` + `snakeviz` before optimizing; don't guess at bottlenecks
- Use `asyncio` for I/O-bound concurrency; use `multiprocessing` for CPU-bound parallelism
- Prefer generators and iterators over loading entire datasets into memory
- Use `functools.cache` / `functools.lru_cache` for memoizing pure functions with repeated calls
- Consider `numpy` / `pandas` for numerical or tabular data — vectorized operations outperform Python loops

## Security
- Validate all external inputs with Pydantic models or `marshmallow`; never trust raw request data
- Use parameterized queries via SQLAlchemy or `psycopg3` — never f-string SQL
- Store secrets in environment variables; use `python-decouple` or `pydantic-settings` to load them
- Keep dependencies pinned with exact versions in `requirements.txt` or `poetry.lock`; audit with `pip-audit`
- Avoid `pickle` for deserializing untrusted data — use JSON or `msgpack` instead

## Anti-Patterns to Flag
- Mutable default arguments (`def foo(items=[])`) — use `None` and initialize inside the function
- Broad `except Exception` or bare `except:` — catch specific exceptions and handle meaningfully
- Implicit relative imports — always use absolute imports in application code
- Large monolithic modules — split into subpackages when a module exceeds ~300 lines
- Mixing sync and async code without care — calling sync blocking functions inside `async def` blocks the event loop
- Using `assert` for runtime validation — it's disabled with `-O`; raise explicit exceptions instead
