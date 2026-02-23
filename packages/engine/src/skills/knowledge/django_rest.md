# Django REST Framework Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Use `ViewSet` + `DefaultRouter` for standard CRUD resources; use `APIView` or `@api_view` for non-RESTful endpoints
- Define serializers in a dedicated `serializers.py` per app; avoid inline serializer definitions in views
- Apply permission classes globally as a default in settings (`DEFAULT_PERMISSION_CLASSES`) and override per-view only when needed
- Use `ModelSerializer` as the base for ORM-backed serializers; define `fields = "__all__"` only in internal tooling, never in public APIs
- Separate read serializers (with nested representations) from write serializers (with flat IDs) for complex resources

## Code Style
- Use `serializers.Serializer` for non-model inputs (e.g., action endpoints); don't abuse `ModelSerializer` for arbitrary payloads
- Always define `read_only_fields` or `read_only=True` on auto-generated and system fields (`id`, `created_at`)
- Raise `serializers.ValidationError` from `validate_<field>` and `validate` methods — never raise inside views
- Use DRF's `@action` decorator for custom actions on ViewSets; avoid bolting them onto list/retrieve
- Return meaningful HTTP status codes: 201 for creation, 204 for deletions, 400 for validation errors, 403 for authorization failures

## Testing
- Use `APITestCase` or `pytest-django` + `APIClient` for endpoint tests
- Authenticate test clients with `client.force_authenticate(user=user)` — don't bypass auth in views
- Test serializer validation independently from views with `serializer.is_valid()` assertions
- Use `factory_boy` with `DjangoModelFactory` for all test fixtures; avoid hardcoded `Model.objects.create` in tests
- Assert on response `status_code` and `response.data` structure, not on raw JSON strings

## Performance
- Use `select_related` and `prefetch_related` in ViewSet `get_queryset()` to avoid N+1 for nested serializers
- Apply `django-filter` with `FilterBackend` for query param filtering rather than filtering in serializer `to_representation`
- Use `drf-spectacular` or `drf-yasg` for OpenAPI schema generation; maintain schema accuracy alongside code
- Paginate all list endpoints — configure `DEFAULT_PAGINATION_CLASS` and `PAGE_SIZE` globally; never return unbounded lists
- Cache read-only list endpoints with `cache_page` decorator or DRF's `CacheResponseMixin` for stable data

## Security
- Apply `IsAuthenticated` as the global default permission; explicitly allow anonymous access where needed with `AllowAny`
- Use object-level permissions (`has_object_permission`) to enforce resource ownership — never rely solely on view-level permissions
- Validate file uploads for type, size, and content before saving; use `FileExtensionValidator`
- Rate-limit API endpoints with `djangorestframework-simplejwt` throttling or `django-ratelimit`
- Never expose internal Django error tracebacks — set `DEBUG = False` and define custom exception handlers

## Anti-Patterns to Flag
- Returning `ModelSerializer` with all fields on sensitive models — explicitly list `fields` and exclude sensitive data
- Overriding `to_representation` for validation logic — use `validate_<field>` methods instead
- Unbounded list views without pagination — always set `pagination_class`
- Mixing query logic into serializers — keep database access in ViewSet `get_queryset()` or service functions
- Using `APIView` for standard CRUD when `ModelViewSet` would eliminate boilerplate
- Granting `IsAdminUser` as the only protection when row-level scoping is also needed
