import type { Skill } from "./types.js";

export const angularSkill: Skill = {
  id: "angular",
  label: "Angular",
  searchTag: "Angular component service module RxJS",
  searchContextPrefix:
    "Angular TypeScript application: focus on components, services, modules, RxJS observables, routing, and dependency injection.",
  cardPromptHints:
    "This is an Angular application. Emphasize: component architecture (@Component), injectable services (@Injectable), Angular modules (NgModule) or standalone components, RxJS observables and operators, the Router and guards, reactive forms, HttpClient usage, and OnPush change detection.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.1,
    rules: 1.0,
    code_style: 1.0,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\.component\.ts$/, role: "domain" },
    { pattern: /\.service\.ts$/, role: "domain" },
    { pattern: /\.module\.ts$/, role: "entry_point" },
    { pattern: /\.guard\.ts$/, role: "shared_utility" },
    { pattern: /\.pipe\.ts$/, role: "shared_utility" },
    { pattern: /\.directive\.ts$/, role: "shared_utility" },
    { pattern: /\.resolver\.ts$/, role: "shared_utility" },
    { pattern: /\.spec\.ts$/, role: "test" },
    { pattern: /\/store\//, role: "domain" },
    { pattern: /\/effects\//, role: "domain" },
  ],
  bestPractices: {
    architecture: [
      "Use standalone components (Angular 14+) over NgModules for new features",
      "Use lazy-loaded feature routes — never eagerly load all feature modules",
      "Separate smart (container) components from dumb (presentational) components",
      "Use services for business logic and HTTP calls — keep component classes thin",
      "Use NgRx (or similar) for complex cross-component shared state; avoid service-as-store for large apps",
    ],
    codeStyle: [
      "Use OnPush change detection for performance — rely on observables and immutable data",
      "Use the async pipe in templates to subscribe to observables — avoid manual subscriptions in components",
      "Use reactive forms (FormBuilder) over template-driven forms for complex validation",
      "Follow Angular's file naming: feature.component.ts, feature.service.ts, feature.module.ts",
      "Use signals (Angular 17+) for fine-grained reactivity in new components",
    ],
    testing: [
      "Use TestBed for component and service integration tests; use plain class instantiation for unit tests",
      "Use HttpClientTestingModule and HttpTestingController for testing HTTP calls",
      "Use jasmine.createSpyObj for dependency mocks in TestBed",
      "Use Spectator library to reduce TestBed boilerplate",
      "Test component templates with ComponentFixture and By.css/By.directive selectors",
    ],
    performance: [
      "Use OnPush change detection on all presentational components",
      "Use trackBy functions in *ngFor to avoid full list re-renders",
      "Use the async pipe — it auto-unsubscribes and triggers change detection correctly",
      "Lazy-load images with loading='lazy' and use NgOptimizedImage",
      "Unsubscribe from subscriptions in ngOnDestroy or use takeUntilDestroyed()",
    ],
    security: [
      "Use Angular's DomSanitizer and trust only sanitized values — never bypass sanitization",
      "Use Angular's HttpClient — it automatically sets XSRF tokens on mutating requests",
      "Validate all form inputs with Angular's built-in validators or custom validators",
      "Use route guards (CanActivate) for authentication and authorization checks",
      "Avoid dynamic template compilation (JIT) with user-provided content",
    ],
    antiPatterns: [
      "Subscriptions without unsubscription causing memory leaks",
      "Default change detection on all components causing performance issues",
      "Business logic in component classes instead of services",
      "Using ngOnChanges for complex derived state instead of computed signals or RxJS",
      "God services that manage state for the entire application",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.76,
    knownExceptions: [
      "Legacy NgModule-based components maintained for compatibility",
      "Third-party component wrappers that require Default change detection",
      "E2E test files",
    ],
  },
};

export default angularSkill;
