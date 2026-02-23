# Svelte / SvelteKit Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Prefer `+page.svelte` and `+layout.svelte` file-based routing** over manual route configuration; leverage `(groups)` for layouts without URL segments
- **Colocate related components in route directories** using `$lib` for shared components; avoid deeply nested component hierarchies (max 3 levels)
- **Use `+page.server.ts` for data loading** (load functions) and form actions; keep `+page.ts` for client-only data transformation
- **Implement the "server-first" pattern**: server load functions (`+page.server.ts`) for authenticated/sensitive data, universal loaders (`+page.ts`) for public data only
- **Prefer stores in `$lib/stores`** for global state; use context API (`setContext`/`getContext`) for component-tree state; avoid prop drilling beyond 2 levels
- **Structure `$lib` with clear boundaries**: `/components`, `/server` (server-only utilities), `/utils`, `/types`; never import `$lib/server` in client code
- **Use `+error.svelte` boundaries** at layout levels to handle errors gracefully; prefer returning `fail()` from actions over throwing errors
- **Leverage hooks (`hooks.server.ts`)** for cross-cutting concerns: authentication, logging, request transformation; keep hooks pure and fast

## Code Style

- **Name components with PascalCase** (`UserProfile.svelte`), routes with kebab-case (`user-profile/+page.svelte`), and files/utilities with camelCase
- **Prefer `<script lang="ts">` with TypeScript** everywhere; use `$props()` rune (Svelte 5) or typed props via `export let` with JSDoc (Svelte 4)
- **Order script blocks**: imports → types → props/state → derived values → functions → lifecycle/effects; keep scripts under 150 lines
- **Use `$state`, `$derived`, and `$effect` runes (Svelte 5)** over `let`/`$:` for reactivity; prefer explicit reactivity over implicit dependencies
- **Destructure `data` and `form` props** from load functions immediately: `let { data } = $props()` or `export let data`
- **Prefer named slots** (`<slot name="header" />`) over default slots when components have multiple insertion points
- **Use `class:` directive** for conditional classes over ternaries; use `style:` directive for dynamic styles over inline style objects
- **Keep template expressions simple**: extract complex logic into `$derived` values or functions; avoid multi-line expressions in markup

## Testing

- **Use Playwright for E2E testing** and Vitest for unit/integration tests; prefer E2E tests for critical user flows over extensive unit coverage
- **Test load functions and actions independently** by importing them directly; mock `fetch` and database calls with `vi.mock()`
- **Use Testing Library (Svelte)** for component tests; prefer user-centric queries (`getByRole`, `getByLabelText`) over implementation details
- **Prefer fixtures in `tests/fixtures`** for test data; use factories only for dynamic test scenarios requiring randomization
- **Aim for 80% coverage on business logic** (load functions, actions, utilities); skip coverage on presentational components unless complex conditional rendering
- **Test accessibility in components**: ensure keyboard navigation, ARIA labels, and semantic HTML; use `axe-core` in Playwright tests

## Performance

- **Prevent waterfalls**: use `Promise.all()` in load functions to parallelize independent data fetches; avoid sequential `await` statements
- **Leverage streaming with `defer` promises** in load functions for slow queries; render critical content immediately while streaming secondary data
- **Use `prerender = true`** for static routes; set `ssr = false` only for routes requiring client-only rendering (e.g., authenticated dashboards)
- **Implement request caching** in load functions: use `setHeaders({ 'cache-control': '...' })` and consider SvelteKit's built-in caching strategies
- **Optimize reactivity**: avoid `$effect` inside loops, prefer `{#each}` keys for list stability, use `$derived.by()` for expensive computations with minimal dependencies

## Security

- **Never trust client input**: validate and sanitize all form data in `+page.server.ts` actions using Zod or similar schema validation
- **Use SvelteKit's CSRF protection**: ensure form actions include the auto-generated CSRF token; avoid disabling `csrf.checkOrigin` without careful consideration
- **Store secrets in environment variables** (`.env`, never committed); access via `$env/static/private` in server-only code, never `$env/static/public`
- **Implement authentication in `hooks.server.ts`**: validate sessions, attach user to `event.locals`; use `+layout.server.ts` to pass user data to client safely
- **Sanitize user-generated HTML** with libraries like DOMPurify before rendering via `{@html}`; prefer `{text}` interpolation by default to prevent XSS

## Anti-Patterns

- **Avoid importing server-only code** (`$lib/server`, `+page.server.ts` logic) into client components; this exposes secrets and causes build errors
- **Don't use `onMount` for data fetching**; always load data through `load` functions for SSR compatibility and proper loading states
- **Never mutate props directly**: treat all props as read-only; emit events (`createEventDispatcher` or callbacks) or use stores for parent-child communication
- **Avoid excessive `$effect` usage**: prefer `$derived` for computed values; only use `$effect` for side effects (DOM manipulation, external API calls)
- **Don't abuse reactive statements as computed values**: `$: doubled = count * 2` should become `let doubled = $derived(count * 2)` in Svelte 5 for clarity
