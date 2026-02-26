# Spring Boot (Java) Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- Prefer layered architecture: Controller → Service → Repository, with clear separation of concerns at each layer
- Use `@RestController` for REST APIs and `@Controller` for view-based endpoints; never mix concerns in a single controller
- Leverage Spring Data repositories (JPA, JDBC, or R2DBC) instead of raw JDBC for data access
- Place domain entities in a `model` or `domain` package, separate from DTOs and request/response objects
- Use `@Configuration` classes to define beans explicitly; prefer constructor injection over field injection for testability
- Keep controllers thin: delegate business logic to service layer, validation to bean validation annotations
- Modularize large applications using Spring Boot's multi-module project structure with clear module boundaries
- Use `@SpringBootApplication` only in the main application class; avoid scattering it across packages

## Code Style

- Follow Java naming conventions: PascalCase for classes, camelCase for methods/variables, UPPER_SNAKE_CASE for constants
- Prefer method names that clearly express intent: `findUserById()` over `getUser()`, `createOrder()` over `save()`
- Keep methods under 20 lines; extract complex logic into private helper methods or separate service classes
- Use `Optional<T>` for return types that may be absent; never return `null` from public methods
- Leverage Lombok annotations (`@Data`, `@Builder`, `@Slf4j`) to reduce boilerplate, but avoid on entities with JPA
- Place `@Autowired` on constructors, not fields, for explicit dependency declaration and easier testing
- Use meaningful package names that reflect business domains, not technical layers (e.g., `com.example.orders`, not `com.example.services`)
- Prefer Java records for immutable DTOs and value objects (Java 16+)

## Testing

- Use JUnit 5 as the standard testing framework; migrate legacy JUnit 4 tests
- Prefer `@SpringBootTest` for integration tests, `@WebMvcTest` for controller slice tests, and plain JUnit for unit tests
- Use `@MockBean` for mocking dependencies in Spring context tests; prefer Mockito for plain unit tests
- Write tests that follow the Arrange-Act-Assert pattern; keep test methods focused on a single behavior
- Use TestContainers for database integration tests instead of in-memory databases like H2 when production uses PostgreSQL/MySQL
- Aim for 80%+ code coverage on service layer; focus on business logic over getters/setters
- Prefer factory methods or builders (e.g., `TestDataFactory.createUser()`) over fixtures for test data setup

## Performance

- Use `@Transactional(readOnly = true)` on read-only service methods to optimize database connection handling
- Prevent N+1 queries by using `JOIN FETCH` in JPQL or `@EntityGraph` on repository methods
- Enable Hibernate query logging in development (`spring.jpa.show-sql=true`) to detect performance issues early
- Leverage Spring Cache abstraction (`@Cacheable`, `@CacheEvict`) with Redis or Caffeine for frequently accessed data
- Use pagination (`Pageable`) for endpoints that return large collections; never fetch unbounded result sets
- Profile applications under realistic load using Spring Boot Actuator metrics and tools like JProfiler or async-profiler
- Prefer batch inserts (`saveAll()`) over individual saves in loops when persisting collections

## Security

- Use Spring Security for authentication and authorization; never implement custom security from scratch
- Leverage `@PreAuthorize` and `@Secured` annotations for method-level security; prefer SpEL expressions for complex rules
- Validate all inputs with Bean Validation (`@Valid`, `@NotNull`, `@Size`) at the controller layer
- Store secrets in environment variables or external configuration (Vault, AWS Secrets Manager); never commit secrets to Git
- Enable CSRF protection for stateful applications; disable only for stateless REST APIs with proper justification
- Use HTTPS in production; configure Spring Security to redirect HTTP to HTTPS and set secure headers
- Implement proper exception handling with `@ControllerAdvice` to avoid leaking stack traces to clients

## Anti-Patterns

- Avoid using `@Autowired` on fields; it makes testing difficult and hides dependencies
- Never place business logic in controllers; controllers should only handle HTTP concerns and delegate to services
- Don't use `@Transactional` on controller methods; transactions belong in the service layer
- Avoid bidirectional JPA relationships without careful consideration; they often cause circular serialization issues
- Never catch generic `Exception` without re-throwing or proper logging; prefer specific exception types
- Don't use `Optional` as method parameters or entity fields; use it only for return types
- Avoid overusing `@Component` scanning; be explicit with `@Service`, `@Repository`, or `@Controller` stereotypes
