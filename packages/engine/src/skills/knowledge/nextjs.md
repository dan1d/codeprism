# Next.js Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Use App Router over Pages Router**: Prefer the `app/` directory structure for new projects, leveraging React Server Components, streaming, and improved data fetching patterns
- **Collocate by feature, not by type**: Organize code by feature modules (e.g., `app/dashboard/`, `app/products/`) rather than technical layers (`components/`, `hooks/`, `utils/`)
- **Keep Server and Client Components separate**: Explicitly mark Client Components with `"use client"` directive at the top of files; default to Server Components for better performance
- **Implement absolute imports**: Configure `@/*` path alias in `tsconfig.json` to reference `src/` or `app/` directories, avoiding relative path chains like `../../../components`
- **Separate business logic from UI**: Extract data fetching, mutations, and business rules into server actions or API routes, keeping components focused on presentation
- **Use Route Groups for organization**: Leverage `(group-name)` folder syntax to organize routes without affecting URL structure
- **Centralize shared UI in reusable components**: Maintain a component library at `@/components` for cross-feature shared elements, but allow feature-specific components to live within feature folders

## Code Style

- **Enforce TypeScript strict mode**: Enable `strict: true` in `tsconfig.json` to catch type errors early and improve refactoring confidence
- **Use kebab-case for file names**: Name files like `user-profile.tsx`, `api-client.ts`, `data-table.tsx` for consistency and URL-friendliness
- **Prefer named exports over default exports**: Use `export function ComponentName()` for better refactoring support and explicit imports, except for page components
- **Configure ESLint with Next.js rules**: Extend `eslint-config-next` and enforce rules for React hooks, accessibility, and Next.js-specific patterns
- **Integrate Prettier with format-on-save**: Configure `.prettierrc` and enable IDE auto-formatting to maintain consistent code style across the team
- **Use async/await over promises chains**: Write asynchronous code with async/await syntax for better readability and error handling
- **Prefix event handlers with "handle"**: Name callback functions like `handleSubmit`, `handleClick`, `handleChange` for clarity

## Testing

- **Use Vitest or Jest with React Testing Library**: Prefer Vitest for unit/integration tests with React Testing Library for component testing following user-centric queries
- **Test Server Actions and API Routes with integration tests**: Validate server-side logic with tests that exercise the full request/response cycle
- **Mock external dependencies at boundaries**: Use tools like MSW (Mock Service Worker) for API mocking rather than mocking internal modules
- **Use Playwright for E2E tests**: Implement end-to-end tests with Playwright to validate critical user flows across pages
- **Configure Husky for pre-commit validation**: Run linting, formatting, type checking, and tests before allowing commits to ensure code quality
- **Focus on behavior over implementation**: Write tests that verify user-facing behavior and outcomes rather than internal component state

## Performance

- **Optimize images with next/image**: Always use the `<Image>` component for automatic optimization, lazy loading, and responsive sizing
- **Implement dynamic imports for code splitting**: Use `next/dynamic` with `{ loading }` option for client-heavy components to reduce initial bundle size
- **Leverage Server Components for data fetching**: Fetch data in Server Components to reduce client bundle and eliminate waterfall requests
- **Use React Suspense for streaming**: Wrap async components in `<Suspense>` boundaries to stream content and show loading states progressively
- **Configure caching strategies**: Use `revalidate`, `cache: 'force-cache'`, or `cache: 'no-store'` appropriately in fetch calls and route segments
- **Monitor with Core Web Vitals**: Track LCP, FID, and CLS metrics using Next.js built-in analytics or third-party tools

## Security

- **Use environment variables for secrets**: Store API keys and secrets in `.env.local` (never committed), access via `process.env` in server-only code
- **Validate input in Server Actions**: Use schema validation libraries (Zod, Yup) to validate all user input before processing
- **Implement CSRF protection**: Use built-in Server Actions security or add CSRF tokens for traditional form submissions and API routes
- **Set security headers**: Configure `next.config.js` with headers for CSP, X-Frame-Options, and other security policies
- **Never expose secrets to client**: Ensure sensitive environment variables are only accessed in Server Components, Server Actions, or API Routes, never in Client Components

## Anti-Patterns

- **Avoid fetching data in Client Components**: Don't use `useEffect` to fetch data on mount; use Server Components or server-side data fetching instead
- **Don't use `getServerSideProps` in App Router**: Migrate to async Server Components and native `fetch` with caching options
- **Avoid deeply nested component trees**: Flatten component hierarchies to prevent prop drilling; use composition or context when needed
- **Don't block rendering with synchronous operations**: Avoid heavy computation in render; use memoization, Web Workers, or server-side processing
- **Never bypass ESLint or TypeScript errors**: Fix type errors and linting issues rather than using `@ts-ignore`, `eslint-disable`, or `any` types
