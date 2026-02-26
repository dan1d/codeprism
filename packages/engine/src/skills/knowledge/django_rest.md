# Django REST Framework Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Prefer ViewSets over APIView** for standard CRUD operations; use APIView only for non-standard endpoints that don't map to model operations
- **Keep business logic in services or model methods**, not in serializers or views; serializers handle data transformation only
- **Use explicit serializer classes** per action when fields differ (list vs detail); avoid dynamic field manipulation in `get_serializer()` unless necessary
- **Organize by app domain** (users, orders, products) rather than by layer (all serializers in one module); keep related views, serializers, and tests together
- **Leverage nested routers** for hierarchical resources (`/users/{id}/posts/`) instead of flat URL structures with query parameters
- **Prefer model serializers** over plain serializers; only use `Serializer` base class when not mapping directly to models
- **Use serializer composition** (nested serializers, SerializerMethodField) rather than custom render methods or data post-processing in views
- **Implement pagination at the view/viewset level** with consistent pagination classes across the API; avoid manual pagination logic
- **Separate read and write serializers** when update/create operations require different fields than retrieval operations
- **Use permissions at the view level** and object-level permissions for fine-grained access control; avoid authorization logic in serializers

## Code Style

- **Name serializers with `Serializer` suffix** matching their model: `UserSerializer`, `OrderDetailSerializer`; use descriptive suffixes like `Create`, `Update`, `List` when specialized
- **Name viewsets with `ViewSet` suffix**: `UserViewSet`, `ProductViewSet`; use `APIView` suffix only for non-viewset views
- **Keep viewset methods under 15 lines**; extract complex logic to service functions, manager methods, or querysets
- **Use `get_queryset()` for filtering**, not `queryset` attribute, when dynamic logic is required; always annotate/prefetch in `get_queryset()`
- **Prefer explicit field declarations** in serializers over `fields = '__all__'`; whitelist fields for clarity and security
- **Use `SerializerMethodField` with `get_<field_name>` pattern** for computed fields; keep these methods simple and avoid N+1 queries
- **Name permission classes descriptively**: `IsOwnerOrReadOnly`, `IsAdminOrAuthenticatedReadOnly`; avoid generic names like `CustomPermission`
- **Use `related_name` consistently** in models for reverse relations; prefer plural nouns (`user.orders` not `user.order_set`)
- **Order serializer fields logically**: id first, then required fields, optional fields, then read-only/computed fields last
- **Use trailing commas** in multi-line lists, tuples, and dictionaries for cleaner diffs

## Testing

- **Use `APITestCase` or `APIClient`** for DRF endpoint tests; prefer `APIClient` with pytest for flexibility
- **Prefer factory_boy over fixtures** for test data generation; factories are more maintainable and composable
- **Test one behavior per test method**; separate tests for authentication, permissions, validation, and business logic
- **Use `reverse()` for URL generation** in tests to avoid hardcoded paths; test URL patterns remain resilient to changes
- **Test serializer validation independently** from view tests; unit test serializers with `serializer.is_valid()` assertions
- **Aim for 80%+ coverage** with focus on business logic, permissions, and validation; avoid testing framework code
- **Mock external services and expensive operations**; use `@patch` for third-party APIs, file uploads, and email sending

## Performance

- **Always use `select_related()` for foreign keys** and `prefetch_related()` for many-to-many and reverse foreign keys in `get_queryset()`
- **Enable Django Debug Toolbar in development** to identify N+1 queries; fail CI if query count exceeds thresholds for critical endpoints
- **Use `Prefetch` objects with custom querysets** for complex prefetching scenarios rather than post-processing in serializers
- **Implement pagination on all list endpoints**; use `PageNumberPagination` or `CursorPagination` for large datasets
- **Cache expensive computed fields** using `@cached_property` on models or Redis for API responses; invalidate caches explicitly on updates
- **Use `only()` and `defer()`** when serializers need subset of model fields to reduce database column fetching
- **Avoid SerializerMethodField for list endpoints** when it triggers per-object queries; prefer annotations or prefetching

## Security

- **Use token or JWT authentication** over session authentication for stateless APIs; prefer `rest_framework_simplejwt` for JWT
- **Implement throttling on all endpoints** with appropriate rates for anonymous and authenticated users; use stricter limits on write operations
- **Validate all input at the serializer level** with explicit validators; never trust client data or skip validation
- **Use object-level permissions** (`has_object_permission`) for resource ownership checks; don't rely on queryset filtering alone
- **Never expose sensitive fields** in serializers; use `extra_kwargs = {'password': {'write_only': True}}` and exclude tokens from responses
- **Enable CORS selectively** with `django-cors-headers`; avoid `CORS_ORIGIN_ALLOW_ALL = True` in production
- **Use Django's `SECRET_KEY` management** and rotate secrets; store secrets in environment variables, never in code

## Anti-Patterns

- **Avoid business logic in serializers' `create()` or `update()`** methods; serializers should only handle data transformation and validation
- **Don't override `to_representation()` for authorization**; filtering visible fields based on user permissions belongs in separate serializers or permissions
- **Never call `serializer.save()` multiple times** or modify `serializer.validated_data` directly; treat validated data as immutable
- **Don't use `@api_view` decorator for complex logic**; function-based views become unmaintainable; use ViewSets or class-based views
- **Avoid generic relation serialization without optimization**; generic foreign keys cause N+1 queries and should be prefetched carefully
- **Don't return different status codes for the same outcome**; be consistent with
