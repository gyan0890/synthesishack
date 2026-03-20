/**
 * tools.ts — MCP tool definitions for Cloak
 *
 * Three tools exposed to the agent:
 *   - store_credential    (human-initiated only, stores encrypted)
 *   - execute_with_credential  (agent calls service action, never sees key)
 *   - list_services       (shows what services have credentials stored)
 *   - remove_credential   (human-initiated, removes a service credential)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CredentialVault } from "./vault.js";
import { ExecutionEngine } from "./executor.js";
import { verifyAgentIdentity } from "./identity.js";

export function registerTools(
  server: McpServer,
  vault: CredentialVault,
  executor: ExecutionEngine
): void {

  // -------------------------------------------------------------------------
  // store_credential — human only, saves encrypted credential to vault
  // -------------------------------------------------------------------------
  server.tool(
    "store_credential",
    "Store an API key or token for a service. The credential is encrypted and never exposed to the agent. Only the human operator should call this tool.",
    {
      service: z.string().min(1).describe("Service name (e.g. 'github', 'slack', 'stripe')"),
      credential: z.string().min(1).describe("The API key, token, or secret to store"),
    },
    async ({ service, credential }) => {
      try {
        vault.store(service, credential);
        return {
          content: [
            {
              type: "text",
              text: `Credential for "${service}" stored successfully. The key is encrypted and will never be exposed.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error storing credential: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // list_services — returns service names that have credentials stored
  // -------------------------------------------------------------------------
  server.tool(
    "list_services",
    "List all services that have credentials stored in the vault. Returns service names only — no keys or tokens are exposed.",
    {},
    async () => {
      const services = vault.listServices();
      return {
        content: [
          {
            type: "text",
            text:
              services.length === 0
                ? "No credentials stored yet."
                : `Services with stored credentials:\n${services.map((s) => `  - ${s}`).join("\n")}`,
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // execute_with_credential — agent calls an action; credential stays hidden
  // -------------------------------------------------------------------------
  server.tool(
    "execute_with_credential",
    "Execute an action against a third-party service using the stored credential. The agent never sees the raw credential — only the result is returned.",
    {
      service: z.string().min(1).describe("Service name (must match a stored credential)"),
      action: z
        .string()
        .min(1)
        .describe(
          "Action to perform. Examples by service:\n" +
          "  github: get_user, list_repos, create_issue\n" +
          "  slack:  post_message, list_channels\n" +
          "  stripe: get_balance, list_customers"
        ),
      params: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .describe("Action-specific parameters (e.g. { owner, repo, title } for GitHub create_issue)"),
      self_agent_id: z
        .string()
        .optional()
        .describe("Self Protocol Agent ID for ZK identity verification (https://app.ai.self.xyz)"),
    },
    async ({ service, action, params, self_agent_id }) => {
      const identity = await verifyAgentIdentity(self_agent_id);
      if (!identity.verified) {
        return {
          content: [{ type: "text", text: `Access denied: ${identity.reason}` }],
          isError: true,
        };
      }
      const result = await executor.execute(service, action, (params as Record<string, string | number | boolean | null>) ?? {});
      return {
        content: [
          {
            type: "text",
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Error (HTTP ${result.status ?? "N/A"}): ${result.error}`,
          },
        ],
        isError: !result.success,
      };
    }
  );

  // -------------------------------------------------------------------------
  // remove_credential — human only, deletes a credential from the vault
  // -------------------------------------------------------------------------
  server.tool(
    "remove_credential",
    "Remove a stored credential from the vault. Human operator use only.",
    {
      service: z.string().min(1).describe("Service name to remove"),
    },
    async ({ service }) => {
      const removed = vault.remove(service);
      return {
        content: [
          {
            type: "text",
            text: removed
              ? `Credential for "${service}" removed.`
              : `No credential found for "${service}".`,
          },
        ],
      };
    }
  );
}
