# React Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Co-locate components with their styles, hooks, and tests in feature directories
- Separate concerns: presentational components vs. container/page components
- Use custom hooks to extract and reuse stateful logic; prefix with `use`
- Manage server state with React Query (TanStack Query) or SWR; avoid Redux for API data
- Use Zustand or Redux Toolkit for global client state; avoid prop drilling beyond two levels
- Keep components small and focused — if it needs a scroll, it's too big

## Code Style
- Use `PascalCase` for component names and files; `camelCase` for hooks and utilities
- Prefer named exports for components; use default export only for page-level components
- Destructure props in the function signature; use TypeScript interfaces for prop types
- Avoid inline arrow functions in JSX for stable references — extract to `useCallback` when passed to memoized children
- Use `const` arrow functions for component declarations; avoid `function` keyword for components

## Testing
- Use React Testing Library; test behavior, not implementation details
- Query elements by accessible role, label, or text — avoid `getByTestId` as first resort
- Mock network calls with MSW (Mock Service Worker) rather than mocking fetch/axios directly
- Write integration tests at the page level that exercise the full component tree
- Use `userEvent` over `fireEvent` for more realistic interaction simulation

## Performance
- Memoize expensive computations with `useMemo`; memoize callbacks passed to children with `useCallback`
- Wrap pure child components with `React.memo` only after profiling confirms unnecessary re-renders
- Use code splitting with `React.lazy` + `Suspense` for route-level components
- Virtualize long lists with `react-virtual` or `react-window` — never render thousands of DOM nodes
- Avoid creating objects/arrays as default prop values — define them outside the component

## Security
- Sanitize any HTML rendered via `dangerouslySetInnerHTML`; prefer DOMPurify
- Never store tokens in `localStorage` if XSS is a concern — use httpOnly cookies
- Validate and sanitize all user inputs before sending to the API
- Use environment variables (`REACT_APP_*` / `VITE_*`) for config; never commit secrets to source

## Anti-Patterns to Flag
- Mutating state directly instead of returning new objects/arrays
- Calling hooks conditionally or inside loops — hooks must be called unconditionally
- Using `useEffect` with no dependency array as a replacement for component initialization
- Prop drilling more than two levels deep — consider context or state management
- Overusing `useEffect` for derived state — compute it inline or with `useMemo`
- `key={index}` on dynamic lists where items can be reordered or removed
