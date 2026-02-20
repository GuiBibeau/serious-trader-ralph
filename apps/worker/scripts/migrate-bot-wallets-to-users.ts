import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JupiterClient } from "../src/jupiter";
import { createPrivySolanaWallet } from "../src/privy";
import { SolanaRpc } from "../src/solana_rpc";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const TEN_USD_ATOMIC = 10_000_000n;
const ONE_SOL_LAMPORTS = 1_000_000_000n;

type Cli = {
  env: "dev" | "staging" | "production";
  dryRun: boolean;
  apply: boolean;
};

type UserRow = {
  id: string;
};

export type BotWalletRow = {
  botId: string;
  userId: string;
  privyWalletId: string;
  walletAddress: string;
  updatedAt: string;
};

export type WalletValue = {
  botId: string;
  walletAddress: string;
  privyWalletId: string;
  updatedAt: string;
  solLamports: string;
  usdcAtomic: string;
  totalUsdAtomic: string;
};

type ReportAction = {
  userId: string;
  method:
    | "valued_wallet"
    | "latest_updated_fallback"
    | "created_new_wallet"
    | "already_present";
  reason: string;
  chosenWalletAddress: string | null;
  chosenPrivyWalletId: string | null;
  sourceBotId: string | null;
  values?: WalletValue[];
};

type CurrentUserWallet = {
  userId: string;
  signerType: string | null;
  privyWalletId: string | null;
  walletAddress: string | null;
};

function parseArgs(argv: string[]): Cli {
  let env: Cli["env"] = "dev";
  let apply = false;
  let dryRun = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") {
      const next = String(argv[i + 1] ?? "").trim();
      if (next !== "dev" && next !== "staging" && next !== "production") {
        throw new Error("invalid --env value");
      }
      env = next;
      i += 1;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      apply = false;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { env, dryRun, apply };
}

function printHelp(): void {
  console.log(
    [
      "Usage:",
      "  bun run scripts/migrate-bot-wallets-to-users.ts --env <dev|staging|production> [--dry-run|--apply]",
      "",
      "Defaults:",
      "  --dry-run is default.",
      "",
      "Notes:",
      "  - Writes report to .tmp/wallet-migration-report-<env>.json",
      "  - Uses live SOL+USDC valuation for wallet selection.",
    ].join("\n"),
  );
}

function sqlString(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function parseFirstResultRows(raw: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(raw);
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of containers) {
    if (!item || typeof item !== "object") continue;
    const maybeResults = (item as { results?: unknown }).results;
    if (Array.isArray(maybeResults)) {
      return maybeResults.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      );
    }
  }
  return [];
}

