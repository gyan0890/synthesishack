/**
 * index.ts — Cloak MCP Vault Server entrypoint
 *
 * Starts an MCP server over stdio. Configure in your Claude
 * Desktop / agent client by pointing to this binary.
 *
 * Required env vars:
 *   CLOAK_MASTER_SECRET  — master encryption key (min 16 chars)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CredentialVault } from "./vault.js";
import { ExecutionEngine } from "./executor.js";
import { registerTools } from "./tools.js";

const MASTER_SECRET = process.env["CLOAK_MASTER_SECRET"];

if (!MASTER_SECRET) {
  console.error(
    "[Cloak] CLOAK_MASTER_SECRET environment variable is required.\n" +
    "  Example: CLOAK_MASTER_SECRET=my-super-secret-passphrase node dist/index.js"
  );
  process.exit(1);
}

const vault = new CredentialVault(MASTER_SECRET);
const executor = new ExecutionEngine(vault);

const server = new McpServer({
  name: "cloak",
  version: "1.0.0",
});

registerTools(server, vault, executor);

const transport = new StdioServerTransport();

await server.connect(transport);

console.error("[Cloak] MCP Vault Server running on stdio. Ready.");
