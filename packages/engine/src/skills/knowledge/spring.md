# Spring Boot Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Follow a layered architecture: Controller → Service → Repository; never skip layers
- Use `@Service`, `@Repository`, `@Controller`/`@RestController` stereotypes consistently — they enable AOP and exception translation
- Define interfaces for service and repository contracts; inject the interface, not the implementation
- Use Spring Data JPA repositories; only write custom `@Query` methods when auto-derived queries are insufficient
- Externalize configuration with `application.yml` / `application-{profile}.yml`; bind to `@ConfigurationProperties` beans

## Code Style
- Use constructor injection (not field injection) for all `@Autowired` dependencies — enables immutability and testability
- Define DTOs as Java records (Java 16+) or immutable classes; don't expose JPA entities directly from REST endpoints
- Use `@Valid` on request body parameters and define constraints with Bean Validation annotations (`@NotNull`, `@Size`, etc.)
- Return `ResponseEntity<T>` from controllers for explicit status code control
- Use `PascalCase` for classes; `camelCase` for methods and fields; `UPPER_SNAKE_CASE` for constants

## Testing
- Use `@SpringBootTest` for integration tests; use `@WebMvcTest` for controller slice tests (only loads web layer)
- Use `@DataJpaTest` for repository tests with an embedded H2 database
- Use Mockito (`@MockBean`) to stub dependencies in slice tests; use `@SpyBean` sparingly
- Use `MockMvc` or `WebTestClient` (for reactive apps) to test HTTP endpoints without a running server
- Use `@Testcontainers` with real database images for tests that must verify actual SQL dialect behavior

## Performance
- Avoid N+1 queries — use `@EntityGraph` or `JOIN FETCH` in JPQL for eager loading of specific associations
- Use `@Cacheable` from Spring Cache (backed by Redis/Caffeine) on read-heavy service methods
- Enable connection pooling via HikariCP (default in Spring Boot); tune `maximum-pool-size` for expected concurrency
- Use `@Async` for fire-and-forget operations; use Spring's `TaskScheduler` for scheduled work
- Profile with Spring Boot Actuator + Micrometer metrics before micro-optimizing

## Security
- Use Spring Security with JWT or OAuth2 Resource Server for API authentication
- Apply method-level security with `@PreAuthorize("hasRole('ADMIN')")` for fine-grained authorization
- Never expose internal entity IDs directly in REST responses if they reveal enumerable resources
- Configure CORS explicitly in `WebMvcConfigurer`; avoid allowing all origins (`*`) in production
- Use `PasswordEncoder` (BCrypt) for all password storage; never store plain-text or MD5-hashed passwords

## Anti-Patterns to Flag
- Field injection with `@Autowired` — use constructor injection for testability and immutability
- Exposing JPA entities directly as REST response bodies — use DTOs/records to control the API contract
- Catching and swallowing exceptions in `@Service` methods without rethrowing or logging
- Calling `entityManager.flush()` or `saveAndFlush()` mid-transaction without understanding the implications
- Using `Optional.get()` without `isPresent()` check — throws `NoSuchElementException`; use `orElseThrow()`
- Blocking calls inside reactive (`WebFlux`) chains — use non-blocking alternatives or schedule on a bounded elastic scheduler
