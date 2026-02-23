import type { Skill } from "./types.js";

export const railsSkill: Skill = {
  id: "rails",
  label: "Ruby on Rails",
  searchTag: "Rails ActiveRecord model controller",
  searchContextPrefix:
    "Ruby on Rails codebase: focus on ActiveRecord models, controllers, service objects, Pundit policies, Sidekiq jobs, and concerns.",
  cardPromptHints:
    "This is a Ruby on Rails application. Emphasize: ActiveRecord associations (belongs_to, has_many, polymorphic), Pundit authorization policies, Sidekiq background jobs, service objects in app/services/, concerns in app/models/concerns/, and schema.rb as source of truth for data structure.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.0,
    rules: 1.1,
    code_style: 0.8,
    readme: 0.6,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /app\/jobs\//, role: "domain" },
    { pattern: /app\/serializers\//, role: "domain" },
    { pattern: /app\/services\//, role: "domain" },
    { pattern: /app\/decorators\//, role: "domain" },
    { pattern: /app\/policies\//, role: "domain" },
  ],
  bestPractices: {
    architecture: [
      "Use service objects in app/services/ for business logic with more than 3 steps",
      "Keep controllers thin — delegate computation to service objects or model methods",
      "Use concerns for shared model/controller behavior; keep them focused on one aspect",
      "Use Pundit for authorization and Devise for authentication — do not roll your own",
      "Use Sidekiq for background jobs; prefer async jobs over synchronous in-request work > 100ms",
    ],
    codeStyle: [
      "Method length should stay under 10 lines; extract helpers for longer logic",
      "Avoid endless/1-line method bodies (def foo = bar) — use explicit def/end for readability",
      "Use snake_case for methods and variables, CamelCase for classes and modules",
      "Prefer descriptive method names that read like English sentences (e.g. patient.needs_authorization?)",
      "Use guard clauses and early returns rather than deeply nested conditionals",
      "Prefix predicate methods with a verb (valid?, authorized?, needs_review?)",
    ],
    testing: [
      "Use RSpec with FactoryBot; avoid fixtures",
      "Write request specs for API endpoints, model specs for validations and scopes",
      "One expectation per example where practical; describe expected behavior not implementation",
      "Use shared_examples for behaviors shared across multiple model types",
      "Mock external HTTP calls with WebMock; use VCR for complex integrations",
    ],
    performance: [
      "Always use includes/joins for associations accessed in loops to prevent N+1 queries",
      "Add database-level indexes on all foreign keys and frequently filtered columns",
      "Use scopes for chainable query composition rather than class methods that return arrays",
      "Use counter_cache for frequently counted has_many associations",
      "Use select() to limit columns fetched when only a subset is needed",
    ],
    security: [
      "Always use strong_parameters in controllers — never mass-assign params directly",
      "Never interpolate user input into raw SQL strings; use parameterized queries",
      "Use Pundit policies for all resource-level authorization checks",
      "Sanitize user-generated content before rendering in views",
      "Validate file uploads: restrict MIME type, file size, and reject path traversal",
    ],
    antiPatterns: [
      "Fat controllers with embedded business logic",
      "Logic in views or ERB templates beyond simple conditionals",
      "Using send() or eval() with user-supplied input",
      "Missing database indexes on foreign key columns",
      "ActiveRecord callbacks that trigger external side effects (prefer service objects)",
      "Using rescue Exception instead of StandardError (catches system exits and signals)",
      "Returning raw as_json output from controllers without explicit serializers (exposes internal structure)",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.80,
    knownExceptions: [
      "Rack middleware DSL blocks",
      "Route definition blocks (routes.rb)",
      "FactoryBot factory definitions",
      "RSpec shared_context and shared_examples blocks",
      "ActiveAdmin registration blocks",
      "schema.rb migration DSL",
    ],
  },
};

export default railsSkill;
