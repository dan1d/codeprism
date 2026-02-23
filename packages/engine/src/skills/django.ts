import type { Skill } from "./types.js";

export const djangoSkill: Skill = {
  id: "django",
  label: "Django (Python)",
  searchTag: "Django model view serializer queryset",
  searchContextPrefix:
    "Django Python application: focus on ORM models, views, serializers, URL patterns, signals, and management commands.",
  cardPromptHints:
    "This is a Django application. Emphasize: ORM model relationships and QuerySets, class-based views or function-based views, forms or serializers (DRF), URL routing, signals, middleware, and management commands.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.1,
    rules: 1.0,
    code_style: 1.0,
    readme: 0.7,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\/models\.py$/, role: "domain" },
    { pattern: /\/models\//, role: "domain" },
    { pattern: /\/views\.py$/, role: "domain" },
    { pattern: /\/views\//, role: "domain" },
    { pattern: /\/serializers\.py$/, role: "domain" },
    { pattern: /\/migrations\//, role: "config" },
    { pattern: /\/management\/commands\//, role: "domain" },
    { pattern: /\/tests\//, role: "test" },
    { pattern: /test_.*\.py$/, role: "test" },
    { pattern: /settings.*\.py$/, role: "config" },
  ],
  bestPractices: {
    architecture: [
      "Follow the fat models / thin views pattern — business logic belongs in models or service modules",
      "Keep apps focused on a single domain; avoid monolithic apps with unrelated models",
      "Use select_related and prefetch_related for relationship traversal in views",
      "Use signals sparingly — prefer explicit service calls for cross-app side effects",
      "Use management commands for administrative tasks and data migrations",
    ],
    codeStyle: [
      "Define __str__ and Meta on every model; include ordering where relevant",
      "Use class-based views (CBVs) for CRUD operations; function-based views for complex custom logic",
      "Name URL patterns with the convention: app_name:action (e.g. patients:detail)",
      "Use verbose_name and verbose_name_plural on every model for admin readability",
      "Prefix signals with the app name (patient_activated) to avoid name collisions",
    ],
    testing: [
      "Use pytest-django for testing; use TestCase subclasses for database tests",
      "Use RequestFactory or APIClient (DRF) for view tests",
      "Use baker or factory_boy for test data — avoid fixtures",
      "Isolate tests from real external services using responses or httpretty",
      "Test model methods, manager methods, and signal handlers with unit tests",
    ],
    performance: [
      "Always use select_related (FK, OneToOne) and prefetch_related (M2M, reverse FK) to prevent N+1",
      "Use values() or values_list() when you only need a subset of fields",
      "Add database indexes on frequently filtered and ordered fields",
      "Use bulk_create and bulk_update for batch operations — avoid loops with save()",
      "Cache querysets with cache.get/cache.set or Django's per-view cache for read-heavy data",
    ],
    security: [
      "Use Django's ORM — never format SQL strings with user input",
      "Apply login_required and permission_required on all protected views",
      "Keep DEBUG=False in production; do not expose stack traces to clients",
      "Use Django's CSRF protection — do not exempt views unnecessarily",
      "Validate file uploads: check content type and file size before processing",
    ],
    antiPatterns: [
      "Fat views with business logic that belongs in models or services",
      "Using raw SQL without parameterized placeholders",
      "Forgetting to apply select_related, causing N+1 in queryset loops",
      "Overusing signals for logic that would be clearer as an explicit service call",
      "Hardcoding SECRET_KEY or database credentials in settings.py",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.78,
    knownExceptions: [
      "Migration files in migrations/ directories",
      "Management command files",
      "Django admin registrations in admin.py",
    ],
  },
};

export default djangoSkill;
