import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const proofOutputDir =
  process.env.PLAYWRIGHT_PROOF_OUTPUT_DIR?.trim() || ".tmp/harness-proof";
const proofJsonReport = process.env.PLAYWRIGHT_PROOF_JSON_REPORT?.trim();

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: /harness-proof\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: proofJsonReport
    ? [["line"], ["json", { outputFile: proofJsonReport }]]
    : [["line"]],
  outputDir: join(proofOutputDir, "test-results"),
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://localhost:3000",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
