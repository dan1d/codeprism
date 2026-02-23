import type { Skill } from "./types.js";

export const svelteSkill: Skill = {
  id: "svelte",
  label: "Svelte / SvelteKit",
  searchTag: "Svelte component store reactive layout",
  searchContextPrefix:
    "Svelte/SvelteKit application: focus on components, stores, reactive declarations, load functions, and form actions.",
  cardPromptHints:
    "This is a Svelte/SvelteKit application. Emphasize: reactive declarations ($:), Svelte stores (writable/derived/readable), SvelteKit routing (+page.svelte, +layout.svelte, +page.server.ts), load functions for data fetching, form actions, and the template syntax ({#if}, {#each}).",
  docTypeWeights: {
    about: 0.9,
    architecture: 1.0,
    styles: 1.1,
    code_style: 1.0,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\+page\.svelte$/, role: "domain" },
    { pattern: /\+layout\.svelte$/, role: "entry_point" },
    { pattern: /\+page\.server\.(ts|js)$/, role: "domain" },
    { pattern: /\+layout\.server\.(ts|js)$/, role: "entry_point" },
    { pattern: /\/stores?\//, role: "domain" },
    { pattern: /\.test\.(ts|js)$/, role: "test" },
    { pattern: /\.spec\.(ts|js)$/, role: "test" },
  ],
  bestPractices: {
    architecture: [
      "Use SvelteKit's file-system routing: +page.svelte for UI, +page.server.ts for server-side logic",
      "Use form actions for mutations (POST, PUT, DELETE) — avoid client-side fetch for simple form submissions",
      "Use load functions in +page.server.ts for server-side data fetching before rendering",
      "Use Svelte stores for shared reactive state; prefer derived stores over manual subscriptions",
      "Keep components small — extract reusable pieces into separate .svelte files",
    ],
    codeStyle: [
      "Use $: reactive declarations for derived values instead of imperative code in handlers",
      "Subscribe to stores with the $ shorthand in templates — avoid manual subscribe/unsubscribe",
      "Use <script lang='ts'> with TypeScript for type safety in component scripts",
      "Scope styles with <style> blocks — Svelte scopes styles to the component by default",
      "Use named slots for flexible component composition",
    ],
    testing: [
      "Use Vitest with @testing-library/svelte for component tests",
      "Use Playwright for end-to-end tests against the SvelteKit dev server",
      "Mock SvelteKit stores and navigation with testing utilities",
      "Test load functions and form actions independently from the component rendering",
    ],
    performance: [
      "Use {#key} blocks to force re-renders only when needed, not reactive declarations",
      "Use svelte:fragment to avoid wrapping div elements in {#each} blocks",
      "Lazy-load heavy components with dynamic imports",
      "Use SvelteKit preloading (data-sveltekit-preload-data) for instant navigation",
      "Minimize reactive dependencies — each $: block re-runs when any referenced variable changes",
    ],
    security: [
      "Use {@html} only with sanitized content — DOMPurify before rendering user HTML",
      "Validate and sanitize all form inputs in +page.server.ts actions before processing",
      "Use SvelteKit's CSRF protection for form actions (enabled by default)",
      "Store auth tokens in httpOnly cookies, not localStorage",
      "Use server-side load functions to check authorization before returning page data",
    ],
    antiPatterns: [
      "Using writable stores for server-fetched data (use load functions instead)",
      "Deeply nested $: reactive chains that are hard to trace",
      "Side effects inside reactive declarations ($:) instead of explicit event handlers",
      "Using {@html} without sanitization",
      "Direct DOM manipulation with document.querySelector instead of Svelte bindings",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.73,
    knownExceptions: [
      "Legacy .svelte components using Options API equivalents for compatibility",
      "SvelteKit adapter configuration files",
    ],
  },
};

export default svelteSkill;
