import type { Skill } from "./types.js";

export const fastapiSkill: Skill = {
  id: "fastapi",
  label: "FastAPI",
  searchTag: "FastAPI route Pydantic dependency",
  searchContextPrefix:
    "FastAPI Python service: focus on route handlers, Pydantic models, dependency injection, background tasks, and database sessions.",
  cardPromptHints:
    "This is a FastAPI application. Emphasize: APIRouter and route handlers with HTTP methods, Pydantic request/response models with validation, Depends() for dependency injection, async/await patterns, SQLAlchemy sessions via dependency, and background tasks.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.1,
    rules: 1.0,
    code_style: 1.0,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\/routers?\//, role: "domain" },
    { pattern: /\/schemas?\//, role: "domain" },
    { pattern: /\/models?\//, role: "domain" },
    { pattern: /\/dependencies\//, role: "shared_utility" },
    { pattern: /\/middleware\//, role: "shared_utility" },
  ],
};

export default fastapiSkill;
