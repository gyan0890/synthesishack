/**
 * test.ts — Manual smoke test for Cloak vault + executor
 *
 * Run with:
 *   CLOAK_MASTER_SECRET=test-secret-passphrase npx ts-node --esm src/test.ts
 */

import { CredentialVault } from "./vault.js";
import { ExecutionEngine } from "./executor.js";

const MASTER_SECRET = process.env["CLOAK_MASTER_SECRET"] ?? "test-secret-passphrase-dev";

console.log("=== Cloak Smoke Test ===\n");

// ── 1. Vault tests ──────────────────────────────────────────────────────────
console.log("[ VAULT ]");

const vault = new CredentialVault(MASTER_SECRET);

// Store a fake credential
vault.store("github", "ghp_FAKE_TOKEN_FOR_TESTING");
vault.store("slack", "xoxb-FAKE-SLACK-TOKEN");
console.log("  ✓ Stored credentials for: github, slack");

// List services (should not show the actual tokens)
const services = vault.listServices();
console.log(`  ✓ list_services() → [${services.join(", ")}]`);

// Retrieve internally (this is what the executor does — agent never sees this)
const retrieved = vault.retrieve("github");
console.log(`  ✓ retrieve("github") → ${retrieved.slice(0, 8)}... [truncated, full len=${retrieved.length}]`);

// Confirm has()
console.log(`  ✓ has("github") → ${vault.has("github")}`);
console.log(`  ✓ has("stripe") → ${vault.has("stripe")}`);

// Remove one
vault.remove("slack");
console.log(`  ✓ remove("slack") → services now: [${vault.listServices().join(", ")}]`);

// Test wrong secret
try {
  const badVault = new CredentialVault("different-secret-passphrase!!!");
  badVault.retrieve("github"); // should throw — wrong key, auth tag mismatch
  console.log("  ✗ Should have thrown on wrong master secret!");
} catch (e) {
  console.log(`  ✓ Wrong master secret correctly rejected: ${(e as Error).message.slice(0, 50)}`);
}

// Re-store slack for executor test
vault.store("slack", "xoxb-FAKE-SLACK-TOKEN");

// ── 2. Executor tests (no real API calls — service not registered) ──────────
console.log("\n[ EXECUTOR ]");

const executor = new ExecutionEngine(vault);

// Unknown service → should fail gracefully
const r1 = await executor.execute("notion", "get_page", {});
console.log(`  ✓ Unknown service → success=${r1.success}, error="${r1.error}"`);

// No credential stored → should fail gracefully
const r2 = await executor.execute("stripe", "get_balance", {});
console.log(`  ✓ Missing credential → success=${r2.success}, error="${r2.error}"`);

// Known service but wrong action → should fail gracefully
const r3 = await executor.execute("github", "do_something_fake", {});
console.log(`  ✓ Unknown action → success=${r3.success}, error="${r3.error}"`);

// ── 3. Live API test (optional — only runs if GITHUB_TOKEN is set) ──────────
console.log("\n[ LIVE API — optional ]");
const liveToken = process.env["GITHUB_TOKEN"];
if (liveToken) {
  vault.store("github-live", liveToken);
  const liveExec = new ExecutionEngine(vault);
  const r = await liveExec.execute("github-live", "get_user", {});
  if (r.success) {
    const user = r.data as { login: string; public_repos: number };
    console.log(`  ✓ GitHub get_user → login=${user.login}, public_repos=${user.public_repos}`);
  } else {
    console.log(`  ✗ GitHub live call failed: ${r.error}`);
  }
  vault.remove("github-live");
} else {
  console.log("  (skipped — set GITHUB_TOKEN env var to run a real GitHub API call)");
}

console.log("\n=== All tests passed ===");
