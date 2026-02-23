import type { Skill } from "./types.js";

export const nestjsSkill: Skill = {
  id: "nestjs",
  label: "NestJS (Node.js)",
  searchTag: "NestJS controller service module decorator",
  searchContextPrefix:
    "NestJS TypeScript application: focus on controllers, services, modules, guards, interceptors, pipes, and DTOs.",
  cardPromptHints:
    "This is a NestJS application. Emphasize: module organization, controller route handlers, injectable services, guards for authentication/authorization, pipes for input validation, interceptors for cross-cutting concerns, and DTO class-validator schemas.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.1,
    rules: 1.0,
    code_style: 1.0,
    readme: 0.7,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\.module\.ts$/, role: "entry_point" },
    { pattern: /\.controller\.ts$/, role: "domain" },
    { pattern: /\.service\.ts$/, role: "domain" },
    { pattern: /\.guard\.ts$/, role: "shared_utility" },
    { pattern: /\.interceptor\.ts$/, role: "shared_utility" },
    { pattern: /\.pipe\.ts$/, role: "shared_utility" },
    { pattern: /\.dto\.ts$/, role: "domain" },
    { pattern: /\.entity\.ts$/, role: "domain" },
    { pattern: /\.spec\.ts$/, role: "test" },
    { pattern: /main\.ts$/, role: "entry_point" },
  ],
  bestPractices: {
    architecture: [
      "Organize by feature module — each domain gets a module, controller, service, and DTO set",
      "Use the dependency injection container — never instantiate services with new",
      "Apply guards at the controller or route level for authentication and authorization",
      "Use interceptors for cross-cutting concerns: logging, response transformation, caching",
      "Use pipes for input transformation and validation — do not validate in service methods",
    ],
    codeStyle: [
      "Use class-validator and class-transformer decorators on DTO classes for all input",
      "Name files consistently: resource.controller.ts, resource.service.ts, resource.module.ts",
      "Use @ApiProperty() decorators on DTOs to keep Swagger documentation in sync",
      "Return plain objects from services; transform in interceptors or serialization interceptors",
      "Use @InjectRepository() for TypeORM repositories — avoid global repository access",
    ],
    testing: [
      "Use Jest with NestJS's Test.createTestingModule() for unit and integration tests",
      "Mock dependencies with jest.fn() providers when unit-testing services",
      "Use supertest with the real NestJS app for end-to-end (e2e) tests",
      "Place unit tests alongside source files (foo.service.spec.ts); e2e tests in test/",
      "Use @nestjs/testing utilities — avoid bypassing the DI container in tests",
    ],
    performance: [
      "Use caching interceptors (CacheInterceptor) for frequently read, rarely changing endpoints",
      "Use TypeORM query builder with select() to limit fetched columns",
      "Use pagination at the database level — never load all records and slice in JS",
      "Use Bull or BullMQ for background job queuing",
      "Enable compression middleware for API responses in production",
    ],
    security: [
      "Use AuthGuard (Passport) for authentication; RolesGuard for role-based authorization",
      "Validate all request bodies, params, and query strings with ValidationPipe globally",
      "Use helmet middleware for standard HTTP security headers",
      "Parameterize all database queries — never concatenate user input into query strings",
      "Apply rate limiting with @nestjs/throttler to prevent brute-force attacks",
    ],
    antiPatterns: [
      "Circular module dependencies that prevent the NestJS DI container from resolving",
      "Business logic in controller methods instead of services",
      "Direct database access in controllers (bypass the service layer)",
      "Skipping DTO validation by not using ValidationPipe globally",
      "Overloading a single module with too many responsibilities",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.78,
    knownExceptions: [
      "main.ts bootstrap file",
      "Module definition files (*.module.ts) which are intentionally declarative",
      "Test files (*.spec.ts)",
    ],
  },
};

export default nestjsSkill;
