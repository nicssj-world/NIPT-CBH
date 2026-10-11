import argon2 from "argon2";

export const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;
const COMMON = new Set(["password123", "1234567890", "qwerty12345", "password1234", "administrator", "niptcbh123", "abcdefghij"]);

export function validatePassword(value: string): void {
  if (value.length < 10 || value.length > 128 || COMMON.has(value.toLowerCase()) || /^(.)\1+$/.test(value)) throw new Error("PASSWORD_POLICY");
}

export async function hashPassword(value: string): Promise<string> {
  validatePassword(value);
  return argon2.hash(value, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, value: string): Promise<boolean> {
  if (value.length > 128) return false;
  try { return await argon2.verify(hash, value); } catch { return false; }
}
