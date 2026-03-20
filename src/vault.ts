/**
 * vault.ts — Encrypted credential store for Cloak
 *
 * Credentials are stored AES-256-GCM encrypted on disk.
 * The plaintext credential is NEVER returned to the agent —
 * only the execution engine uses it internally.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Vault file location — override with CLOAK_VAULT_PATH env var.
// Defaults to ~/.cloak/vault.json so the path is stable regardless of
// which directory the server process is launched from.
const DEFAULT_VAULT_DIR = join(homedir(), ".cloak");
const VAULT_FILE = process.env["CLOAK_VAULT_PATH"] ?? join(DEFAULT_VAULT_DIR, "vault.json");
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;    // 96-bit IV for GCM
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

interface EncryptedEntry {
  iv: string;
  salt: string;
  tag: string;
  data: string;
}

type VaultStore = Record<string, EncryptedEntry>;

function deriveKey(masterSecret: string, salt: Buffer): Buffer {
  return scryptSync(masterSecret, salt, KEY_LENGTH);
}

function encrypt(plaintext: string, masterSecret: string): EncryptedEntry {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(masterSecret, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

function decrypt(entry: EncryptedEntry, masterSecret: string): string {
  const salt = Buffer.from(entry.salt, "hex");
  const iv = Buffer.from(entry.iv, "hex");
  const tag = Buffer.from(entry.tag, "hex");
  const data = Buffer.from(entry.data, "hex");
  const key = deriveKey(masterSecret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function loadVault(): VaultStore {
  if (!existsSync(VAULT_FILE)) return {};
  return JSON.parse(readFileSync(VAULT_FILE, "utf8")) as VaultStore;
}

function saveVault(store: VaultStore): void {
  // Ensure the vault directory exists before writing.
  const dir = join(VAULT_FILE, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(VAULT_FILE, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
}

export class CredentialVault {
  private masterSecret: string;

  constructor(masterSecret: string) {
    if (!masterSecret || masterSecret.length < 16) {
      throw new Error("Master secret must be at least 16 characters.");
    }
    this.masterSecret = masterSecret;
  }

  /** Store an encrypted credential under a named service. */
  store(service: string, credential: string): void {
    const vault = loadVault();
    vault[service.toLowerCase()] = encrypt(credential, this.masterSecret);
    saveVault(vault);
  }

  /** Retrieve and decrypt a credential. Internal use only — never returned to agent. */
  retrieve(service: string): string {
    const vault = loadVault();
    const entry = vault[service.toLowerCase()];
    if (!entry) throw new Error(`No credential stored for service: "${service}"`);
    return decrypt(entry, this.masterSecret);
  }

  /** Check if a credential exists for a given service. */
  has(service: string): boolean {
    return service.toLowerCase() in loadVault();
  }

  /** List registered service names only — credentials never exposed. */
  listServices(): string[] {
    return Object.keys(loadVault());
  }

  /** Remove a stored credential. */
  remove(service: string): boolean {
    const vault = loadVault();
    if (!(service.toLowerCase() in vault)) return false;
    delete vault[service.toLowerCase()];
    saveVault(vault);
    return true;
  }
}
