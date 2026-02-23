# Django Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Use a "fat models, thin views" pattern — domain logic belongs on the model or in a service module, not in views
- Organize by Django apps (`python manage.py startapp`) that each own a bounded slice of the domain
- Use class-based views (CBVs) for CRUD; use function-based views for complex custom logic where CBV mixins obscure intent
- Place business logic that spans multiple models in service modules (`services.py`) rather than in views or signals
- Use custom model managers for reusable query logic; keep raw SQL in managers, not views

## Code Style
- Follow PEP 8; enforce with `ruff` and `black`; import order enforced by `isort` or `ruff`
- Use `snake_case` for everything in Python; Django's ORM maps to `snake_case` table and column names
- Declare `__str__` on every model for human-readable admin and debug output
- Use `verbose_name` and `verbose_name_plural` in model `Meta` for clean admin display
- Prefer `get_object_or_404` and `get_list_or_404` over raw `get()`/`filter()` in views for cleaner error handling

## Testing
- Use `pytest-django` with `@pytest.mark.django_db` for database tests; avoid `unittest.TestCase` for new tests
- Use `factory_boy` with `DjangoModelFactory` for test data; define `class Meta: model = MyModel`
- Test views with Django's `RequestFactory` for unit tests; use `Client` for integration tests
- Use `override_settings` to swap settings (email backend, cache, storage) in tests without patching
- Test migrations with `--check` in CI: `python manage.py migrate --check`

## Performance
- Add `select_related` for `ForeignKey`/`OneToOne` and `prefetch_related` for `ManyToMany`/reverse FK to eliminate N+1
- Use `only()` and `defer()` to limit fetched columns on large models
- Apply database indexes via `db_index=True` on model fields used in filtering, and composite indexes in `Meta.indexes`
- Use Django's cache framework with Redis for per-view and per-object caching
- Use `bulk_create` and `bulk_update` for batch operations instead of per-instance saves

## Security
- Use Django's authentication system; avoid reimplementing login/session management
- Apply `@login_required` or `LoginRequiredMixin` on all protected views; use `permission_required` for role-based access
- Use Django's CSRF middleware (enabled by default); mark API views with `@csrf_exempt` only when using token auth
- Validate all user input at the form or serializer layer — never pass raw request data to ORM queries
- Set `ALLOWED_HOSTS`, `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, and `CSRF_COOKIE_SECURE` in production settings

## Anti-Patterns to Flag
- Business logic in templates or views — move to model methods or service modules
- Using `raw()` or `extra()` with unsanitized user input — use parameterized queries
- `Model.objects.all()` without pagination on large tables — always paginate
- Signals used for cross-model side effects in ways that are hard to trace — prefer explicit service calls
- Setting `DEBUG = True` or `ALLOWED_HOSTS = ['*']` in production configuration
- Migrations that edit data inside `RunPython` without handling reverse migrations
