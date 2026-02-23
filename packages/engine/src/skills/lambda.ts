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
  bestPractices: {
    architecture: [
      "Keep the handler function thin — delegate to service modules for business logic",
      "Design every Lambda function to be idempotent — it may be retried on failure",
      "Load configuration from environment variables at module level (not inside the handler) for cold-start efficiency",
      "Initialize SDK clients at module level (not inside handler) to reuse across invocations",
      "Use Lambda layers for shared dependencies across multiple functions",
    ],
    codeStyle: [
      "Validate and type the incoming event at the handler entry point — define a schema or interface",
      "Return structured responses with explicit statusCode and body for API Gateway integrations",
      "Use structured logging (JSON) so CloudWatch Logs can parse fields for metric filters",
      "Name functions with the pattern: service-environment-action (e.g. patient-prod-export)",
      "Keep the deployment package small — strip dev dependencies from production artifacts",
    ],
    testing: [
      "Unit-test the business logic modules independently from the handler entrypoint",
      "Use localstack or aws-sdk-mock for testing AWS SDK calls without hitting real services",
      "Create fixture event JSON files for each trigger type (API Gateway, SQS, S3, etc.)",
      "Test cold-start scenarios by disabling module-level cache in tests",
    ],
    performance: [
      "Minimize cold start time: use smaller runtimes (arm64), reduce package size, use Lambda SnapStart for JVM",
      "Set appropriate memory allocation — more memory also means more CPU proportionally",
      "Use Provisioned Concurrency for latency-sensitive, high-traffic functions",
      "Reuse HTTP connections with keep-alive when calling downstream services",
      "Use SQS batching for high-throughput event processing to reduce invocation overhead",
    ],
    security: [
      "Apply least-privilege IAM: grant only the specific actions and resources the function needs",
      "Never log event payloads that may contain PII or secrets — redact before logging",
      "Retrieve secrets from AWS Secrets Manager or SSM Parameter Store, not environment variables for sensitive values",
      "Use VPC only when necessary — VPC cold starts are significantly slower",
      "Enable X-Ray tracing for distributed tracing and performance profiling",
    ],
    antiPatterns: [
      "Hardcoded credentials or secrets in the function code or environment variables",
      "Non-idempotent operations that break on retry (e.g. unconditional inserts)",
      "Making synchronous HTTP calls to slow external services inside the handler (use async or SQS)",
      "Over-broad IAM policies (Action: '*', Resource: '*')",
      "Storing state between invocations in the handler function scope (not guaranteed to persist)",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.72,
    knownExceptions: [
      "Test handler files that deliberately initialize clients inside the handler for isolation",
      "Infrastructure-as-code files (serverless.yml, template.yaml)",
    ],
  },
};

export default lambdaSkill;
