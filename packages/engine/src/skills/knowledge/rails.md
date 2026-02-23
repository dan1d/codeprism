# Rails Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Follow MVC strictly: controllers orchestrate, models encapsulate data and domain logic, views render
- Use service objects in `app/services/` for multi-step business logic that doesn't belong on a model
- Use Pundit policies in `app/policies/` for all authorization decisions
- Use Sidekiq jobs in `app/jobs/` for async work; keep jobs thin by delegating to service objects
- Use concerns sparingly — prefer explicit service objects over mixin-heavy models
- Keep controllers RESTful; use `only:` / `except:` on `resources` to limit exposed actions
- Treat `db/schema.rb` as the source of truth for data structure, not migration files

## Code Style
- Use `snake_case` for files, methods, variables; `CamelCase` for classes and modules
- Prefer keyword arguments for methods with more than two parameters
- Use `frozen_string_literal: true` at the top of every Ruby file
- Avoid `before_action` chains longer than three; extract to a concern or move logic to service
- Return early from methods rather than deeply nesting conditionals
- Use `scope` over class methods for chainable ActiveRecord queries

## Testing
- Use RSpec with FactoryBot; keep factories minimal and use `traits` for variations
- Test service objects and models directly; avoid excessive controller specs
- Use `let` / `let!` over instance variables in specs; prefer `let!` only when ordering matters
- Group expectations with `aggregate_failures` to catch all failures in one run
- Use shared examples sparingly — they obscure what a spec actually tests

## Performance
- Add database indexes for every foreign key and any column used in frequent WHERE/ORDER clauses
- Use `includes` / `eager_load` to eliminate N+1 queries; detect with Bullet gem
- Use `select` to limit columns fetched when full models aren't needed
- Avoid callbacks (especially `after_save`) for side effects; use service objects explicitly
- Cache expensive queries with Rails.cache and appropriate expiry; key on model `cache_key_with_version`

## Security
- Never trust user-supplied params — use strong parameters (`permit`) in every controller action
- Use `attr_encrypted` or Rails credentials for storing sensitive values; never hardcode secrets
- Scope all queries through current user associations or Pundit policies to prevent IDOR
- Set `Content-Security-Policy` headers; avoid `html_safe` / `raw` with unsanitized input
- Use `protect_from_forgery with: :exception` (default); disable CSRF only for JSON API endpoints with token auth

## Anti-Patterns to Flag
- Fat controllers that contain business logic — move to service objects
- Callbacks used for cross-model side effects — use service objects instead
- `User.find` without scoping to tenant/organization — potential data leak
- `render json: @model.as_json` exposing all attributes — use serializers
- Missing database indexes on foreign keys or search columns
- `rescue Exception` (catches signal exceptions) — rescue `StandardError` or specific subclasses
