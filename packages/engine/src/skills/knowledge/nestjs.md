# NestJS Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Organize code into feature modules; each module owns its controller, service, repository, DTOs, and entities
- Use dependency injection (NestJS DI container) for all services — never instantiate services with `new`
- Define clear module boundaries with `exports` — only expose what other modules need
- Use Guards for authentication and authorization; use Interceptors for cross-cutting concerns (logging, transformation)
- Use Pipes for input transformation and validation at the controller boundary, not inside services

## Code Style
- Use `PascalCase` for classes; `camelCase` for methods and properties; `kebab-case` for file names
- Decorate every controller method with the correct HTTP method decorator (`@Get`, `@Post`, etc.) and `@HttpCode`
- Define DTOs as classes (not interfaces) so class-validator decorators work at runtime
- Annotate every DTO property with `class-validator` decorators (`@IsString`, `@IsInt`, etc.) and use `ValidationPipe` globally
- Use the `@ApiProperty()` decorator from `@nestjs/swagger` on all DTO fields for auto-generated OpenAPI docs

## Testing
- Unit-test services using the `Test.createTestingModule` helper with mocked dependencies
- Use `jest.fn()` mocks for repositories and external services; avoid spinning up a real DB for unit tests
- Write e2e tests with `@nestjs/testing` + `supertest` against the full application bootstrap
- Test Guards and Interceptors in isolation by calling them with mock `ExecutionContext` objects
- Use `@faker-js/faker` or custom factories for generating test data in e2e tests

## Performance
- Use `fastify` adapter instead of the default Express adapter for higher throughput in performance-critical services
- Apply response caching with `CacheModule` (backed by Redis) on read-heavy endpoints with `@UseInterceptors(CacheInterceptor)`
- Use the `BullModule` (Bull/BullMQ) for background job queues; don't process async work synchronously in request handlers
- Lazy-load feature modules that are not needed at startup using `LazyModuleLoader`
- Use database connection pooling (`TypeORM` or `Prisma`) with appropriate pool sizes for concurrent load

## Security
- Use `@nestjs/passport` with JWT strategy for API authentication; validate tokens in a Guard, not in services
- Apply `helmet()` middleware for security headers (CSP, HSTS, X-Frame-Options)
- Enable CORS with an explicit whitelist; avoid `origin: '*'` in production
- Use rate limiting with `@nestjs/throttler`; apply at the global level with `ThrottlerGuard`
- Never log request bodies containing passwords or tokens; use a custom `LoggingInterceptor` that redacts sensitive fields

## Anti-Patterns to Flag
- Business logic in controllers — move to services; controllers should only orchestrate
- Circular module dependencies — use `forwardRef()` as a last resort; restructure module boundaries first
- Using `any` types in TypeScript — defeat the purpose of the framework's type safety
- Mutating the incoming DTO object in a service — treat DTOs as immutable input
- Not using `ValidationPipe` globally — raw, unvalidated data reaches services
- Large, monolithic `AppModule` — split into feature modules with clear responsibilities
