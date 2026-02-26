# Ruby on Rails Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Keep controllers thin**: Controllers should only handle request/response logic, parameter handling, and orchestration. Move business logic to models, service objects, or concerns.
- **Use concerns for shared behavior**: Extract reusable model and controller logic into concerns (`app/models/concerns`, `app/controllers/concerns`) rather than inheritance or duplication.
- **Prefer composition over inheritance**: Use modules, decorators, and service objects instead of deep inheritance hierarchies for better modularity and testability.
- **One gem, one initializer**: Place gem-specific configuration in separate initializer files under `config/initializers/` named after the gem (e.g., `carrierwave.rb`, `sidekiq.rb`).
- **Environment-specific config goes in environment files**: Keep development, test, and production settings in their respective files under `config/environments/`, not scattered throughout the codebase.
- **Use `config.load_defaults` for Rails version**: Set `config.load_defaults` to match your Rails version to adopt recommended framework practices and settings.
- **Keep staging production-like**: Staging environments should mirror production configuration as closely as possible to catch environment-specific issues before deployment.
- **Asset pipeline organization**: Explicitly declare assets for precompilation in `config/environments/production.rb` using `config.assets.precompile`.

## Code Style

- **Prefer single-quoted strings**: Use single quotes for string literals unless interpolation or escape sequences are needed, then use double quotes.
- **Use meaningful method names**: Method names should clearly express intent. Prefer `User#activate!` over `User#change_status(true)`.
- **Keep methods short**: Methods should fit on one screen (roughly 10 lines or fewer). Extract complex logic into private methods or separate objects.
- **Use symbols for hash keys**: Prefer symbols over strings for hash keys in application code (`:name` not `"name"`), especially for method options and Rails APIs.
- **Consistent hash syntax**: Use the modern hash syntax (`key: value`) for symbol keys, traditional syntax (`=>`) only when keys are not symbols.
- **Avoid dense method chaining**: Break multi-line method chains with dots at the start of continuation lines for readability. Prefer intermediate variables for complex chains.
- **Follow Rails naming conventions**: Use `snake_case` for files, methods, and variables; `CamelCase` for classes/modules; `SCREAMING_SNAKE_CASE` for constants.
- **Use ActiveRecord query interface**: Prefer ActiveRecord methods (`where`, `find_by`, `exists?`) over raw SQL strings for database queries.
- **Trailing commas in multi-line collections**: Use trailing commas in multi-line arrays and hashes for cleaner diffs and easier reordering.

## Testing

- **Use factories over fixtures**: Prefer factory libraries (FactoryBot) over fixtures for test data setup, providing more flexibility and explicitness.
- **Test behavior, not implementation**: Focus tests on public interfaces and outcomes rather than internal implementation details or private methods.
- **Keep test scope focused**: Unit tests for models/services, integration tests for request flows, system tests for critical user journeys—avoid overlapping coverage.
- **Use descriptive test names**: Test descriptions should clearly state the condition being tested and expected outcome (e.g., `"returns false when user is inactive"`).
- **Avoid test interdependencies**: Each test should be independently runnable with its own setup and teardown, never relying on execution order.
- **Coverage is a guide, not a goal**: Aim for high test coverage but prioritize testing critical paths and edge cases over achieving arbitrary percentage targets.

## Performance

- **Prevent N+1 queries**: Use `includes`, `preload`, or `eager_load` to eliminate N+1 query problems. Enable query logging in development to catch violations early.
- **Use database indices strategically**: Index foreign keys, columns in WHERE clauses, and frequently joined columns. Review query plans for slow queries.
- **Counter caches for associations**: Use `counter_cache: true` on associations that are frequently counted to avoid repeated COUNT queries.
- **Fragment and Russian doll caching**: Cache expensive view fragments using Rails caching, especially with nested resource hierarchies (Russian doll caching pattern).
- **Select only needed columns**: Use `.select` to fetch only required columns when working with large tables or serializing records to JSON.
- **Background jobs for slow operations**: Move time-consuming tasks (emails, external APIs, complex calculations) to background jobs using Sidekiq or similar.
- **Profile before optimizing**: Use tools like Rack Mini Profiler, Bullet, or New Relic to identify actual bottlenecks before making optimization assumptions.

## Security

- **Strong parameters everywhere**: Always use strong parameters (`params.require().permit()`) in controllers to whitelist allowed attributes, never `params` directly.
- **Use proven authentication gems**: Prefer battle-tested solutions like Devise or Sorcery over rolling your own authentication system.
- **Authorization with Pundit or CanCanCan**: Implement explicit authorization policies using Pundit or CanCanCan to control resource access at the model/action level.
- **Validate and sanitize input**: Use Rails model validations for data integrity and sanitize user input displayed in views to prevent XSS attacks.
- **Secure credential management**: Use Rails encrypted credentials (`credentials.yml.enc`) or environment variables, never commit secrets to version control.

## Anti-Patterns

- **Avoid business logic in views**: Never put conditionals, calculations, or data manipulation in templates. Use presenters, decorators, or helper methods.
- **Don't bypass ActiveRecord callbacks carelessly**: Avoid `update_column`, `update_all`, or raw SQL that skips validations/callbacks unless you have specific performance needs and understand the consequences.
- **No god objects or fat models**: Models with thousands of lines indicate missing abstractions. Extract service objects, query objects, or form objects.
- **Resist controller filters for business logic**: Before/after filters should handle cross-cutting concerns (authentication, logging), not core business rules.
- **Don't rescue generic exceptions silently**: Never use bare `rescue` or `rescue => e` without logging/handling. Rescue specific exception classes and handle appropriately.
- **Avoid premature optimization**: Don't add caching, denormalization, or complex queries until profiling proves they're necessary. Readable code first, optimization second.
