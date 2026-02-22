import type { Skill } from "./types.js";

export const railsSkill: Skill = {
  id: "rails",
  label: "Ruby on Rails",
  searchTag: "Rails ActiveRecord model controller",
  searchContextPrefix:
    "Ruby on Rails codebase: focus on ActiveRecord models, controllers, service objects, Pundit policies, Sidekiq jobs, and concerns.",
  cardPromptHints:
    "This is a Ruby on Rails application. Emphasize: ActiveRecord associations (belongs_to, has_many, polymorphic), Pundit authorization policies, Sidekiq background jobs, service objects in app/services/, concerns in app/models/concerns/, and schema.rb as source of truth for data structure.",
  docTypeWeights: {
    about: 1.0,
    architecture: 1.0,
    rules: 1.1,
    code_style: 0.8,
    readme: 0.6,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /app\/jobs\//, role: "domain" },
    { pattern: /app\/serializers\//, role: "domain" },
    { pattern: /app\/services\//, role: "domain" },
    { pattern: /app\/decorators\//, role: "domain" },
    { pattern: /app\/policies\//, role: "domain" },
  ],
};

export default railsSkill;
