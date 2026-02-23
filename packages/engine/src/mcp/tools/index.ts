import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "./search.js";
import { registerKnowledgeTools } from "./knowledge.js";
import { registerOperationsTools } from "./operations.js";

export function registerTools(server: McpServer): void {
  registerSearchTools(server);
  registerKnowledgeTools(server);
  registerOperationsTools(server);
}
