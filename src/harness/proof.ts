import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  getHarnessStatus,
  resolveWorktreeId,
  startHarness,
  stopHarness,
} from "./manager.js";

type HarnessProofOptions = {
  baseUrl?: string;
  outputDir?: string;
};

type PlaywrightReport = {
  stats?: {
    expected?: number;
    unexpected?: number;
    skipped?: number;
    flaky?: number;
  };
};

type HarnessProofSummary = {
  status: "passed" | "failed";
  baseUrl: string;
  startedLocalHarness: boolean;
  artifactsDir: string;
  screenshotDir: string;
  screenshots: string[];
  playwrightReport: string;
  summaryJson: string;
  summaryMarkdown: string;
  stats: {
    expected: number;
    unexpected: number;
    skipped: number;
    flaky: number;
  };
};

function resolveRepoRoot(cwd = process.cwd()): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  return result.stdout.trim();
}

function timestampToken(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function ensurePlaywrightBrowser(root: string): void {
  const result = spawnSync("bunx", ["playwright", "install", "chromium"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("failed to install Playwright chromium browser");
  }
}

function parsePlaywrightReport(
  reportPath: string,
): HarnessProofSummary["stats"] {
  if (!existsSync(reportPath)) {
    return {
      expected: 0,
      unexpected: 0,
      skipped: 0,
      flaky: 0,
    };
  }

  const report = JSON.parse(
    readFileSync(reportPath, "utf8"),
  ) as PlaywrightReport;
  return {
    expected: Number(report.stats?.expected ?? 0),
    unexpected: Number(report.stats?.unexpected ?? 0),
    skipped: Number(report.stats?.skipped ?? 0),
    flaky: Number(report.stats?.flaky ?? 0),
  };
}

export async function runHarnessProof(
  options: HarnessProofOptions = {},
  root = resolveRepoRoot(),
): Promise<void> {
  const normalizedRoot = resolve(root);
  let startedLocalHarness = false;
  const requestedOutputDir = options.outputDir?.trim();

  try {
    let baseUrl = options.baseUrl ? normalizeUrl(options.baseUrl) : "";
    if (!baseUrl) {
      const initialStatus = await getHarnessStatus(normalizedRoot);
      if (initialStatus.portalHealth !== "healthy") {
        await startHarness(normalizedRoot);
        startedLocalHarness = true;
      }
      const status = await getHarnessStatus(normalizedRoot);
      if (
        status.portalHealth !== "healthy" ||
        status.portalUrl === "not-running"
      ) {
        throw new Error("local harness portal is not healthy");
      }
      baseUrl = normalizeUrl(status.portalUrl);
    }

    const artifactsDir =
      requestedOutputDir && requestedOutputDir.length > 0
        ? resolve(normalizedRoot, requestedOutputDir)
        : join(
            normalizedRoot,
            ".tmp",
            "harness-proof",
            `${resolveWorktreeId(normalizedRoot)}-${timestampToken()}`,
          );
    const screenshotDir = join(artifactsDir, "screenshots");
    const reportPath = join(artifactsDir, "playwright-report.json");
    const summaryJson = join(artifactsDir, "summary.json");
    const summaryMarkdown = join(artifactsDir, "summary.md");

    mkdirSync(screenshotDir, { recursive: true });
    ensurePlaywrightBrowser(normalizedRoot);

    const result = spawnSync(
      "bunx",
      [
        "playwright",
        "test",
        "tests/browser/harness-proof.spec.ts",
        "--config",
        "playwright.config.ts",
      ],
      {
        cwd: normalizedRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: baseUrl,
          PLAYWRIGHT_PROOF_OUTPUT_DIR: artifactsDir,
          PLAYWRIGHT_PROOF_SCREENSHOT_DIR: screenshotDir,
          PLAYWRIGHT_PROOF_JSON_REPORT: reportPath,
        },
      },
    );

    const screenshots = existsSync(screenshotDir)
      ? readdirSync(screenshotDir)
          .filter((entry) => entry.endsWith(".png"))
          .sort()
          .map((entry) => join(screenshotDir, entry))
      : [];
    const stats = parsePlaywrightReport(reportPath);
    const summary: HarnessProofSummary = {
      status: result.status === 0 ? "passed" : "failed",
      baseUrl,
      startedLocalHarness,
      artifactsDir,
      screenshotDir,
      screenshots,
      playwrightReport: reportPath,
      summaryJson,
      summaryMarkdown,
      stats,
    };

    writeFileSync(summaryJson, JSON.stringify(summary, null, 2), "utf8");
    writeFileSync(
      summaryMarkdown,
      [
        "# Browser Proof",
        `- Status: ${summary.status}`,
        `- Base URL: ${summary.baseUrl}`,
        `- Started local harness: ${summary.startedLocalHarness ? "yes" : "no"}`,
        `- Expected tests: ${summary.stats.expected}`,
        `- Unexpected tests: ${summary.stats.unexpected}`,
        `- Skipped tests: ${summary.stats.skipped}`,
        `- Flaky tests: ${summary.stats.flaky}`,
        `- Screenshot directory: ${summary.screenshotDir}`,
        `- Playwright report: ${summary.playwrightReport}`,
      ].join("\n"),
      "utf8",
    );

    console.log(JSON.stringify(summary, null, 2));

    if (result.status !== 0) {
      throw new Error(`browser proof failed; see ${summaryJson}`);
    }
  } finally {
    if (startedLocalHarness) {
      await stopHarness(normalizedRoot);
    }
  }
}
