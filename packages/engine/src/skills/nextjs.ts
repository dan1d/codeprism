import type { Skill } from "./types.js";

export const nextjsSkill: Skill = {
  id: "nextjs",
  label: "Next.js",
  searchTag: "Next.js server component API route",
  searchContextPrefix:
    "Next.js application: focus on pages/app router, API routes, server components, data fetching patterns, and middleware.",
  cardPromptHints:
    "This is a Next.js application. Emphasize: App Router vs Pages Router distinction, Server Components vs Client Components, API routes in app/api/ or pages/api/, getServerSideProps/getStaticProps patterns, and Next.js middleware.",
  docTypeWeights: {
    about: 0.9,
    architecture: 1.1,
    code_style: 1.0,
    readme: 0.7,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\/app\/api\//, role: "domain" },
    { pattern: /\/pages\/api\//, role: "domain" },
    { pattern: /middleware\.(ts|js)$/, role: "entry_point" },
  ],
  bestPractices: {
    architecture: [
      "Use the App Router (app/) for new projects; understand the distinction between Server and Client Components",
      "Fetch data in Server Components by default — minimize the client bundle",
      "Use route handlers (app/api/) for API endpoints; avoid mixing page and API logic",
      "Use middleware (middleware.ts) for auth guards and redirects, not in page components",
      "Co-locate page-specific components in the route segment folder; shared components in components/",
    ],
    codeStyle: [
      "Mark components with 'use client' only when they need browser APIs or interactivity",
      "Use async/await in Server Components for data fetching — no useEffect needed",
      "Use generateMetadata() for dynamic SEO metadata; static export for static routes",
      "Name layout files layout.tsx and error files error.tsx per Next.js convention",
      "Use next/image and next/link — never raw <img> or <a> tags for internal navigation",
    ],
    testing: [
      "Use Jest with React Testing Library for component tests",
      "Use Playwright or Cypress for end-to-end tests against the running Next.js server",
      "Mock next/router and next/navigation in unit tests",
      "Use MSW to mock API route responses in component tests",
    ],
    performance: [
      "Use ISR (Incremental Static Regeneration) with revalidate for data that changes occasionally",
      "Prefer generateStaticParams for routes with known param sets",
      "Use next/font for font optimization — avoid self-hosted fonts without subsetting",
      "Analyze the bundle with @next/bundle-analyzer before shipping large features",
      "Use Suspense boundaries to stream partial page content",
    ],
    security: [
      "Validate and sanitize all inputs in route handlers with zod or similar",
      "Use httpOnly cookies for session tokens — never localStorage for auth state",
      "Set Content-Security-Policy headers in next.config.js or middleware",
      "Use next-auth or Auth.js for authentication rather than rolling your own session handling",
      "Never expose server-side env vars to the client — only NEXT_PUBLIC_ prefixed vars are safe",
    ],
    antiPatterns: [
      "Fetching data in Client Components with useEffect when a Server Component would work",
      "Prop drilling data fetched in a layout down through many Client Components",
      "Using getServerSideProps or getStaticProps in the App Router (they're Pages Router only)",
      "Importing server-only modules into Client Components causing bundle bloat",
      "Using the pages/ and app/ routers simultaneously without understanding the boundary",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.75,
    knownExceptions: [
      "Pages Router files in a mixed migration project",
      "getServerSideProps in legacy pages/ directory",
    ],
  },
};

export default nextjsSkill;
