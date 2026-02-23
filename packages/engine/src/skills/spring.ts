import type { Skill } from "./types.js";

export const springSkill: Skill = {
  id: "spring",
  label: "Spring Boot (Java)",
  searchTag: "Spring Boot controller service repository entity",
  searchContextPrefix:
    "Spring Boot Java application: focus on controllers, services, repositories, JPA entities, and configuration.",
  cardPromptHints:
    "This is a Spring Boot application. Emphasize: @RestController and @RequestMapping for API endpoints, @Service for business logic, @Repository and JPA/Hibernate for data access, Spring Security configuration, @Entity and relationships, @Transactional boundaries, and application.yml configuration.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.1,
    rules: 1.0,
    code_style: 1.0,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /Controller\.java$/, role: "domain" },
    { pattern: /Service\.java$/, role: "domain" },
    { pattern: /ServiceImpl\.java$/, role: "domain" },
    { pattern: /Repository\.java$/, role: "domain" },
    { pattern: /Entity\.java$/, role: "domain" },
    { pattern: /\/entity\//, role: "domain" },
    { pattern: /\/dto\//, role: "domain" },
    { pattern: /\/config\//, role: "config" },
    { pattern: /Test\.java$/, role: "test" },
    { pattern: /application\.ya?ml$/, role: "config" },
    { pattern: /application\.properties$/, role: "config" },
  ],
  bestPractices: {
    architecture: [
      "Follow a layered architecture: Controller → Service → Repository → Entity",
      "Use the repository pattern with Spring Data JPA repositories — do not write custom SQL unless needed",
      "Define service interfaces and implement them separately to enable mocking in tests",
      "Use DTOs (Data Transfer Objects) for all API inputs and outputs — never expose entities directly",
      "Use Spring Security's filter chain for authentication and authorization — do not implement manually",
    ],
    codeStyle: [
      "Use constructor injection over field injection — it is testable without Spring context",
      "Annotate transactional boundaries with @Transactional at the service method level",
      "Name controllers XxxController, services XxxService/XxxServiceImpl, repositories XxxRepository",
      "Use @Valid on controller method parameters to trigger Bean Validation automatically",
      "Use ResponseEntity<T> for responses that need custom status codes or headers",
    ],
    testing: [
      "Use @SpringBootTest for integration tests; @WebMvcTest for controller slice tests",
      "Use MockMvc for testing controller endpoints without starting a full server",
      "Use @MockBean to replace Spring beans with Mockito mocks in slice tests",
      "Use @DataJpaTest for repository tests with an in-memory H2 database",
      "Name test classes XxxTest for unit tests and XxxIT for integration tests",
    ],
    performance: [
      "Use lazy loading (FetchType.LAZY) for JPA relationships; fetch eagerly only when always needed",
      "Use Spring Data Projections or DTOs in queries to avoid selecting unnecessary columns",
      "Add indexes on JPA entity fields used in WHERE clauses via @Index or Liquibase/Flyway",
      "Use @Cacheable and @CacheEvict for frequently read, rarely changed data",
      "Use paging with Pageable in repository queries — never load all records into memory",
    ],
    security: [
      "Use Spring Security for authentication — configure via SecurityFilterChain bean",
      "Use method security (@PreAuthorize) for fine-grained authorization in services",
      "Never log sensitive PII — annotate sensitive fields with @ToString.Exclude (Lombok)",
      "Use parameterized JPQL or Spring Data query methods — never concatenate user input into queries",
      "Store secrets in application-{profile}.yml outside the repository; use Vault or AWS Secrets Manager in production",
    ],
    antiPatterns: [
      "Field injection with @Autowired (prevents testing without Spring context)",
      "Exposing JPA entities directly in REST responses (circular refs, over-exposure)",
      "Business logic in controller methods instead of service layer",
      "Missing @Transactional on service methods that perform multiple writes",
      "N+1 select problem from EAGER loading or lazy-loading in loops",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.78,
    knownExceptions: [
      "Main application class (@SpringBootApplication)",
      "Configuration classes (@Configuration) that are intentionally thin",
      "Generated code files",
      "Test configuration classes",
    ],
  },
};

export default springSkill;
