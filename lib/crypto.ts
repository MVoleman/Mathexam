import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Column-level secret encryption (AES-256-GCM) for OAuth tokens and other
 * integration credentials. Key comes from TOKEN_ENCRYPTION_KEY (any long
 * random string — it is SHA-256-derived to 32 bytes).
 *
 * Format: "enc:v1:<iv b64>:<authTag b64>:<ciphertext b64>". Values without
 * the prefix are treated as legacy plaintext so existing rows keep working;
 * they are re-encrypted the next time they are written.
 */

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

/** True when encryption is configured (recommended in production). */
export function encryptionEnabled(): boolean {
  return key() !== null;
}

export function encryptSecret(plaintext: string): string {
  const k = key();
  if (!k) return plaintext; // not configured — store as-is (documented risk)

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext

  const k = key();
  if (!k) {
    throw new Error(
      "Encrypted secret found but TOKEN_ENCRYPTION_KEY is not set.",
    );
  }

  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
