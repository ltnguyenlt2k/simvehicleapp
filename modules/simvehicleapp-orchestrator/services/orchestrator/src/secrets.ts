/**
 * Deploy target tokens at rest (ADR-0060): AES-256-GCM with a key derived from INTERNAL_API_SECRET, so a database dump
 * alone does not reveal them. `v1.<iv>.<ciphertext+tag>` in base64url. The token is only ever decrypted to open a route.
 */

const enc = new TextEncoder();

async function keyOf(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`simvehicleapp/deploy-target-token/${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

export async function sealToken(token: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyOf(secret), enc.encode(token));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function openToken(sealed: string, secret: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("not a sealed token");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64url") }, await keyOf(secret), Buffer.from(ct, "base64url"));
  return new TextDecoder().decode(pt);
}
