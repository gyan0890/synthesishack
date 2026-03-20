/**
 * executor.ts — Execution engine for Cloak
 *
 * This module fetches credentials from the vault and makes
 * the actual API calls. The credential is used here and
 * NEVER returned — only the API response is passed back.
 */

import { CredentialVault } from "./vault.js";

export interface ExecutionParams {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ExecutionResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

export class ExecutionEngine {
  private vault: CredentialVault;

  constructor(vault: CredentialVault) {
    this.vault = vault;
  }

  async execute(
    service: string,
    action: string,
    params: ExecutionParams
  ): Promise<ExecutionResult> {
    let credential: string;
    try {
      credential = this.vault.retrieve(service);
    } catch {
      return { success: false, error: `No credential found for service: "${service}"` };
    }

    try {
      const handler = SERVICE_HANDLERS[service.toLowerCase()];
      if (!handler) {
        return {
          success: false,
          error: `No handler registered for service: "${service}". Supported: ${Object.keys(SERVICE_HANDLERS).join(", ")}`,
        };
      }
      return await handler(credential, action, params);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Service handlers — each receives the raw credential internally and returns
// only the result. The key never leaves this scope.
// ---------------------------------------------------------------------------

type ServiceHandler = (
  credential: string,
  action: string,
  params: ExecutionParams
) => Promise<ExecutionResult>;

async function githubHandler(
  token: string,
  action: string,
  params: ExecutionParams
): Promise<ExecutionResult> {
  const base = "https://api.github.com";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "Cloak-MCP/1.0",
  };

  let url = "";
  let method = "GET";
  let body: Record<string, unknown> | undefined;

  switch (action) {
    case "list_repos":
      url = `${base}/user/repos?per_page=30`;
      break;
    case "create_issue": {
      const owner = String(params["owner"] ?? "");
      const repo = String(params["repo"] ?? "");
      if (!owner || !repo) return { success: false, error: "owner and repo required" };
      url = `${base}/repos/${owner}/${repo}/issues`;
      method = "POST";
      body = { title: params["title"], body: params["body"] };
      break;
    }
    case "get_user":
      url = `${base}/user`;
      break;
    default:
      return { success: false, error: `Unknown GitHub action: "${action}"` };
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res.json();
  return { success: res.ok, status: res.status, data };
}

async function slackHandler(
  token: string,
  action: string,
  params: ExecutionParams
): Promise<ExecutionResult> {
  const base = "https://slack.com/api";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let url = "";
  let method = "GET";
  let body: Record<string, unknown> | undefined;

  switch (action) {
    case "post_message":
      url = `${base}/chat.postMessage`;
      method = "POST";
      body = { channel: params["channel"], text: params["text"] };
      break;
    case "list_channels":
      url = `${base}/conversations.list`;
      break;
    default:
      return { success: false, error: `Unknown Slack action: "${action}"` };
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res.json();
  return { success: res.ok, status: res.status, data };
}

async function stripeHandler(
  apiKey: string,
  action: string,
  params: ExecutionParams
): Promise<ExecutionResult> {
  const base = "https://api.stripe.com/v1";
  const authHeader = "Basic " + Buffer.from(apiKey + ":").toString("base64");
  const headers: Record<string, string> = {
    Authorization: authHeader,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  let url = "";
  const method = "GET";

  switch (action) {
    case "list_customers":
      url = `${base}/customers?limit=${params["limit"] ?? 10}`;
      break;
    case "get_balance":
      url = `${base}/balance`;
      break;
    default:
      return { success: false, error: `Unknown Stripe action: "${action}"` };
  }

  const res = await fetch(url, { method, headers });
  const data: unknown = await res.json();
  return { success: res.ok, status: res.status, data };
}

const SERVICE_HANDLERS: Record<string, ServiceHandler> = {
  github: githubHandler,
  slack: slackHandler,
  stripe: stripeHandler,
};
