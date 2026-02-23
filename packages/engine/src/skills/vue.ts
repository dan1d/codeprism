import type { Skill } from "./types.js";

export const vueSkill: Skill = {
  id: "vue",
  label: "Vue.js",
  searchTag: "Vue component composable store",
  searchContextPrefix:
    "Vue.js frontend: focus on components, Vuex/Pinia stores, composables, and API service files.",
  cardPromptHints:
    "This is a Vue.js application. Emphasize: component Options API vs Composition API, Vuex modules or Pinia stores, Vue Router, composables, and the template/script/style structure.",
  docTypeWeights: {
    about: 0.8,
    architecture: 0.9,
    styles: 1.0,
    code_style: 1.0,
    readme: 0.6,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\/stores?\//, role: "domain" },
    { pattern: /\/composables?\//, role: "domain" },
  ],
  bestPractices: {
    architecture: [
      "Use Composition API with <script setup> syntax in new components (Vue 3+)",
      "Prefer Pinia over Vuex for state management in Vue 3 projects",
      "Keep Pinia stores focused on a single domain entity or feature",
      "Use composables (useXxx) to extract and reuse reactive logic",
      "Co-locate composables with the feature they serve; generic ones go in src/composables/",
    ],
    codeStyle: [
      "Single-file components: keep template, script, and style together in .vue files",
      "Name components with PascalCase in script; kebab-case in templates is acceptable",
      "Define all reactive state at the top of <script setup>; methods and computed below",
      "Use defineProps with TypeScript generics rather than runtime prop declarations when possible",
    ],
    testing: [
      "Use Vue Test Utils with Vitest or Jest",
      "Test component behavior through the rendered output, not internal state",
      "Mount with shallowMount for unit tests of a single component; mount for integration",
      "Use pinia/testing for store testing — do not mutate store state directly in tests",
    ],
    performance: [
      "Use v-once for static content that never changes after first render",
      "Use v-memo to skip re-renders of list items with stable data",
      "Avoid expensive computations in template expressions — use computed properties",
      "Use async components with defineAsyncComponent for lazy-loaded routes",
      "Use KeepAlive for frequently toggled components to preserve state",
    ],
    security: [
      "Never use v-html with unsanitized user-provided content",
      "Sanitize HTML from external sources with DOMPurify",
      "Do not store auth tokens in localStorage — prefer httpOnly cookies or session storage with short TTL",
      "Validate query params from the router before using in API calls",
    ],
    antiPatterns: [
      "Mixing Options API and Composition API in the same component",
      "Direct mutation of Pinia state outside of actions",
      "Using this.$parent or this.$root to access ancestor state",
      "Deep watchers on large objects causing performance issues",
      "Using Vuex in a Vue 3 project when Pinia is available",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.75,
    knownExceptions: [
      "Options API components maintained for legacy compatibility",
      "Vuex usage in projects that have not migrated to Pinia yet",
    ],
  },
};

export default vueSkill;