function runWranglerSql(
  sql: string,
  cli: Cli,
  opts?: { expectRows?: boolean },
): Record<string, unknown>[] {
  const args = ["wrangler", "d1", "execute", "WAITLIST_DB", "--remote"];
  if (cli.env !== "dev") {
    args.push("--env", cli.env);
  }
  args.push("--command", sql, "--json");

  const stdout = execFileSync("npx", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (opts?.expectRows) {
    return parseFirstResultRows(stdout);
  }
  return [];
}

function toStringOrNull(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function toIsoMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function sortByLatestUpdated(rows: BotWalletRow[]): BotWalletRow[] {
  return [...rows].sort((a, b) => {
    const byUpdated = toIsoMs(b.updatedAt) - toIsoMs(a.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return a.botId.localeCompare(b.botId);
  });
}

export function pickLatestUpdatedWallet(rows: BotWalletRow[]): BotWalletRow {
  const [latest] = sortByLatestUpdated(rows);
  if (!latest) throw new Error("missing-bot-wallets");
  return latest;
}

export function shouldCreateNewWallet(rows: BotWalletRow[]): boolean {
  return rows.length === 0;
}

async function getSolPriceInUsdcAtomic(
  jupiter: JupiterClient,
): Promise<bigint> {
  const quote = await jupiter.quote({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: ONE_SOL_LAMPORTS.toString(),
    slippageBps: 50,
    swapMode: "ExactIn",
  });
  const outAmount = String(quote.outAmount ?? "").trim();
  if (!/^\d+$/.test(outAmount)) {
    throw new Error("invalid-sol-usdc-quote");
  }
  return BigInt(outAmount);
}

async function valueWallets(
  rows: BotWalletRow[],
  rpc: SolanaRpc,
  solPriceInUsdcAtomic: bigint,
): Promise<WalletValue[]> {
  return Promise.all(
    rows.map(async (row) => {
      const [solLamports, usdcAtomic] = await Promise.all([
        rpc.getBalanceLamports(row.walletAddress),
        rpc.getTokenBalanceAtomic(row.walletAddress, USDC_MINT),
      ]);
      const solUsdAtomic =
        (solLamports * solPriceInUsdcAtomic) / ONE_SOL_LAMPORTS;
      const totalUsdAtomic = solUsdAtomic + usdcAtomic;
      return {
        botId: row.botId,
        walletAddress: row.walletAddress,
        privyWalletId: row.privyWalletId,
        updatedAt: row.updatedAt,
        solLamports: solLamports.toString(),
        usdcAtomic: usdcAtomic.toString(),
        totalUsdAtomic: totalUsdAtomic.toString(),
      };
    }),
  );
}

export function selectValuedWallet(values: WalletValue[]): WalletValue {
  const sorted = [...values].sort((a, b) => {
    const byUsd = BigInt(b.totalUsdAtomic) - BigInt(a.totalUsdAtomic);
    if (byUsd !== 0n) return byUsd > 0n ? 1 : -1;
    const byUpdated = toIsoMs(b.updatedAt) - toIsoMs(a.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return a.botId.localeCompare(b.botId);
  });
  const aboveTen = sorted.filter(
    (item) => BigInt(item.totalUsdAtomic) >= TEN_USD_ATOMIC,
  );
  if (aboveTen.length > 0) return aboveTen[0] as WalletValue;
  return sorted[0] as WalletValue;
}

async function createWalletForUserIfNeeded(
  cli: Cli,
): Promise<{ walletId: string; address: string }> {
  if (cli.dryRun) {
    return {
      walletId: "dry-run-generated-wallet-id",
      address: "dry-run-generated-wallet-address",
    };
  }

  const appId = String(process.env.PRIVY_APP_ID ?? "").trim();
  const appSecret = String(process.env.PRIVY_APP_SECRET ?? "").trim();
  if (!appId || !appSecret) {
    throw new Error("missing-privy-app-credentials");
  }
  return createPrivySolanaWallet({
    PRIVY_APP_ID: appId,
    PRIVY_APP_SECRET: appSecret,
  } as Parameters<typeof createPrivySolanaWallet>[0]);
}

function loadUsers(cli: Cli): UserRow[] {
  const rows = runWranglerSql(
    `
    SELECT id
    FROM users
    ORDER BY created_at ASC, id ASC
    `,
    cli,
    { expectRows: true },
  );
  return rows
    .map((row) => ({ id: String(row.id ?? "").trim() }))
    .filter((row) => row.id);
}

function loadCurrentUserWallets(cli: Cli): CurrentUserWallet[] {
  const rows = runWranglerSql(
    `
    SELECT
      id as userId,
      signer_type as signerType,
      privy_wallet_id as privyWalletId,
      wallet_address as walletAddress
    FROM users
    `,
    cli,
    { expectRows: true },
  );
  return rows.map((row) => ({
    userId: String(row.userId ?? "").trim(),
    signerType: toStringOrNull(row.signerType),
    privyWalletId: toStringOrNull(row.privyWalletId),
    walletAddress: toStringOrNull(row.walletAddress),
  }));
}

function loadBotWalletRows(cli: Cli): BotWalletRow[] {
  const rows = runWranglerSql(
    `
    SELECT
      id as botId,
      user_id as userId,
      privy_wallet_id as privyWalletId,
      wallet_address as walletAddress,
      updated_at as updatedAt
    FROM bots
    ORDER BY updated_at DESC, id ASC
    `,
    cli,
    { expectRows: true },
  );

  return rows
    .map((row) => ({
      botId: String(row.botId ?? "").trim(),
      userId: String(row.userId ?? "").trim(),
      privyWalletId: String(row.privyWalletId ?? "").trim(),
      walletAddress: String(row.walletAddress ?? "").trim(),
      updatedAt: String(row.updatedAt ?? "").trim(),
    }))
    .filter(
      (row) =>
        row.botId &&
        row.userId &&
        row.privyWalletId &&
        row.walletAddress &&
        row.updatedAt,
    );
}

function updateUserWallet(
  cli: Cli,
  input: {
    userId: string;
    signerType: string;
    privyWalletId: string;
    walletAddress: string;
    walletMigratedAt: string;
  },
): void {
  const sql = `
    UPDATE users
    SET
      signer_type = ${sqlString(input.signerType)},
      privy_wallet_id = ${sqlString(input.privyWalletId)},
      wallet_address = ${sqlString(input.walletAddress)},
      wallet_migrated_at = ${sqlString(input.walletMigratedAt)}
    WHERE id = ${sqlString(input.userId)}
  `;
  runWranglerSql(sql, cli);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  const reportPath = join(
    repoRoot,
    ".tmp",
    `wallet-migration-report-${cli.env}.json`,
  );

  const users = loadUsers(cli);
  const currentWallets = loadCurrentUserWallets(cli);
  const currentByUser = new Map(
    currentWallets.map((item) => [item.userId, item]),
  );
  const botRows = loadBotWalletRows(cli);
  const botsByUser = new Map<string, BotWalletRow[]>();
  for (const row of botRows) {
    const list = botsByUser.get(row.userId) ?? [];
    list.push(row);
    botsByUser.set(row.userId, list);
  }

  const rpcEndpoint = String(
    process.env.MIGRATION_RPC_ENDPOINT ??
      process.env.BALANCE_RPC_ENDPOINT ??
      process.env.RPC_ENDPOINT ??
      "https://api.mainnet-beta.solana.com",
  ).trim();
  const jupiterBaseUrl = String(
    process.env.MIGRATION_JUPITER_BASE_URL ??
      process.env.JUPITER_BASE_URL ??
      "https://lite-api.jup.ag",
  ).trim();
  const jupiterApiKey = toStringOrNull(process.env.JUPITER_API_KEY);

  const rpc = new SolanaRpc(rpcEndpoint);
  const jupiter = new JupiterClient(jupiterBaseUrl, jupiterApiKey ?? undefined);

  let solPriceInUsdcAtomic: bigint | null = null;
  let solPriceError: string | null = null;
  try {
    solPriceInUsdcAtomic = await getSolPriceInUsdcAtomic(jupiter);
  } catch (error) {
    solPriceError = error instanceof Error ? error.message : String(error);
  }

  const actions: ReportAction[] = [];

  for (const user of users) {
    const current = currentByUser.get(user.id);
    if (current?.privyWalletId && current.walletAddress) {
      actions.push({
        userId: user.id,
        method: "already_present",
        reason: "user wallet already set",
        chosenWalletAddress: current.walletAddress,
        chosenPrivyWalletId: current.privyWalletId,
        sourceBotId: null,
      });
      continue;
    }

    const userBots = botsByUser.get(user.id) ?? [];
    const migratedAt = new Date().toISOString();
    if (shouldCreateNewWallet(userBots)) {
      const created = await createWalletForUserIfNeeded(cli);
      actions.push({
        userId: user.id,
        method: "created_new_wallet",
        reason: "user has no bot wallets",
        chosenWalletAddress: created.address,
        chosenPrivyWalletId: created.walletId,
        sourceBotId: null,
      });
      if (cli.apply) {
        updateUserWallet(cli, {
          userId: user.id,
          signerType: "privy",
          privyWalletId: created.walletId,
          walletAddress: created.address,
          walletMigratedAt: migratedAt,
        });
      }
      continue;
    }

    const latest = pickLatestUpdatedWallet(userBots);
    if (solPriceInUsdcAtomic === null) {
      actions.push({
        userId: user.id,
        method: "latest_updated_fallback",
        reason: `valuation unavailable: ${solPriceError ?? "unknown"}`,
        chosenWalletAddress: latest.walletAddress,
        chosenPrivyWalletId: latest.privyWalletId,
        sourceBotId: latest.botId,
      });
      if (cli.apply) {
        updateUserWallet(cli, {
          userId: user.id,
          signerType: "privy",
          privyWalletId: latest.privyWalletId,
          walletAddress: latest.walletAddress,
          walletMigratedAt: migratedAt,
        });
      }
      continue;
    }

    try {
      const values = await valueWallets(userBots, rpc, solPriceInUsdcAtomic);
      const selected = selectValuedWallet(values);
      actions.push({
        userId: user.id,
        method: "valued_wallet",
        reason: "selected by SOL+USDC valuation rules",
        chosenWalletAddress: selected.walletAddress,
        chosenPrivyWalletId: selected.privyWalletId,
        sourceBotId: selected.botId,
        values,
      });
      if (cli.apply) {
        updateUserWallet(cli, {
          userId: user.id,
          signerType: "privy",
          privyWalletId: selected.privyWalletId,
          walletAddress: selected.walletAddress,
          walletMigratedAt: migratedAt,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actions.push({
        userId: user.id,
        method: "latest_updated_fallback",
        reason: `wallet valuation failed: ${message}`,
        chosenWalletAddress: latest.walletAddress,
        chosenPrivyWalletId: latest.privyWalletId,
        sourceBotId: latest.botId,
      });
      if (cli.apply) {
        updateUserWallet(cli, {
          userId: user.id,
          signerType: "privy",
          privyWalletId: latest.privyWalletId,
          walletAddress: latest.walletAddress,
          walletMigratedAt: migratedAt,
        });
      }
    }
  }

  const summary = {
    usersTotal: users.length,
    alreadyPresent: actions.filter((item) => item.method === "already_present")
      .length,
    valuedWallet: actions.filter((item) => item.method === "valued_wallet")
      .length,
    latestFallback: actions.filter(
      (item) => item.method === "latest_updated_fallback",
    ).length,
    createdNewWallet: actions.filter(
      (item) => item.method === "created_new_wallet",
    ).length,
    dryRun: cli.dryRun,
    apply: cli.apply,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    env: cli.env,
    rpcEndpoint,
    jupiterBaseUrl,
    solPriceInUsdcAtomic:
      solPriceInUsdcAtomic === null ? null : solPriceInUsdcAtomic.toString(),
    solPriceError,
    summary,
    actions,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        reportPath,
        summary,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
