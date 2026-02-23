# Vue.js Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Prefer Composition API with `<script setup>` for new components; reserve Options API for legacy compatibility
- Use Pinia for state management; organize stores by domain feature, not UI section
- Keep components in feature-based directories with co-located composables and tests
- Use composables (`useXxx`) to extract and share reactive logic across components
- Structure views (pages) separately from reusable components; wire via Vue Router
- Use async components with `defineAsyncComponent` for route-level code splitting

## Code Style
- Use `PascalCase` for component files and names; `camelCase` for composables and utilities
- Always use `v-bind:key` with stable, unique IDs on `v-for` — never use index when list is mutable
- Prefer `computed` properties over complex template expressions
- Declare emits with `defineEmits` and typed events in `<script setup>`
- Use `defineProps` with TypeScript generics rather than runtime validators for type safety

## Testing
- Use Vue Test Utils with Vitest for component tests
- Test behavior via rendered output and emitted events — avoid testing internal reactive state
- Mount with `mount` (full) for integration; `shallowMount` only when child components are irrelevant
- Mock Pinia stores with `createTestingPinia` rather than providing real stores
- Test composables in isolation by calling them inside `withSetup` or directly in a test component

## Performance
- Use `v-show` over `v-if` for elements that toggle frequently (avoids repeated mount/unmount)
- Apply `shallowRef` and `shallowReactive` for large data structures where deep reactivity is unnecessary
- Lazy-load route components with dynamic `import()` in the router definition
- Avoid watchers with `deep: true` on large objects — subscribe to specific properties instead
- Use `markRaw` for non-reactive objects (e.g., third-party class instances) stored in reactive state

## Security
- Never render untrusted HTML with `v-html` — sanitize with DOMPurify if unavoidable
- Validate and escape user input before it reaches the template or API
- Store auth tokens in httpOnly cookies; avoid `localStorage` for sensitive credentials
- Use Vue Router navigation guards to enforce authentication and authorization on routes

## Anti-Patterns to Flag
- Mutating props directly inside a child component — emit events to the parent instead
- Using `v-if` and `v-for` on the same element — always prefer wrapping with a `<template>`
- Global event buses (`$emit` on a root bus) in Vue 3 — use Pinia or `provide/inject` instead
- Deeply nested `watch` callbacks that replicate computed behavior
- Accessing `$parent` or `$root` for cross-component communication — breaks encapsulation
- Storing server state in Pinia — prefer Vue Query (TanStack Query for Vue) for server data
