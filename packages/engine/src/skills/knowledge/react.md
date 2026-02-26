# React Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **One component per file**: Include only one React component per file; multiple stateless/pure components in a single file are permitted.
- **Always use JSX syntax**: Never use `React.createElement` except when initializing the app from a non-JSX file.
- **Prefer function components**: Use normal function declarations (not arrow functions) for stateless components; use `class extends React.Component` only when you need internal state or refs.
- **No mixins**: Avoid mixins entirely; use components, higher-order components, or utility modules instead to prevent implicit dependencies and name clashes.
- **Component composition over inheritance**: Build complex UIs by composing smaller, focused components rather than extending base component classes.
- **Separate container and presentation logic**: Keep stateful business logic in container components and pure rendering logic in presentational components.
- **Co-locate related files**: Group component files with their tests, styles, and related utilities in the same directory.

## Code Style

- **PascalCase for components and files**: Use PascalCase for React component names and filenames (e.g., `ReservationCard.jsx`); use `.jsx` extension for all React component files.
- **camelCase for component instances**: Use camelCase for component instances and references (e.g., `const reservationItem = <ReservationCard />`).
- **Named function components**: Prefer named function declarations over arrow functions or anonymous functions for components to improve stack traces and debugging.
- **Explicit PropTypes**: Use specific PropTypes (`arrayOf`, `objectOf`, `shape`) rather than generic `array` or `object` to document expected data structures.
- **No `React.createClass`**: Always use ES6 classes (`class extends React.Component`) or function components; never use the deprecated `React.createClass` syntax.
- **Consistent JSX formatting**: Use proper alignment and spacing in JSX—opening brackets on the same line, closing brackets aligned with opening tag for multi-line components.
- **Destructure props**: Destructure props in function parameters or at the top of render methods for clarity and conciseness.

## Testing

- **Test components in isolation**: Use shallow rendering or component testing libraries to test components independently of their children.
- **Test user behavior, not implementation**: Write tests that interact with components as users would, avoiding tests that depend on internal state or implementation details.
- **Snapshot tests sparingly**: Use snapshot tests for stable, small components; prefer explicit assertions for complex or frequently changing components.
- **Mock external dependencies**: Mock API calls, timers, and external modules to ensure tests are fast, deterministic, and isolated.
- **Test accessibility**: Include tests that verify keyboard navigation, ARIA attributes, and screen reader compatibility.

## Performance

- **Memoize expensive computations**: Use `useMemo` to cache expensive calculations and `useCallback` to prevent unnecessary function recreations.
- **Prevent unnecessary re-renders**: Use `React.memo` for functional components and implement `shouldComponentUpdate` or `PureComponent` for class components when appropriate.
- **Lazy load routes and components**: Use `React.lazy` and `Suspense` to code-split and defer loading of non-critical components until needed.
- **Virtualize long lists**: Implement windowing/virtualization (react-window, react-virtualized) for lists with hundreds or thousands of items.
- **Optimize images and assets**: Use appropriate image formats, lazy loading, and responsive images to reduce bundle size and initial load time.
- **Profile before optimizing**: Use React DevTools Profiler to identify actual performance bottlenecks before applying optimizations.

## Security

- **Sanitize user input**: Always sanitize and validate user-provided content before rendering; be especially careful with `dangerouslySetInnerHTML`.
- **Avoid inline event handlers with user data**: Never construct event handlers using template strings with user-supplied data to prevent injection attacks.
- **Use environment variables for secrets**: Store API keys, tokens, and secrets in environment variables; never commit them to source control.
- **Validate props and inputs**: Use PropTypes or TypeScript to validate component props and reject unexpected or malicious data shapes.
- **Keep dependencies updated**: Regularly audit and update dependencies to patch known security vulnerabilities using tools like `npm audit`.

## Anti-Patterns

- **Avoid `isMounted`**: Never use the `isMounted()` method; properly cancel subscriptions and async operations in cleanup functions instead.
- **Don't use array indexes as keys**: Avoid using array indexes as React keys when items can be reordered, added, or removed; use stable, unique identifiers.
- **No direct state mutation**: Never mutate `this.state` directly in class components; always use `setState` to ensure proper re-rendering.
- **Avoid over-nesting**: Don't create deeply nested component hierarchies; flatten structure and use composition to improve readability and performance.
- **Don't pass too many props**: Components accepting more than 5-7 props should be refactored; consider composition, context, or splitting into smaller components.
