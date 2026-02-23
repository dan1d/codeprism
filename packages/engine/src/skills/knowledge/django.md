# Django (Python) Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Service layer pattern**: Extract business logic into dedicated service functions/classes in `services.py`, keeping views thin and models free of complex logic
- **Selector pattern**: Separate read operations into `selectors.py` modules that encapsulate all database query logic with `select_related()` and `prefetch_related()`
- **Fat models, thin views, dumb templates**: Models contain data structure and simple methods; views orchestrate services/selectors; templates only render
- **Base model pattern**: Use abstract base models with `BaseModel` containing common fields (`created_at`, `updated_at`) and inherit throughout the project
- **Module organization**: Group related functionality by domain (`users/`, `orders/`) rather than by type (`models/`, `views/`), with each app containing `models.py`, `services.py`, `selectors.py`, `apis.py`
- **Service naming**: Use explicit verb-noun naming like `user_create()`, `order_process()`, `payment_refund()` rather than generic CRUD names
- **API layer separation**: Keep Django REST Framework serializers and views in `apis.py` separate from business logic; APIs should only validate input and call services
- **Avoid business logic in serializers**: Serializers handle serialization/deserialization only; move creation/update logic to services called from API views
- **Explicit over implicit**: Prefer function-based services over class-based unless clear state/inheritance benefits exist; favor clarity over cleverness

## Code Style

- **Service functions**: Name as `noun_verb()` format (e.g., `user_create()`, `email_send()`) and place in `{app}/services.py`
- **Selector functions**: Name as `noun_verb()` or `noun_get_queryset()` format (e.g., `user_get()`, `order_list()`) and place in `{app}/selectors.py`
- **API naming**: Name API views/viewsets with `{Noun}{Action}Api` suffix (e.g., `UserCreateApi`, `OrderListApi`) in `{app}/apis.py`
- **Model methods**: Keep minimal; use only for simple derived properties or string representations; complex operations belong in services
- **Type hints**: Use Python type annotations for all function signatures, especially service/selector boundaries for clarity
- **Import organization**: Group imports as (1) standard library, (2) third-party, (3) Django, (4) local apps, with blank lines between groups
- **Querysets in models**: Define custom `QuerySet` and `Manager` classes for reusable query logic, attach to models via `objects = CustomManager()`
- **Model validation**: Implement `clean()` methods for field-level validation and use model `Meta.constraints` for database-level validation
- **Avoid magic**: No metaprogramming, dynamic imports, or implicit behaviors; prefer explicit, greppable code paths

## Testing

- **Factory pattern**: Use `factory_boy` for test data generation over fixtures; create factories in `tests/factories.py` for each model
- **Test organization**: Structure tests as `tests/test_{module}.py` mirroring source structure; test services, selectors, and APIs separately
- **Test naming**: Name tests as `test_{function_name}_{scenario}_{expected_outcome}` (e.g., `test_user_create_with_invalid_email_raises_validation_error`)
- **Service/selector testing**: Test business logic directly by calling service/selector functions, not through HTTP layer
- **API testing**: Use DRF's `APITestCase` and `APIClient` to test endpoints; verify status codes, response structure, and side effects
- **Minimal mocking**: Prefer real database interactions in tests; mock only external services (APIs, email, payment gateways)
- **Transaction handling**: Use `TransactionTestCase` only when testing transaction-specific behavior; default to `TestCase` for speed

## Performance

- **Always use select_related/prefetch_related**: Encapsulate in selectors; never allow N+1 queries in production code; use `django-debug-toolbar` to detect
- **Queryset optimization in selectors**: All database access goes through selector functions that include necessary `only()`, `defer()`, `select_related()`, `prefetch_related()`
- **Caching strategy**: Cache expensive querysets/computations in services using Django's cache framework; invalidate explicitly on writes
- **Bulk operations**: Use `bulk_create()`, `bulk_update()`, and `update()` for multiple objects; avoid loops calling `save()`
- **Index strategically**: Add database indexes to foreign keys, fields used in `filter()`/`order_by()`, and unique constraints; verify with `EXPLAIN` queries
- **Pagination always**: Use `PageNumberPagination` or `CursorPagination` for list endpoints; never return unbounded querysets
- **Monitor query counts**: Set up query count assertions in critical path tests; fail tests if queries exceed thresholds

## Security

- **Validate in services**: All user input validation occurs in service layer using Django's `ValidationError`; raise before database operations
- **Use Django ORM safely**: Never interpolate strings into raw SQL; use parameterized queries or ORM exclusively
- **Permission checks in APIs**: Check permissions at API entry points before calling services; use DRF's permission classes or custom decorators
- **Secret management**: Load secrets from environment variables; never commit `.env` files; use `django-environ` or similar for typed environment parsing
- **CSRF/CORS configuration**: Configure `CSRF_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS` explicitly; never use wildcards in production

## Anti-Patterns

- **Business logic in serializers**: Never put create/update logic in `create()`/`update()` methods; serializers only validate and transform data
- **Fat views**: Avoid complex logic in views/viewsets; views should call one service function and return a response
- **Signals for business logic**: Don't use Django signals for core business logic; they create hidden dependencies and are hard to test
- **Generic naming**: Avoid services named `create()`, `update()`, `process()` without noun context; always specify what is being acted upon
- **Mixing layers**: Services should not import from APIs; APIs import from services; maintain unid
