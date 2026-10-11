import { createCipheriv, createDecipheriv, createHmac, constants, publicEncrypt, privateDecrypt, randomBytes } from "node:crypto";
export type Envelope = { keyVersion: string; wrappedKey: string; iv: string; tag: string; ciphertext: string };

export function sealSecret(value: string, publicKey: string, keyVersion: string, purpose: string): Envelope {
  if (!value || value.length > 16384 || !keyVersion || !purpose) throw new Error("INVALID_SECRET");
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${keyVersion}:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  key.fill(0);
  return { keyVersion, wrappedKey: wrapped.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

// Import only in worker/mount-agent. Web has public key only and no read-secret endpoint.
export function openSecret(e: Envelope, privateKey: string, purpose: string): string {
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(e.wrappedKey, "base64"));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
    decipher.setAAD(Buffer.from(`${e.keyVersion}:${purpose}`));
    decipher.setAuthTag(Buffer.from(e.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(e.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } finally { key.fill(0); }
}

export function encryptIdentifier(value: string, key: Buffer): { iv: string; ciphertext: string; tag: string; lastFour: string } {
  if (key.length !== 32 || !value.trim()) throw new Error("INVALID_IDENTITY_KEY");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("nipt-identity-v1"));
  return { iv: iv.toString("base64"), ciphertext: Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("base64"), tag: cipher.getAuthTag().toString("base64"), lastFour: value.slice(-4) };
}
export function identityLookup(value: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("INVALID_LOOKUP_KEY");
  return createHmac("sha256", key).update(value.trim().toUpperCase()).digest("hex");
}
