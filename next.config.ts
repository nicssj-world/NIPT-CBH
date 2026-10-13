import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // PDF.js resolves its Node fake-worker module beside pdf.mjs; bundling relocates that relative import.
  serverExternalPackages: ["argon2", "pg", "pg-boss", "pdfjs-dist"],
  outputFileTracingIncludes: { "/api/p5/results/*/reparse": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"] },
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
