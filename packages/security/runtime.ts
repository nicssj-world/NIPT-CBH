export function assertSynthetic(): void {
  if (process.env.NIPT_MODE !== "synthetic") throw new Error("P1_SYNTHETIC_ONLY");
}

export function assertNoClinicalRelease(): never {
  throw new Error("P1_RELEASE_PROHIBITED_AL5_AL6_REQUIRED");
}

export function configuredOrigin(): URL {
  const origin = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000");
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("INVALID_APP_ORIGIN");
  return origin;
}

export function secureCookie(): boolean {
  const url = configuredOrigin();
  if (url.protocol === "https:") return true;
  assertSynthetic();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("HTTPS_REQUIRED");
  return false; // Explicit loopback-only synthetic development exception.
}
