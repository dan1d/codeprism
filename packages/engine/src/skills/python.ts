import type { Skill } from "./types.js";

export const pythonSkill: Skill = {
  id: "python",
  label: "Python",
  searchTag: "Python class module function",
  searchContextPrefix:
    "Python codebase: focus on module structure, class definitions, data models, and service functions.",
  cardPromptHints:
    "This is a Python application. Emphasize: module imports, class inheritance, type hints, data models (Pydantic/dataclass), and common patterns like context managers and decorators.",
  docTypeWeights: {
    about: 0.9,
    architecture: 1.0,
    rules: 0.9,
    code_style: 1.0,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /test_.*\.py$/, role: "test" },
    { pattern: /.*_test\.py$/, role: "test" },
    { pattern: /conftest\.py$/, role: "config" },
    { pattern: /__init__\.py$/, role: "entry_point" },
    { pattern: /\/migrations?\//, role: "config" },
  ],
};

export default pythonSkill;
