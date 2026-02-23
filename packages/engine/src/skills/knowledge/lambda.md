# AWS Lambda Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Prefer single-purpose functions**: Each Lambda should do one thing well; avoid monolithic handlers that branch on event types
- **Use dependency injection**: Pass clients (S3, DynamoDB, etc.) as parameters rather than instantiating them inside handlers for testability
- **Separate handler from business logic**: Handler should only parse events, invoke logic, and format responses; keep core logic in separate modules
- **Design for cold starts**: Initialize SDK clients and database connections outside the handler function to reuse them across invocations
- **Use environment variables for configuration**: Never hardcode region, table names, or bucket names; externalize all environment-specific config
- **Implement proper error boundaries**: Catch exceptions at handler level, log with context, and return appropriate status codes or throw for retry
- **Choose event sources deliberately**: Prefer async sources (SQS, SNS, EventBridge) over synchronous (API Gateway) when immediate response isn't required
- **Structure for layers and SAM/CDK**: Organize code to support Lambda Layers for shared dependencies; align directory structure with IaC tooling

## Code Style

- **Name handlers descriptively**: Use `handle_<action>` or `<resource>_<action>_handler` (e.g., `handle_order_created`, `user_registration_handler`)
- **Keep handler functions under 50 lines**: Extract logic into well-named helper functions or service classes
- **Use type hints (Python) or TypeScript**: Strongly type event structures, response formats, and function signatures for maintainability
- **Prefer early returns**: Validate inputs and fail fast at the top of functions; avoid deeply nested conditionals
- **Log structured data**: Use JSON logging with contextual fields (request_id, user_id, correlation_id) rather than unstructured strings
- **Name environment variables in UPPER_SNAKE_CASE**: Consistently retrieve them at module level: `TABLE_NAME = os.environ['TABLE_NAME']`
- **Handle None/undefined explicitly**: Always check for optional event fields before accessing nested properties
- **Use context object sparingly**: Access `context.aws_request_id` and `context.function_name` for logging, but don't pass entire context through layers

## Testing

- **Use pytest (Python) or Jest (Node.js)**: Prefer community-standard frameworks with strong Lambda ecosystem support
- **Mock AWS service calls**: Use `moto` (Python) or `aws-sdk-mock` (Node.js) to simulate AWS APIs without network calls
- **Test handler and logic separately**: Unit test business logic independently; integration test handler with mocked events
- **Create typed event factories**: Build helper functions that generate valid Lambda event structures for each trigger type (API Gateway, SQS, etc.)
- **Aim for >80% coverage on business logic**: Handler glue code matters less than decision paths and transformations
- **Use fixture files for complex events**: Store sample payloads as JSON files for realistic integration testing
- **Test timeout and memory constraints locally**: Use SAM Local or `lambda-local` to validate resource limits before deployment

## Performance

- **Initialize connections outside handler**: Create SDK clients, database pools, and HTTP connections at module level for warm container reuse
- **Use connection pooling**: Configure Keep-Alive for HTTP clients and set appropriate pool sizes for database connections
- **Batch DynamoDB operations**: Use `batch_write_item` and `batch_get_item` instead of individual calls; prefer single-table design to minimize round trips
- **Set appropriate memory allocation**: Right-size memory (which scales CPU proportionally); profile with Lambda Insights or X-Ray to find optimal settings
- **Implement caching strategically**: Cache configuration, API responses, or reference data in global scope or external layers (ElastiCache, DAX) for repeated reads
- **Leverage provisioned concurrency for latency-critical paths**: Use for synchronous APIs; accept cold starts for async processing
- **Stream large payloads**: Use S3 pre-signed URLs or streaming responses instead of loading entire files into memory

## Security

- **Use least-privilege IAM roles**: Grant only specific actions on specific resources; never use `*` wildcards in production policies
- **Retrieve secrets from Secrets Manager or Parameter Store**: Never commit credentials; cache secrets in global scope with TTL refresh
- **Validate all input**: Treat every event field as untrusted; use schema validation libraries (Pydantic, Joi) to enforce constraints
- **Enable VPC endpoints for private resources**: Access RDS, ElastiCache, and other VPC resources without NAT gateways when Lambda is VPC-attached
- **Implement API authentication/authorization**: Use Lambda authorizers, Cognito, or IAM authentication for API Gateway triggers; validate tokens in handler
- **Sanitize logs**: Never log sensitive data (passwords, tokens, PII) in CloudWatch; redact or hash before logging
- **Sign and validate cross-service calls**: Use AWS SigV4 signing or JWT tokens when Lambdas invoke other services or APIs

## Anti-Patterns

- **Avoid recursive Lambda invocations**: Leads to exponential cost and potential infinite loops; use Step Functions for orchestration instead
- **Don't poll within a Lambda function**: Never use `while True` loops or sleep calls; leverage event-driven triggers (EventBridge, SQS) for periodic work
- **Avoid large deployment packages**: Keep function code under 50MB unzipped; use Layers for dependencies and prune unused packages
- **Don't manage state in global variables**: Warm containers reuse global scope unpredictably; use external state stores (DynamoDB, ElastiCache) for persistence
- **Avoid synchronous Lambda-to-Lambda calls**: Direct invocations create tight coupling and cascading failures; prefer async messaging (SNS/SQS)
- **Don't ignore timeout configuration**: Always set explicit timeouts shorter than downstream service limits to prevent hung invocations
- **Avoid VPC attachment unless required**: Adds cold start latency; only use VPC when accessing private resources (RDS, ElastiCache)
