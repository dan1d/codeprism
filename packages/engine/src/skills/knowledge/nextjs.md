# Next.js Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Use the App Router (`app/`) for new projects; prefer Server Components by default, opt into Client Components only when needed
- Co-locate page components, loading states, error boundaries, and layouts in the same route segment directory
- Separate data fetching (Server Components, Route Handlers) from UI logic (Client Components)
- Use Route Handlers (`app/api/`) for BFF (backend-for-frontend) endpoints; avoid exposing internal APIs directly
- Apply parallel routes and intercepting routes for complex UI patterns (modals, split views) rather than managing state manually

## Code Style
- Mark components with `"use client"` only when they need browser APIs, event handlers, or state — not by default
- Co-locate types with the files that use them; export shared types from a `types/` directory at the feature level
- Use `next/image` for all images; never use raw `<img>` tags
- Use `next/link` for internal navigation; never use `<a>` tags for in-app routes
- Follow the file conventions: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`

## Testing
- Unit-test Server Components by calling them as async functions and asserting on the JSX output
- Use React Testing Library with `@testing-library/jest-dom` for Client Component tests
- Mock `next/navigation` hooks (`useRouter`, `useSearchParams`) in unit tests
- Use Playwright for end-to-end tests that validate full page interactions and navigation
- Test Route Handlers with `fetch` against a test server or by importing and calling the handler directly

## Performance
- Leverage static rendering (SSG) wherever data doesn't change per-request; use `revalidate` for ISR
- Use `React.cache` to deduplicate fetch calls within a single render pass in Server Components
- Prefetch critical routes with `<Link prefetch>` and preload fonts via `next/font`
- Avoid large client bundles — move data processing to Server Components; use `next/dynamic` for heavy Client Components
- Use `generateStaticParams` for dynamic routes that can be statically generated at build time

## Security
- Validate all inputs in Route Handlers with Zod or similar; never trust request bodies
- Use middleware (`middleware.ts`) to enforce authentication before reaching protected routes
- Store secrets only in environment variables and access them server-side; never expose in Client Components
- Set security headers in `next.config.js` (CSP, X-Frame-Options, Referrer-Policy)
- Use `httpOnly` cookies for session tokens; avoid `localStorage` for auth state

## Anti-Patterns to Flag
- Adding `"use client"` to root layouts or high-level wrappers — defeats Server Component benefits
- Fetching data in Client Components when the same data could be fetched in a Server Component
- Using `getServerSideProps` or `getStaticProps` in the App Router — these are Pages Router APIs
- Returning sensitive data from Server Components that gets serialized into the client bundle
- Large `useEffect` chains for data fetching in Client Components — use React Query or server fetching instead
- Ignoring `loading.tsx` and `error.tsx` files — every segment with async data should have them
