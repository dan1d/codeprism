import type { Skill } from "./types.js";

export const lambdaSkill: Skill = {
  id: "lambda",
  label: "AWS Lambda",
  searchTag: "Lambda handler event AWS SDK",
  searchContextPrefix:
    "AWS Lambda function: focus on the handler entrypoint, event schema, environment variables, IAM permissions implied by the code, and downstream service calls.",
  cardPromptHints:
    "This is an AWS Lambda function. Emphasize: the handler entrypoint and event schema structure, cold start considerations, environment variable configuration, AWS SDK calls (S3, DynamoDB, SQS, SNS, etc.), and any IAM permissions implied by the SDK usage.",
  docTypeWeights: {
    about: 0.9,
    architecture: 1.1,
    readme: 1.0,
    rules: 0.9,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /handler\.(py|go|rb|js|ts)$/, role: "entry_point" },
    { pattern: /event_schema/, role: "config" },
    { pattern: /serverless\.yml$/, role: "config" },
    { pattern: /template\.ya?ml$/, role: "config" },
  ],
};

export default lambdaSkill;
