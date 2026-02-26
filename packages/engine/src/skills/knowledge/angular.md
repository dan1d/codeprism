# Angular Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Prefer standalone components** over NgModule-based architecture for new applications (Angular 14+); use `standalone: true` to reduce boilerplate and improve tree-shaking
- **Use feature modules with lazy loading** for logical boundaries; structure as `feature/` directories with routing, components, services, and models co-located
- **Apply smart/presentational component pattern**: container components manage state and services, presentational components accept `@Input()` and emit `@Output()` events only
- **Centralize state management** with signals (Angular 16+) or NgRx for complex applications; avoid scattered service state for shared data across multiple features
- **Organize by feature, not by type**: place `user.component.ts`, `user.service.ts`, `user.model.ts` together in `features/user/` rather than separating into `components/`, `services/` directories
- **Use dependency injection hierarchically**: provide services at root level for singletons, at component level for isolated instances, and use `providedIn: 'root'` by default
- **Implement facade pattern for complex state**: create a single service that orchestrates multiple stores/services, exposing simple observables or signals to components
- **Separate core and shared modules**: `CoreModule` (imported once in `AppModule`) for singleton services, `SharedModule` for reusable components/pipes/directives imported across features

## Code Style

- **Use strict TypeScript configuration**: enable `"strict": true`, `"strictNullChecks": true`, and `"noImplicitAny": true` in `tsconfig.json`
- **Follow Angular naming conventions**: `*.component.ts`, `*.service.ts`, `*.directive.ts`, `*.pipe.ts`, `*.guard.ts`, `*.interceptor.ts` with kebab-case file names
- **Prefix selector names**: use project-specific prefix for components (`app-user-card`) and directives (`appHighlight`) to avoid collisions with third-party libraries
- **Limit component logic to 400 lines**: extract business logic into services, complex templates into sub-components, and shared functionality into utility functions
- **Prefer signals over observables** for synchronous reactive state (Angular 16+); use `signal()`, `computed()`, and `effect()` for simpler mental model
- **Use `async` pipe in templates**: avoid manual subscription management; let Angular handle unsubscription automatically with `{{ data$ | async }}`
- **Apply OnPush change detection** for presentational components: set `changeDetection: ChangeDetectionStrategy.OnPush` and use immutable inputs for performance
- **Declare types explicitly**: avoid implicit `any`, define interfaces for API responses, component inputs, and service method parameters

## Testing

- **Use Jasmine with Karma or Jest** as test runners; prefer Jest for faster execution and better TypeScript support in modern projects
- **Write component tests with TestBed**: use `TestBed.configureTestingModule()` for integration tests, but prefer shallow tests with mocked dependencies
- **Apply AAA pattern** (Arrange, Act, Assert) for test structure; use `describe` blocks for grouping related tests and clear `it` descriptions
- **Mock services and HTTP calls**: use `jasmine.createSpyObj()` or Jest mocks for services, `HttpClientTestingModule` for HTTP testing, avoid real API calls
- **Target 80%+ code coverage** for services and business logic, 60%+ for components; focus on critical paths over vanity metrics
- **Test user interactions, not implementation**: verify behavior through `DebugElement.nativeElement` events, avoid testing private methods directly
- **Use test harnesses for complex components**: leverage Angular CDK's component harness pattern for consistent, maintainable interaction testing

## Performance

- **Enable production mode optimizations**: use `ng build --configuration production` with AOT compilation, minification, and tree-shaking enabled by default
- **Implement trackBy for `*ngFor`**: always provide `trackBy` function to prevent unnecessary DOM re-renders when list data changes
- **Lazy load routes and modules**: use `loadChildren` in route configuration to split bundles and reduce initial load time; preload strategies for critical paths
- **Optimize change detection**: use `OnPush` strategy, avoid function calls in templates, prefer pure pipes, and detach change detector for performance-critical components
- **Defer non-critical content**: use `@defer` blocks (Angular 17+) for lazy-loading components below the fold or behind user interactions
- **Profile with Angular DevTools**: use Chrome extension to identify change detection cycles, detect unnecessary renders, and analyze component tree performance
- **Manage subscriptions carefully**: unsubscribe in `ngOnDestroy()` using `takeUntil()` pattern or use `async` pipe to prevent memory leaks

## Security

- **Sanitize user input automatically**: Angular's DomSanitizer handles XSS protection by default; avoid `bypassSecurityTrust*` methods unless absolutely necessary
- **Use Angular's HTTP interceptors** for authentication: attach JWT tokens in `HttpInterceptor`, handle 401/403 responses centrally, never store tokens in localStorage without encryption considerations
- **Implement route guards for authorization**: use `CanActivate`, `CanLoad` guards to protect routes based on user roles/permissions before component initialization
- **Validate input on both client and server**: use Angular's form validators (`Validators.required`, custom validators) but always re-validate server-side
- **Enable Content Security Policy**: configure CSP headers to prevent inline script execution and restrict resource loading to trusted domains
- **Avoid exposing secrets in frontend code**: never commit API keys, use environment variables for configuration, proxy sensitive API calls through backend

## Anti-Patterns

- **Avoid direct DOM manipulation**: never use `document.querySelector()` or `ElementRef.nativeElement` directly; use `@ViewChild`, `Renderer2`, or Angular directives instead
- **Don't subscribe inside subscriptions**: nested subscriptions create memory leaks and unreadable code; use RxJS operators (`switchMap`, `mergeMap`, `combineLatest`) instead
- **Never mutate `@Input()` properties**: treat inputs as immutable; emit `@Output()` events for changes to maintain unidirectional data flow
- **Avoid logic in constructors**: use `ngOnInit()` for initialization
