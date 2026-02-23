# Angular Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Follow the Angular CLI workspace structure: feature modules (or standalone components in Angular 17+) grouped by domain
- Use standalone components (`standalone: true`) for new development in Angular 15+; avoid unnecessary NgModules
- Apply the smart/dumb (container/presentational) component pattern — smart components fetch data, dumb components render
- Use `@ngrx/store` (or signals-based state in Angular 17+) for shared application state; avoid `BehaviorSubject` anti-patterns
- Provide services at the root level with `providedIn: 'root'` unless lazy-module scoping is required

## Code Style
- Follow the Angular Style Guide (official): one component/service per file, named with `kebab-case` file names
- Suffix class names consistently: `UserComponent`, `UserService`, `UserGuard`, `UserResolver`
- Use `OnPush` change detection strategy for all presentational components to minimize re-renders
- Avoid `any` — use strict TypeScript; enable `strict: true` in `tsconfig.json`
- Use `async` pipe in templates to subscribe to Observables — never subscribe in components without `takeUntilDestroyed`

## Testing
- Use Jasmine + Karma (traditional) or Jest + `jest-preset-angular` for unit tests
- Test components with `TestBed.configureTestingModule`; use `HttpClientTestingModule` for HTTP-dependent code
- Use `ComponentFixture` to access rendered DOM and trigger change detection
- Test services in isolation with `TestBed` + mock dependencies via `{ provide: ServiceClass, useValue: mockObj }`
- Use Cypress or Playwright for e2e tests; avoid Protractor (deprecated)

## Performance
- Use `ChangeDetectionStrategy.OnPush` on all components and pass immutable data (new object references)
- Lazy-load feature modules via the router: `loadChildren: () => import(...)` to reduce initial bundle size
- Avoid heavy computations in templates — use `Pipe`s with `pure: true` or move logic to the component
- Use virtual scrolling (`CdkVirtualScrollViewport`) from Angular CDK for long lists
- Leverage Angular's built-in `NgOptimizedImage` directive for images with proper sizing and lazy loading

## Security
- Use Angular's built-in template sanitization — never bypass it with `bypassSecurityTrust*` unless absolutely necessary
- Validate all form inputs with Angular Reactive Forms and built-in/custom validators; use `HttpParams` for query params
- Use Angular's `HttpClient` interceptors for adding auth headers; never hard-code tokens in service methods
- Apply route guards (`CanActivate`, `CanActivateFn`) for auth-protected routes
- Avoid direct DOM manipulation (`document.createElement`, `innerHTML`) — use Angular's `Renderer2`

## Anti-Patterns to Flag
- Subscribing to Observables in components without unsubscribing — use `takeUntilDestroyed()` or `async` pipe
- Using `Default` change detection on all components — results in unnecessary re-renders throughout the tree
- Deeply nested NgModule imports — flatten with standalone components or restructure feature modules
- Mixing `HttpClient` calls directly in components — service layer should own all HTTP concerns
- Storing component state in services when it should be local component state
- Using `@ViewChild` to imperatively manipulate child component state — use input bindings and outputs instead
