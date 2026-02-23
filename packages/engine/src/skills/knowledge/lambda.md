# AWS Lambda Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Keep handlers thin — delegate to service/domain modules that are independently testable
- Reuse initialization code (DB connections, SDK clients) outside the handler function so it's reused across warm invocations
- Use the Lambda Powertools library (Python, TypeScript) for structured logging, tracing, and metrics
- Design for idempotency — Lambda can invoke your function more than once; use idempotency keys stored in DynamoDB
- Structure multi-function projects as a monorepo with shared layers for common utilities

## Code Style
- Name handler files and exports consistently: `handler.ts` exporting `handler`, or `index.py` exporting `lambda_handler`
- Keep the handler function signature clean: `(event, context) => Promise<Response>` or typed with AWS Lambda type definitions
- Validate the incoming event shape at the handler boundary with Zod (TS) or Pydantic (Python) before processing
- Use environment variables for all configuration; load and validate at cold-start time, not inside the handler
- Type event payloads with `@types/aws-lambda` (TS) or `aws-lambda-powertools` event types (Python)

## Testing
- Unit-test handler logic by constructing synthetic event payloads from `@types/aws-lambda` or fixtures
- Use local emulation (`sam local invoke`, Localstack) for integration tests against AWS services
- Test the handler with the exact event shape produced by the trigger (API GW, SQS, S3, etc.)
- Mock AWS SDK clients with `aws-sdk-mock` or `@aws-sdk/client-mock` (TS); `moto` (Python)
- Measure cold-start impact in integration tests to catch dependency bloat

## Performance
- Minimize deployment package size — tree-shake, exclude dev dependencies, use Lambda layers for shared deps
- Increase memory to reduce CPU-bound execution time (Lambda allocates CPU proportionally to memory)
- Use provisioned concurrency for latency-sensitive endpoints to eliminate cold starts
- Prefer async SDK calls — always `await` SDK calls and avoid blocking sync operations
- Keep handler initialization (outside the function body) lightweight to reduce cold-start duration

## Security
- Apply least-privilege IAM roles — grant only the specific actions and resources the function needs
- Never log event payloads containing PII or credentials; mask sensitive fields before logging
- Use AWS Secrets Manager or SSM Parameter Store for secrets; never hardcode in environment variables committed to source
- Enable AWS X-Ray tracing to detect and debug unexpected downstream calls
- Validate and sanitize all inputs from external triggers (API GW query params, SQS message bodies)

## Anti-Patterns to Flag
- Opening database connections inside the handler body on every invocation — move outside for connection reuse
- Lambda functions with timeout set to maximum (15 min) by default — set to the expected execution time + a small buffer
- Returning unhandled promise rejections — always wrap async handlers in try/catch
- Circular dependencies between Lambda functions via synchronous invocations — use SQS/SNS for decoupling
- Storing large state between invocations in `/tmp` without accounting for cold-start resets
- Not setting reserved concurrency on high-traffic functions — they can exhaust the regional concurrency limit
