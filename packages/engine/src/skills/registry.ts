import type { Skill } from "./types.js";
import { railsSkill } from "./rails.js";
import { reactSkill } from "./react.js";
import { vueSkill } from "./vue.js";
import { nextjsSkill } from "./nextjs.js";
import { goSkill } from "./go.js";
import { pythonSkill } from "./python.js";
import { fastapiSkill } from "./fastapi.js";
import { lambdaSkill } from "./lambda.js";
import type { StackProfile } from "../indexer/stack-profiler.js";

const ALL_SKILLS: Skill[] = [
  railsSkill,
  reactSkill,
  vueSkill,
  nextjsSkill,
  goSkill,
  pythonSkill,
  fastapiSkill,
  lambdaSkill,
];

const SKILL_MAP = new Map<string, Skill>(ALL_SKILLS.map((s) => [s.id, s]));

/**
 * Returns the skills that apply to a given StackProfile, ordered by relevance.
 * More specific skills (fastapi) come before more generic ones (python).
 */
export function resolveSkills(profile: StackProfile): Skill[] {
  const skills = profile.skillIds
    .map((id) => SKILL_MAP.get(id))
    .filter((s): s is Skill => s !== undefined);
  return skills;
}

/**
 * Returns the combined search context prefix from all applicable skills.
 * Prefixes are joined with " | ".
 */
export function buildSkillContextPrefix(profile: StackProfile): string {
  const skills = resolveSkills(profile);
  if (skills.length === 0) return "";
  return skills.map((s) => s.searchContextPrefix).join(" | ");
}

/**
 * Returns the combined card prompt hints from all applicable skills.
 */
export function buildSkillCardHints(profile: StackProfile): string {
  const skills = resolveSkills(profile);
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
export function buildSkillSearchTag(profile: StackProfile): string {
  const skills = resolveSkills(profile);
  if (skills.length === 0) return "";
  return skills.map((s) => s.searchTag).join(" | ");
}

export { SKILL_MAP, ALL_SKILLS };
export type { Skill };
