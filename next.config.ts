import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // PDF.js resolves its Node fake-worker module beside pdf.mjs; bundling relocates that relative import.
  serverExternalPackages: ["argon2", "pg", "pg-boss", "pdfjs-dist"],
  outputFileTracingIncludes: {
    // Playwright's bundled registry and P4's font helper resolve these assets dynamically.
    "/*": [
      "./node_modules/playwright-core/browsers.json",
      "./node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2",
      "./node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff2",
      "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2",
      "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2",
      // Task 3: Microsoft Word renders the Owner DOCX masters (server cwd is the standalone root).
      "./packages/readygen/word-export.ps1"
    ],
    "/api/p5/results/*/reparse": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/workbook/batches/*": ["./packages/workbook/native-export.ps1"],
    "/api/p4/batches/*/draft-pdf": ["./packages/workbook/native-export.ps1"]
  },
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
