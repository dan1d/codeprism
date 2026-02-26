import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { saveInsight, verifyCard, listFlows, promoteInsight } from "../../services/cards.js";
import { listProjectDocs } from "../../services/docs.js";

export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool(
    "codeprism_save_insight",
    {
      title: "Save Knowledge Insight",
      description:
        "Save a knowledge card capturing an architectural insight, design " +
        "decision, or important context discovered during development.",
      annotations: { readOnlyHint: false, idempotentHint: false },
      inputSchema: {
        flow: z.string().describe("The flow/category this insight belongs to"),
        title: z.string().describe("A concise title for the knowledge card"),
        content: z.string().max(4000).describe("The full markdown content of the insight (max 4000 chars)"),
        files: z.array(z.string()).optional().describe("Related source file paths"),
      },
    },
    async ({ flow, title, content, files }) => {
      try {
        const { id } = saveInsight(flow, title, content, files);
        return {
          content: [{ type: "text" as const, text: `Saved insight card "${title}" (id: ${id}) to flow "${flow}".` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Failed to save insight: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "codeprism_verify_card",
    {
      title: "Verify Card Accuracy",
      description:
        "Mark a card as verified — confirming its content is still accurate after " +
        "reviewing it. This builds confidence scores over time.",
      annotations: { readOnlyHint: false, idempotentHint: true },
      inputSchema: {
        card_id: z.string().describe("The card ID to mark as verified"),
      },
    },
    async ({ card_id }) => {
      try {
        const found = verifyCard(card_id);
        if (!found) {
          return { content: [{ type: "text" as const, text: `Card "${card_id}" not found.` }], isError: true };
        }
        return { content: [{ type: "text" as const, text: `Verified card "${card_id}". Confidence increased.` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Verify error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "codeprism_list_flows",
    {
      title: "List Knowledge Flows",
      description:
        "List all flows in the knowledge base with card counts, repos, and file counts.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const flows = listFlows();

      if (flows.length === 0) {
        return { content: [{ type: "text" as const, text: "No flows found. The knowledge base is empty." }] };
      }

      const lines = flows.map((r) => {
        const repos = r.repos.length > 0 ? r.repos.join(", ") : "unknown";
        const crossRepo = r.repos.length > 1 ? " (cross-repo)" : "";
        const staleFlag = r.staleCount > 0 ? ` \u26a0 ${r.staleCount} stale` : "";
        const heatEmoji = r.avgHeat > 0.6 ? " \ud83d\udd25" : r.avgHeat > 0.3 ? " \ud83c\udf21" : "";
        return `- **${r.flow}**${heatEmoji}: ${r.cardCount} card(s), ${r.fileCount} files \u2014 ${repos}${crossRepo}${staleFlag}`;
      });
      const total = flows.reduce((sum, r) => sum + r.cardCount, 0);

      return {
        content: [{ type: "text" as const, text: `**${flows.length} flows** (${total} total cards):\n\n${lines.join("\n")}` }],
      };
    },
  );

  server.registerTool(
    "codeprism_project_docs",
    {
      title: "Get Project Documentation",
      description:
        "Retrieve AI-generated project documentation for one or more repositories.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: {
        repo: z.string().optional().describe("Repository name. Omit to list all repos with docs."),
        doc_type: z
          .enum(["readme", "about", "architecture", "code_style", "rules", "styles"])
          .optional()
          .describe("Specific doc type."),
      },
    },
    async ({ repo, doc_type }) => {
      try {
        if (!repo) {
          const docs = listProjectDocs();

          if (docs.length === 0) {
            return { content: [{ type: "text" as const, text: "No project docs found. Run `pnpm index` to generate them." }] };
          }

          const byRepo = new Map<string, typeof docs>();
          for (const row of docs) {
            const list = byRepo.get(row.repo) ?? [];
            list.push(row);
            byRepo.set(row.repo, list);
          }

          const lines: string[] = ["## Available Project Docs\n"];
          for (const [r, repoDocs] of byRepo) {
            lines.push(`### ${r}`);
            for (const d of repoDocs) {
              const staleFlag = d.stale ? " \u26a0\ufe0f stale" : "";
              lines.push(`- **${d.doc_type}**: ${d.title}${staleFlag} (${d.updated_at})`);
            }
            lines.push("");
          }

          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        const docs = listProjectDocs(repo, doc_type);

        if (docs.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No docs found for repo "${repo}"${doc_type ? ` (type: ${doc_type})` : ""}. Run \`pnpm index\` to generate project documentation.`,
            }],
          };
        }

        const parts = docs.map((d) => {
          const staleWarning = d.stale
            ? "\n> \u26a0\ufe0f **This doc may be stale** \u2014 some source files have changed since generation.\n"
            : "";
          return `# ${d.title}\n_Updated: ${d.updated_at}_\n${staleWarning}\n${d.content}`;
        });

        return { content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Project docs error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "codeprism_promote_insight",
    {
      title: "Promote Insight to Project Docs",
      description:
        "Promote a conversation-extracted insight to the rules or code_style doc after human review",
      annotations: { readOnlyHint: false, idempotentHint: false },
      inputSchema: {
        insight_id: z.string().describe("ID from extracted_insights table"),
        approve: z.boolean().describe("true = promote to doc, false = mark as aspirational"),
        target_doc: z.enum(["rules", "code_style"]).optional().describe("Which doc to patch"),
      },
    },
    async ({ insight_id, approve, target_doc }) => {
      try {
      const result = promoteInsight(insight_id, approve, target_doc);

      if (!result.promoted && !approve) {
        return { content: [{ type: "text" as const, text: `Marked insight as aspirational (no promotion).` }] };
      }

      if (!result.promoted) {
        return { content: [{ type: "text" as const, text: `Insight ${insight_id} not found.` }] };
      }

      return {
        content: [{
          type: "text" as const,
          text: [
            `\u2713 Insight promoted to \`${result.docType}\``,
            ``,
            `**Statement**: ${result.statement}`,
            `**Trust score**: 0.95 (human confirmed)`,
            ``,
            `The \`${result.docType}\` doc will include this rule on next regeneration.`,
          ].join("\n"),
        }],
      };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Promote error: ${message}` }], isError: true };
      }
    },
  );
}
