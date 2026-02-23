import type { Skill } from "./types.js";

export const reactSkill: Skill = {
  id: "react",
  label: "React",
  searchTag: "React component hook state",
  searchContextPrefix:
    "React frontend: focus on components, hooks, Redux/Zustand store slices, API calls, and page components.",
  cardPromptHints:
    "This is a React application. Emphasize: component hierarchy, custom hooks, state management (Redux slices or Zustand stores), API call patterns, and PropTypes/TypeScript interfaces.",
  docTypeWeights: {
    about: 0.8,
    architecture: 0.9,
    styles: 1.0,
    code_style: 1.0,
    readme: 0.6,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\.stories\.(tsx?|jsx?)$/, role: "test" },
    { pattern: /\/stories\//, role: "test" },
  ],
  bestPractices: {
    architecture: [
      "Co-locate component files with their hooks, styles, and tests in a feature folder",
      "Separate presentational components from container/page components",
      "Use custom hooks to extract and reuse stateful logic — hooks are the composable unit",
      "Manage global state with Zustand or Redux Toolkit; avoid prop drilling beyond 2 levels",
      "Use React Query or SWR for server state; avoid storing fetched data in global Redux state",
    ],
    codeStyle: [
      "Prefer function components with hooks over class components",
      "Name components with PascalCase; name hooks with use prefix (usePatientData)",
      "Destructure props at the function signature level for readability",
      "Keep component files under 200 lines; extract sub-components when a component grows",
      "Use TypeScript interfaces for prop types; avoid PropTypes in TS projects",
    ],
    testing: [
      "Use React Testing Library; avoid Enzyme",
      "Test user behavior not component internals — query by role, label, or text",
      "Mock API calls with MSW (Mock Service Worker) for integration tests",
      "Storybook stories count as light documentation but not as test coverage",
      "Use vitest or Jest; place test files adjacent to the component (.test.tsx)",
    ],
    performance: [
      "Use React.memo() only after measuring — premature memoization adds noise",
      "Use useMemo and useCallback only for expensive computations or referentially stable callbacks",
      "Virtualize long lists with react-window or react-virtual",
      "Code-split route-level components with React.lazy and Suspense",
      "Avoid anonymous functions in JSX event handlers in performance-sensitive lists",
    ],
    security: [
      "Never use dangerouslySetInnerHTML with unsanitized user content",
      "Sanitize any HTML from external sources with DOMPurify before rendering",
      "Do not store auth tokens in localStorage — prefer httpOnly cookies",
      "Validate and encode query params before using them in API calls",
    ],
    antiPatterns: [
      "Storing server state in Redux/Zustand (use React Query instead)",
      "useEffect with missing or over-broad dependency arrays causing stale closures",
      "Direct DOM manipulation bypassing React state",
      "Deeply nested component trees without composition or context",
      "Index as key in dynamic lists causing reconciliation bugs",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.75,
    knownExceptions: [
      "Storybook story files (.stories.tsx)",
      "Test files that use class components intentionally for legacy test coverage",
      "Third-party component wrappers that must use class components",
    ],
  },
};

export default reactSkill;
