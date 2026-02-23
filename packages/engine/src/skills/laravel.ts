import type { Skill } from "./types.js";

export const laravelSkill: Skill = {
  id: "laravel",
  label: "Laravel (PHP)",
  searchTag: "Laravel Eloquent controller middleware",
  searchContextPrefix:
    "Laravel PHP application: focus on Eloquent models, controllers, service providers, form requests, jobs, and middleware.",
  cardPromptHints:
    "This is a Laravel application. Emphasize: Eloquent model relationships, Form Request validation classes, service providers and container bindings, Artisan commands, queued jobs, and Laravel's MVC conventions.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.1,
    rules: 1.1,
    code_style: 1.0,
    readme: 0.7,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /app\/Models\//, role: "domain" },
    { pattern: /app\/Services\//, role: "domain" },
    { pattern: /app\/Repositories\//, role: "domain" },
    { pattern: /app\/Jobs\//, role: "domain" },
    { pattern: /app\/Policies\//, role: "domain" },
    { pattern: /app\/Http\/Requests\//, role: "domain" },
    { pattern: /database\/migrations\//, role: "config" },
    { pattern: /tests\//, role: "test" },
  ],
  bestPractices: {
    architecture: [
      "Use Form Request classes for all input validation — never validate in controllers",
      "Keep controllers thin: delegate business logic to service classes or action classes",
      "Use the repository pattern for data access abstraction when the project is large",
      "Register services and interfaces in service providers, not ad hoc in controllers",
      "Use queued jobs for time-consuming tasks like emails, reports, and third-party API calls",
    ],
    codeStyle: [
      "Follow PSR-12 coding standards; enforce with Laravel Pint or PHP CS Fixer",
      "Use snake_case for database columns, camelCase for PHP methods and variables",
      "Use Eloquent relationships instead of raw joins; name relationships in plural/singular per convention",
      "Use named routes and the route() helper — avoid hardcoded URL strings",
      "Return typed responses (JsonResponse, RedirectResponse) from controller methods",
    ],
    testing: [
      "Use PHPUnit with Laravel's test helpers (TestCase, RefreshDatabase, etc.)",
      "Use feature tests for HTTP endpoints and unit tests for service/domain classes",
      "Use factories for test data — avoid fixtures",
      "Use Mockery or PHPUnit mocks for external service dependencies",
      "Use actingAs() for authentication in feature tests",
    ],
    performance: [
      "Use eager loading (with()) for relationships accessed in loops to prevent N+1",
      "Cache expensive queries with Cache::remember(); use Redis in production",
      "Use database-level indexes on foreign keys and frequently filtered columns",
      "Use chunking (chunk(), chunkById()) for processing large Eloquent collections",
      "Offload file processing and emails to queued jobs",
    ],
    security: [
      "Always use Eloquent or parameterized query builder calls — never raw SQL with user input",
      "Use Laravel's Gate and Policy classes for authorization; check authorization before acting",
      "Set CSRF protection on all state-changing web routes (already enabled by default)",
      "Validate file uploads: check MIME type, file size, and extension",
      "Store secrets in .env and access via config() — never hardcode credentials",
    ],
    antiPatterns: [
      "Business logic in Blade templates or controllers",
      "Raw DB::statement() with string-interpolated user input",
      "Accessing environment variables directly with env() outside config files",
      "Eager loading too many relationships causing large result sets",
      "Not using database transactions for multi-step write operations",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.78,
    knownExceptions: [
      "Migration files (database/migrations/)",
      "Seeder files with deliberately simple inline logic",
      "Test helper methods in base TestCase",
    ],
  },
};

export default laravelSkill;
