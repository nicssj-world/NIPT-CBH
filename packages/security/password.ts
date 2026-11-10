import argon2 from "argon2";

export const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;
const COMMON = new Set(["password123", "1234567890", "qwerty12345", "password1234", "administrator", "niptcbh123", "abcdefghij",
  // short and obvious ones (the shortest allowed length is now 6)
  "123456", "1234567", "12345678", "123456789", "password", "qwerty", "qwerty123", "111111", "000000", "123123", "admin123", "welcome", "iloveyou"]);
const weak = (value: string) => COMMON.has(value.toLowerCase()) || /^(.)\1+$/.test(value);

/** System-made secrets and tokens (installer accounts, random tokens): 10 to 128 characters. */
export function validatePassword(value: string): void {
  if (value.length < 10 || value.length > 128 || weak(value)) throw new Error("PASSWORD_POLICY");
}

/**
 * A password a person chooses (Owner 2026-11-10): 6 to 10 characters; the common-password and single-repeated-character checks stay.
 * Longer passwords set earlier still sign in (verifyPassword accepts up to 128); this limit applies when one is set or changed.
 */
export function validateChosenPassword(value: string): void {
  if (value.length < 6 || value.length > 10 || weak(value)) throw new Error("PASSWORD_POLICY");
}

export async function hashPassword(value: string, chosenByPerson = false): Promise<string> {
  if (chosenByPerson) validateChosenPassword(value); else validatePassword(value);
  return argon2.hash(value, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, value: string): Promise<boolean> {
  if (value.length > 128) return false;
  try { return await argon2.verify(hash, value); } catch { return false; }
}
