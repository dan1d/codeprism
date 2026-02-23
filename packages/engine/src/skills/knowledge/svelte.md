# Svelte Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Use SvelteKit for application projects; plain Svelte only for embeddable widgets or component libraries
- Co-locate page components, `+layout.svelte`, `+error.svelte`, and `+page.server.ts` in the route directory
- Load server-side data in `+page.server.ts` `load` functions — avoid client-side fetch for initial page data
- Use writable/readable/derived Svelte stores for shared state; Pinia-like patterns are not needed — stores are simpler
- Separate domain logic into `$lib/` utilities and services; keep components focused on UI

## Code Style
- Use `<script lang="ts">` for all components — always enable TypeScript in Svelte projects
- Prefix reactive declarations with `$:` for derived values; prefer stores or `derived()` for complex derived state
- Name components with `PascalCase` (`MyButton.svelte`); name routes and files with `kebab-case`
- Use `bind:` directives for two-way data binding only on form inputs; avoid `bind:` for component props
- Keep component logic minimal — extract business logic into stores or `$lib` utilities

## Testing
- Use Vitest with `@testing-library/svelte` for component testing
- Test components in isolation by mounting them with `render()` and asserting on accessible queries
- Test `load` functions in `+page.server.ts` by calling them directly with mock `fetch` and `params`
- Use Playwright for end-to-end tests that validate full SvelteKit routing and data loading
- Mock Svelte stores in tests by replacing the store value with a writable mock

## Performance
- Prefer compiled Svelte output — components have zero runtime overhead unlike VDOM frameworks
- Use `{#await}` blocks to render loading states without suspending the full page
- Apply lazy loading for heavy components with `import()` in event handlers or actions
- Minimize reactive statement chains (`$:`) — each `$:` creates a reactive dependency subscription
- Use `svelte:fragment` to avoid unnecessary wrapper elements in component composition

## Security
- Sanitize any HTML rendered with `{@html ...}` — use DOMPurify; prefer template rendering over raw HTML
- Validate and sanitize all form inputs in `+page.server.ts` `actions` before processing or persisting
- Use SvelteKit's built-in CSRF protection (enabled by default for form actions)
- Store auth tokens in `httpOnly` cookies managed server-side; avoid `localStorage` for sensitive data
- Apply Content-Security-Policy headers in `hooks.server.ts` response hook

## Anti-Patterns to Flag
- Mutating props directly inside a child component — use events or two-way binding with `bind:propName`
- Overusing `{@html}` for data that could be rendered safely with template syntax
- Putting data-fetching logic inside component `onMount` when it should be in a `+page.server.ts` load function
- Large reactive statement chains that recompute on unrelated state changes — narrow dependencies
- Using global `window` or `document` directly in components that run SSR — guard with `if (browser)` from `$app/environment`
- Skipping TypeScript — untyped Svelte components are harder to maintain and refactor safely
