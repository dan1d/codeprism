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
};

export default nextjsSkill;
