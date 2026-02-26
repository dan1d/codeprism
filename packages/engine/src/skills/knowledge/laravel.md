# Laravel (PHP) Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Single Responsibility Principle**: Each class should have only one reason to change; controllers handle HTTP logic only, models handle data logic only, services handle business logic only
- **Fat models, skinny controllers**: Move business logic out of controllers into service classes, actions, or model methods; controllers should only orchestrate and return responses
- **Service layer for business logic**: Extract complex business logic from controllers and models into dedicated service classes with clear, single-purpose methods
- **Prefer Eloquent over Query Builder over raw SQL**: Use Eloquent relationships and models for expressiveness; use Query Builder only when Eloquent is insufficient; avoid raw SQL except for complex queries
- **Repository pattern only when truly needed**: Don't add repositories just for abstraction; use them when switching data sources or complex query logic requires isolation from models
- **Use events and listeners for side effects**: Decouple actions that trigger secondary operations (emails, notifications, logging) using Laravel's event system
- **Convention over configuration**: Follow Laravel's directory structure and naming conventions; framework magic works best when you don't fight it
- **Separate read and write concerns**: Use query scopes and dedicated query classes for complex reads; use form requests and actions for writes

## Code Style

- **Follow Laravel naming conventions**: `StudlyCase` for classes, `camelCase` for methods/variables, `snake_case` for database columns/tables, plural for tables, singular for models
- **One method should do one thing**: Keep methods focused and under 20 lines; extract helper methods rather than adding complexity
- **Descriptive names over comments**: Use `$activeUsers` not `$users // active only`; method names should read like sentences (`getUsersByRole()` not `get()`)
- **Use type hints and return types**: Always declare parameter types and return types for methods (PHP 7.4+ property types where possible)
- **Prefer collections over arrays**: Use Laravel collections for data manipulation; leverage `map()`, `filter()`, `pluck()` over loops
- **Use mass assignment protection**: Define `$fillable` or `$guarded` on every model; never disable mass assignment protection globally
- **Avoid putting logic in Blade templates**: No queries, no business logic in views; pass prepared data from controllers; use view composers for shared data
- **No JS/CSS in Blade, no HTML in PHP**: Keep frontend assets in dedicated files; use Laravel Mix/Vite; return JSON from APIs, not HTML fragments
- **Config and language files for constants**: Never hardcode text strings or magic numbers; use `config('app.name')` and `__('messages.welcome')`

## Testing

- **Use PHPUnit with Laravel's testing tools**: Leverage `TestCase`, `RefreshDatabase`, `WithFaker`, and HTTP test helpers for feature tests
- **Factories over fixtures**: Define model factories for test data; use `factory()` or `Model::factory()` to create test records programmatically
- **Feature tests for workflows, unit tests for logic**: Test complete user workflows with feature tests; isolate complex business logic in unit tests
- **Test real database interactions**: Use SQLite in-memory or dedicated test database; don't mock Eloquent models or database calls in integration tests
- **Arrange-Act-Assert pattern**: Structure tests clearly with setup, execution, and verification phases separated by blank lines
- **Focus on behavior over implementation**: Test what the code does (outcomes), not how it does it (internal method calls)

## Performance

- **Always eager load relationships**: Use `with()` to prevent N+1 queries; use Laravel Debugbar or Telescope to detect missing eager loads
- **Chunk large datasets**: Use `chunk()` or `lazy()` for processing thousands of records to avoid memory exhaustion
- **Cache expensive queries**: Use `Cache::remember()` for slow or frequently-accessed queries; cache views with `view()->cache()`
- **Database indexes on foreign keys and query columns**: Add indexes to columns used in `where()`, `orderBy()`, and relationship keys
- **Use query optimization**: Select only needed columns with `select()`; avoid `all()` when you can filter; use `exists()` over `count() > 0`
- **Queue long-running tasks**: Use Laravel queues for emails, notifications, file processing, and external API calls
- **Profile with Telescope or Debugbar**: Monitor slow queries, memory usage, and HTTP performance in development; use Horizon for queue monitoring

## Security

- **Use Form Requests for validation**: Validate all user input through dedicated Form Request classes; never trust request data directly
- **Leverage Laravel's authentication scaffolding**: Use `php artisan make:auth` or Breeze/Jetstream; don't roll custom authentication
- **Authorize with policies and gates**: Define authorization logic in Policy classes; use `@can` in Blade and `authorize()` in controllers
- **Store secrets in `.env` only**: Never commit API keys or credentials to version control; use `config()` to access environment variables
- **Protect against mass assignment**: Define `$fillable` or `$guarded` on models; validate input separately from mass assignment rules
- **CSRF protection enabled by default**: Don't disable CSRF middleware; use `@csrf` directive in forms; exempt only documented API routes
- **Sanitize output in Blade**: Use `{{ }}` for escaping by default; only use `{!! !!}` for trusted HTML content

## Anti-Patterns

- **Don't query in loops**: Avoid calling models or database methods inside `foreach`; eager load or restructure to batch queries
- **Don't put business logic in controllers**: Controllers should orchestrate, not implement; extract logic to services, actions, or model methods
- **Don't use models as data bags**: Models represent database entities; don't create non-Eloquent models just to hold data (use DTOs or arrays)
- **Don't skip validation**: Every user input must be validated; never assume request data is safe or properly formatted
- **Don't abbreviate without reason**: Avoid `$u` for user or `$res` for result; prioritize clarity over brevity unless iterating (`$user` vs `foreach ($users as $u)`)
- **Don't use raw queries for simple operations**: If Eloquent can express it clearly, don't drop to Query Builder or raw SQL for "performance" without profiling
- **Don't ignore the N+1 problem**: Every list or collection view should be checked for N+1 queries during code review
