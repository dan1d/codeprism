import type { Skill } from "./types.js";
import { railsSkill } from "./rails.js";
import { reactSkill } from "./react.js";
import { vueSkill } from "./vue.js";
import { nextjsSkill } from "./nextjs.js";
import { goSkill } from "./go.js";
import { pythonSkill } from "./python.js";
import { fastapiSkill } from "./fastapi.js";
import { lambdaSkill } from "./lambda.js";
import { laravelSkill } from "./laravel.js";
import { djangoSkill } from "./django.js";
import { nestjsSkill } from "./nestjs.js";
import { ginSkill } from "./gin.js";
import { svelteSkill } from "./svelte.js";
import { angularSkill } from "./angular.js";
import { springSkill } from "./spring.js";
import { djangoRestSkill } from "./django_rest.js";

const ALL_SKILLS: Skill[] = [
  railsSkill,
  reactSkill,
  vueSkill,
  nextjsSkill,
  goSkill,
  pythonSkill,
  fastapiSkill,
  lambdaSkill,
  laravelSkill,
  djangoSkill,
  nestjsSkill,
  ginSkill,
  svelteSkill,
  angularSkill,
  springSkill,
  djangoRestSkill,
];

const SKILL_MAP = new Map<string, Skill>(ALL_SKILLS.map((s) => [s.id, s]));

/**
 * Returns the skills that apply to a given list of skill IDs, ordered by relevance.
 * More specific skills (fastapi) come before more generic ones (python).
 */
export function resolveSkills(skillIds: string[]): Skill[] {
  return skillIds
    .map((id) => {
      const skill = SKILL_MAP.get(id);
      if (!skill) console.warn(`[skills] Unknown skill ID "${id}" — not in registry`);
      return skill;
    })
    .filter((s): s is Skill => s !== undefined);
}

/**
 * Returns the combined search context prefix from all applicable skills.
 * Prefixes are joined with " | ".
 */
export function buildSkillContextPrefix(skillIds: string[]): string {
  const skills = resolveSkills(skillIds);
  if (skills.length === 0) return "";
  return skills.map((s) => s.searchContextPrefix).join(" | ");
}

/**
 * Returns the combined card prompt hints from all applicable skills.
 */
export function buildSkillCardHints(skillIds: string[]): string {
  const skills = resolveSkills(skillIds);
  if (skills.length === 0) return "";
  return skills.map((s) => s.cardPromptHints).join("\n\n");
}

/**
 * Returns a short, token-lean embedding prefix formed from each skill's
 * `searchTag`. These tags are designed to be ≤ 6 words so they don't
 * dominate the embedding space but still bias it toward the stack.
 * Tags are joined with " | ".
 *
 * TODO: wire into `buildSemanticQuery` / `hybridSearch` once the active repo's
 * StackProfile is available at query time (requires persisting `repo_profiles`
 * lookup in the search path, or passing the profile as a search option).
 */
export function buildSkillSearchTag(skillIds: string[]): string {
  const skills = resolveSkills(skillIds);
  if (skills.length === 0) return "";
  return skills.map((s) => s.searchTag).join(" | ");
}

export { SKILL_MAP, ALL_SKILLS };
export type { Skill };
