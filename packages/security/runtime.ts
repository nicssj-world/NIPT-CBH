export type RuntimeMode = "synthetic" | "operational";
export function runtimeMode(): RuntimeMode {
  const mode = process.env.NIPT_MODE;
  if (mode !== "synthetic" && mode !== "operational") throw new Error("NIPT_MODE_REQUIRED");
  return mode;
}
// Unconfigured parsers remain synthetic-safe; connecting or starting runtime requires an explicit mode.
export function operationalDataEnabled(): boolean {
  if (process.env.NIPT_MODE === undefined) return false;
  const operational = runtimeMode() === "operational";
  if (operational) configuredOrigin();
  return operational;
}
export function assertSynthetic(): void {
  if (process.env.NIPT_MODE !== "synthetic") throw new Error("P1_SYNTHETIC_ONLY");
}

export function assertNoClinicalRelease(): never {
  throw new Error("P1_RELEASE_PROHIBITED_AL5_AL6_REQUIRED");
}

export function configuredOrigin(): URL {
  if (process.env.NIPT_MODE === "operational" && !process.env.APP_ORIGIN) throw new Error("APP_ORIGIN_REQUIRED");
  const origin = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000");
  if (!["http:", "https:"].includes(origin.protocol)) throw new Error("INVALID_APP_ORIGIN");
  if (process.env.NIPT_MODE === "operational" && origin.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
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

export function assertRuntime(): void { runtimeMode(); configuredOrigin(); secureCookie(); }
