import type { Skill } from "./types.js";

export const vueSkill: Skill = {
  id: "vue",
  label: "Vue.js",
  searchTag: "Vue component composable store",
  searchContextPrefix:
    "Vue.js frontend: focus on components, Vuex/Pinia stores, composables, and API service files.",
  cardPromptHints:
    "This is a Vue.js application. Emphasize: component Options API vs Composition API, Vuex modules or Pinia stores, Vue Router, composables, and the template/script/style structure.",
  docTypeWeights: {
    about: 0.8,
    architecture: 0.9,
    styles: 1.0,
    code_style: 1.0,
    readme: 0.6,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /\/stores?\//, role: "domain" },
    { pattern: /\/composables?\//, role: "domain" },
  ],
};

export default vueSkill;
