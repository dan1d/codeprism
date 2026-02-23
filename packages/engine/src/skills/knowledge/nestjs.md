# NestJS (Node.js) Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Prefer module-per-feature organization** over technical layers; each feature module encapsulates controllers, services, entities, and DTOs related to a single domain concept
- **Use dynamic modules with `forRoot()`/`forRootAsync()` for configurable shared modules** (database, cache, auth) rather than static imports with hardcoded configuration
- **Implement domain logic in services**, keep controllers thin (routing, validation, response mapping only), and extract complex business rules into dedicated domain service classes
- **Use dependency injection throughout**; register all classes with `@Injectable()` and inject via constructor parameters, avoiding manual instantiation with `new`
- **Establish clear module boundaries** with explicit exports; only export classes intended for cross-module use and keep implementation details private
- **Prefer command/query separation (CQRS)** for complex domains using `@nestjs/cqrs`; use simple service methods for CRUD operations
- **Use interceptors for cross-cutting concerns** (logging, transformation, caching) rather than duplicating logic across controllers or services
- **Create a shared/common module** for cross-cutting utilities, guards, interceptors, and decorators; avoid circular dependencies by keeping it free of feature-specific logic
- **Use DTOs for all external boundaries** (API requests/responses, events); never expose database entities directly in controllers
- **Implement repository pattern for data access**; abstract database operations behind repository interfaces, injecting repositories into services rather than direct ORM access

## Code Style

- **Use PascalCase for classes** (controllers, services, modules, entities, DTOs) and camelCase for methods, variables, and properties
- **Prefix interfaces with `I` only for ports/abstractions**; prefer class-based DTOs with `class-validator` decorators over plain interfaces
- **Name controllers with `Controller` suffix** (e.g., `UsersController`), services with `Service` suffix, and keep one primary resource per controller
- **Keep methods under 20 lines**; extract complex logic into private helper methods or separate service classes
- **Use explicit return types** on all public methods; prefer `Promise<Type>` over implicit returns for async operations
- **Prefer async/await over raw promises**; use `Promise.all()` for concurrent operations and avoid nested `.then()` chains
- **Use decorators declaratively at the top of classes/methods**; order as: route decorators, guard/interceptor decorators, OpenAPI decorators, validation decorators
- **Destructure only what you need** from injected dependencies; avoid renaming during destructure to maintain clarity
- **Use `const` by default**, `let` only when reassignment is necessary; never use `var`
- **Prefer template literals over string concatenation**; use meaningful variable names in interpolations rather than complex expressions

## Testing

- **Use Jest as the testing framework**; leverage NestJS testing utilities (`@nestjs/testing`) for dependency injection in tests
- **Prefer `Test.createTestingModule()` for unit tests** to mock dependencies cleanly; use `.overrideProvider()` to replace real implementations with mocks
- **Create integration tests with `supertest`** for e2e controller testing; spin up full application context with test database/external service mocks
- **Use factories (e.g., `@faker-js/faker`) over fixtures** for test data generation; create builder functions that return valid domain objects with customizable properties
- **Test business logic in services**, not controllers; controller tests should verify routing, guards, and response transformation only
- **Aim for 80%+ coverage on services and domain logic**; controllers and DTOs require less coverage as they contain minimal logic
- **Mock external dependencies** (databases, HTTP clients, queues) in unit tests; use in-memory or containerized alternatives for integration tests

## Performance

- **Prevent N+1 queries** by using eager loading with relations, `queryBuilder` with explicit joins, or DataLoader pattern for GraphQL resolvers
- **Implement caching with interceptors** using `@nestjs/cache-manager`; cache at the controller method level for expensive read operations with appropriate TTL
- **Use database connection pooling**; configure pool size based on load testing, typically 10-20 connections per instance
- **Implement pagination for all list endpoints**; use cursor-based pagination for real-time data, offset-based for static datasets
- **Profile with Clinic.js or Node.js built-in profiler** to identify bottlenecks; add custom metrics with `@nestjs/metrics` (Prometheus integration)
- **Use streams for large file processing**; avoid loading entire files into memory, prefer `@nestjs/throttler` to rate-limit expensive operations

## Security

- **Use `@nestjs/passport` with JWT strategy** for stateless authentication; store tokens in httpOnly cookies or use short-lived access tokens with refresh token rotation
- **Implement RBAC with custom guards**; create `@Roles()` decorator and guard that checks `user.roles` against required roles from metadata
- **Validate all inputs with `class-validator`**; use `ValidationPipe` globally with `whitelist: true` and `forbidNonWhitelisted: true` to strip unknown properties
- **Use `@nestjs/helmet` and enable CORS** with explicit origin whitelist; never use `origin: '*'` in production
- **Store secrets in environment variables** loaded via `@nestjs/config`; use `ConfigService.get()` with validation schema, never commit `.env` files to version control

## Anti-Patterns

- **Avoid injecting repositories into controllers**; always mediate data access through service layer to maintain separation of concerns
- **Don't use `@Res()` or `@Next()` decorators** unless absolutely necessary (streaming, SSE); they bypass NestJS response handling and break interceptors
- **Never perform business logic in guards or interceptors**; guards check authorization, interceptors transform data—complex logic belongs in services
- **Avoid circular dependencies between modules**; use forward references `forwardRef()` only as last resort, prefer refactoring into separate modules
- **Don't catch and swallow exceptions silently**; use exception filters to handle errors globally, let NestJS convert exceptions to HTTP responses
