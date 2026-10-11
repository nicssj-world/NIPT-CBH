import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["argon2", "pg", "pg-boss"],
  outputFileTracingExcludes: { "*": ["./.local/**/*", "./data/**/*", "./backups/**/*", "./bundles/**/*", "./.env*", "./tests/**/*", "./playwright-report/**/*", "./test-results/**/*"] },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Cache-Control", value: "no-store" }
    ] }];
  }
};
export default config;
