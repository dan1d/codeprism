import type { Skill } from "./types.js";

export const djangoRestSkill: Skill = {
  id: "django_rest",
  label: "Django REST Framework",
  searchTag: "DRF serializer viewset permission throttle",
  searchContextPrefix:
    "Django REST Framework API: focus on serializers, ViewSets, APIView, permission classes, throttling, filtering, and pagination.",
  cardPromptHints:
    "This is a Django REST Framework (DRF) API. Emphasize: ModelSerializer and nested serializer relationships, ViewSet routing with DefaultRouter, permission classes, authentication classes (TokenAuthentication, JWTAuthentication), throttle classes, django-filter for query param filtering, and pagination classes.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.1,
    rules: 1.1,
    code_style: 1.0,
    readme: 0.7,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\/serializers\.py$/, role: "domain" },
    { pattern: /\/serializers\//, role: "domain" },
    { pattern: /\/views\.py$/, role: "domain" },
    { pattern: /\/views\//, role: "domain" },
    { pattern: /\/viewsets?\.py$/, role: "domain" },
    { pattern: /\/permissions?\.py$/, role: "shared_utility" },
    { pattern: /\/filters?\.py$/, role: "shared_utility" },
    { pattern: /\/pagination\.py$/, role: "shared_utility" },
    { pattern: /\/migrations\//, role: "config" },
    { pattern: /test_.*\.py$/, role: "test" },
  ],
  bestPractices: {
    architecture: [
      "Use ModelSerializer for standard CRUD; use Serializer for custom data shapes",
      "Use ViewSets with DefaultRouter for RESTful resources; use APIView for non-standard endpoints",
      "Apply permission classes at the view level; use object-level permissions for row-level access",
      "Use django-filter for query parameter filtering — do not filter manually in views",
      "Apply pagination globally in DEFAULT_PAGINATION_CLASS; override per-view only when necessary",
    ],
    codeStyle: [
      "Define serializer fields explicitly for read/write distinction — do not rely solely on depth",
      "Use SerializerMethodField for computed read-only fields",
      "Override get_queryset() for dynamic filtering based on the request user",
      "Use action decorators (@action) for custom ViewSet endpoints instead of separate APIViews",
      "Set throttle_classes at the view level for rate-limited endpoints",
    ],
    testing: [
      "Use DRF's APIClient in tests; use force_authenticate() for bypassing auth in unit tests",
      "Test serializer validation separately from view tests",
      "Use factory_boy for test data; avoid fixtures",
      "Test permission classes with a matrix of user roles and expected status codes",
      "Use pytest-django with @pytest.mark.django_db for all database tests",
    ],
    performance: [
      "Use select_related and prefetch_related in get_queryset() to prevent N+1 in serializers",
      "Use SerializerMethodField only for fields that cannot be computed at the database level",
      "Enable database-level pagination — never paginate Python lists",
      "Cache read-heavy list endpoints with DRF's CacheResponseMixin or Django's cache_page",
      "Use defer() and only() to limit database columns when serializers use few fields",
    ],
    security: [
      "Always set DEFAULT_AUTHENTICATION_CLASSES and DEFAULT_PERMISSION_CLASSES globally",
      "Use IsAuthenticated as the minimum permission for all non-public endpoints",
      "Validate file uploads in serializers: restrict MIME type and file size",
      "Never return sensitive fields (passwords, tokens) in serializer output — use write_only=True",
      "Apply throttling on authentication endpoints to prevent brute-force attacks",
    ],
    antiPatterns: [
      "Serializers that bypass validation with save(commit=False) or direct model manipulation",
      "Views that perform business logic instead of delegating to service functions",
      "Missing select_related causing N+1 per serializer object in a list response",
      "Using depth on ModelSerializer instead of explicit nested serializers (over-exposes data)",
      "Missing permission classes on views, exposing data to unauthenticated users",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.78,
    knownExceptions: [
      "Migration files",
      "Admin registration files (admin.py)",
      "Management command files",
    ],
  },
};

export default djangoRestSkill;
