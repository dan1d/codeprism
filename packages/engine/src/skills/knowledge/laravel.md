# Laravel Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Follow MVC: keep controllers thin; push business logic into Action classes or Service classes in `app/Actions/` or `app/Services/`
- Use Form Requests (`php artisan make:request`) for all input validation; never validate in controllers
- Use Eloquent relationships and scopes rather than raw query builder for readability
- Apply the Repository pattern only when you have complex, reusable query logic; don't add it by default
- Use Laravel's built-in Queue system for async work; keep jobs in `app/Jobs/` and keep them single-responsibility

## Code Style
- Follow PSR-12 and Laravel's own style guide; enforce with Laravel Pint (`./vendor/bin/pint`)
- Use `snake_case` for database columns and table names; `camelCase` for PHP methods; `PascalCase` for classes
- Prefer named route helpers (`route('users.index')`) over hardcoded URL strings
- Use `config()` and `env()` only in config files — never call `env()` in application code at runtime
- Type-hint all controller method parameters and return types where Laravel injection allows

## Testing
- Use PHPUnit with Laravel's built-in test helpers (`RefreshDatabase`, `actingAs`, HTTP test assertions)
- Use model factories for creating test data; define `definition()` and use `state()` for variations
- Prefer feature tests for API endpoints; use unit tests for isolated domain logic
- Run tests against a dedicated test database (SQLite in-memory or a test MySQL schema) — never against production
- Use `php artisan test --parallel` to speed up large suites

## Performance
- Eager-load relationships with `with()` to avoid N+1 queries; detect with `barryvdh/laravel-debugbar` or Telescope
- Cache expensive queries with `Cache::remember()`; key on relevant model IDs and version timestamps
- Use database indexes on foreign keys and all columns used in `WHERE`, `ORDER BY`, or `GROUP BY`
- Queue emails, notifications, and third-party API calls instead of processing synchronously in the request cycle
- Use `chunk()` or `cursor()` when iterating over large Eloquent result sets to limit memory usage

## Security
- Use Laravel Sanctum or Passport for API authentication; avoid rolling custom token systems
- Always validate user ownership when accessing records — never query by ID alone
- Use the built-in CSRF protection (`@csrf`); disable only for stateless API routes with token auth
- Store sensitive values in `.env` and access via `config()`; never commit `.env` to source control
- Use prepared statements (Eloquent and query builder do this by default); avoid raw DB::statement with user input

## Anti-Patterns to Flag
- Fat controllers with business logic — extract to Action/Service classes
- Calling `env()` outside of config files — breaks config caching (`php artisan config:cache`)
- `Model::all()` without constraints on large tables — always paginate or add a `limit()`
- Storing relationships without `with()` and looping, causing N+1 queries
- Using `Route::any()` for REST endpoints — define explicit HTTP verbs
- Returning Eloquent models directly from API controllers without API Resources — exposes internal schema
