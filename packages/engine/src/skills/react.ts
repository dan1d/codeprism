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
};

export default reactSkill;
