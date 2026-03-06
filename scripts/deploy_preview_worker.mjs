#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  let prNumber = "";
  let portalSiteUrl = "";
  let dryRun = false;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--pr-number") {
      prNumber = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--portal-site-url") {
      portalSiteUrl = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }

  if (!/^\d+$/.test(prNumber)) {
    throw new Error("--pr-number must be a pull request number");
  }

  if (!portalSiteUrl) {
    throw new Error("--portal-site-url is required");
  }

  return {
    previewName: `ralph-edge-pr-${prNumber}`,
    portalSiteUrl: portalSiteUrl.replace(/\/+$/, ""),
    dryRun,
  };
}

function firstHeaderIndex(lines) {
  const index = lines.findIndex((line) => line.trim().startsWith("["));
  if (index < 0) {
    throw new Error("failed to find the first TOML section header");
  }
  return index;
}

function collectSection(lines, header) {
  const index = lines.findIndex((line) => line.trim() === header);
  if (index < 0) {
    throw new Error(`missing section ${header} in wrangler.toml`);
  }
  const block = [lines[index]];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim().startsWith("[")) break;
    block.push(line);
  }
  return block.join("\n").trimEnd();
}

function collectSections(lines, header) {
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== header) continue;
    const block = [lines[index]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim().startsWith("[")) break;
      block.push(line);
      index = cursor;
    }
    sections.push(block.join("\n").trimEnd());
  }
  if (sections.length < 1) {
    throw new Error(`missing repeated section ${header} in wrangler.toml`);
  }
  return sections;
}

function renameSectionHeader(section, fromHeader, toHeader) {
  const [firstLine, ...rest] = section.split("\n");
  if (firstLine.trim() !== fromHeader) {
    throw new Error(`expected section ${fromHeader}`);
  }
  return [toHeader, ...rest].join("\n");
}

function upsertStringVar(section, key, value) {
  const lines = section.split("\n");
  const pattern = new RegExp(`^${key}\\s*=`);
  const replacement = `${key} = ${JSON.stringify(value)}`;

  for (let index = 1; index < lines.length; index += 1) {
    if (pattern.test(lines[index].trim())) {
      lines[index] = replacement;
      return lines.join("\n");
    }
  }

  lines.push(replacement);
  return lines.join("\n");
}

function rewriteSectionPath(section, key, value) {
  return section
    .split("\n")
    .map((line) =>
      line.trim().startsWith(`${key} =`)
        ? `${key} = ${JSON.stringify(value)}`
        : line,
    )
    .join("\n");
}

function buildPreviewConfig(source, previewName, portalSiteUrl, workerRoot) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const topLevel = lines.slice(0, firstHeaderIndex(lines)).map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("name =")) {
      return `name = ${JSON.stringify(previewName)}`;
    }
    if (trimmed.startsWith("main =")) {
      return `main = ${JSON.stringify(join(workerRoot, "src", "index.ts"))}`;
    }
    if (trimmed.startsWith("workers_dev =")) {
      return "workers_dev = true";
    }
    return line;
  });

  const vars = upsertStringVar(
    renameSectionHeader(
      collectSection(lines, "[env.production.vars]"),
      "[env.production.vars]",
      "[vars]",
    ),
    "PORTAL_SITE_URL",
    portalSiteUrl,
  );
  const durableObjects = collectSections(lines, "[[durable_objects.bindings]]");
  const kvNamespaces = collectSections(
    lines,
    "[[env.production.kv_namespaces]]",
  ).map((section) =>
    renameSectionHeader(
      section,
      "[[env.production.kv_namespaces]]",
      "[[kv_namespaces]]",
    ),
  );
  const d1Databases = collectSections(
    lines,
    "[[env.production.d1_databases]]",
  ).map((section) =>
    rewriteSectionPath(
      renameSectionHeader(
        section,
        "[[env.production.d1_databases]]",
        "[[d1_databases]]",
      ),
      "migrations_dir",
      join(workerRoot, "migrations"),
    ),
  );
  const r2Buckets = collectSections(lines, "[[env.production.r2_buckets]]").map(
    (section) =>
      renameSectionHeader(
        section,
        "[[env.production.r2_buckets]]",
        "[[r2_buckets]]",
      ),
  );
  const migrations = collectSections(lines, "[[migrations]]");

  return [
    topLevel.join("\n").trimEnd(),
    vars,
    ...durableObjects,
    ...kvNamespaces,
    ...d1Databases,
    ...r2Buckets,
    ...migrations,
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

function main() {
  const { previewName, portalSiteUrl, dryRun } = parseArgs(process.argv);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workerRoot = join(repoRoot, "apps", "worker");
  const wranglerSource = readFileSync(
    join(workerRoot, "wrangler.toml"),
    "utf8",
  );
  const previewConfig = buildPreviewConfig(
    wranglerSource,
    previewName,
    portalSiteUrl,
    workerRoot,
  );
  const tmpDir = mkdtempSync(join(workerRoot, ".wrangler-preview-"));
  const previewConfigPath = join(tmpDir, "wrangler.preview.toml");

  writeFileSync(previewConfigPath, previewConfig, "utf8");

  try {
    const args = ["wrangler", "deploy", "--config", previewConfigPath];
    if (dryRun) args.push("--dry-run");
    const result = spawnSync("npx", args, {
      cwd: workerRoot,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
