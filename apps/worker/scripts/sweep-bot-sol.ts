#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getPrivyWalletAddressById,
  signTransactionWithPrivyById,
} from "../src/privy";
import { SolanaRpc } from "../src/solana_rpc";
import type { Env } from "../src/types";

type BotRow = {
  id: string;
  userId: string;
  walletAddress: string;
  privyWalletId: string;
  createdAt: string;
};

type CliArgs = {
  dbPath?: string;
  userId?: string;
  privyUserId?: string;
  destination?: string;
  rpcEndpoint?: string;
  keepLamports: number;
  execute: boolean;
};

function usage(): never {
  console.error(
    [
      "Sweep SOL from all bot wallets for a user into one destination wallet.",
      "",
      "Usage:",
      "  bun run scripts/sweep-bot-sol.ts --destination <wallet> [selector] [options]",
      "",
      "Selector (one required):",
      "  --user-id <users.id>",
      "  --privy-user-id <users.privy_user_id>",
      "",
      "Options:",
      "  --db <path>                 Local sqlite path (auto-detected by default)",
      "  --rpc <url>                 Solana RPC endpoint (defaults to .dev.vars RPC_ENDPOINT or mainnet)",
      "  --keep-lamports <n>         Leave this many lamports in each source wallet (default: 0)",
      "  --execute                   Broadcast transactions (default is dry run)",
      "",
      "Example:",
      "  bun run scripts/sweep-bot-sol.ts \\",
      "    --privy-user-id did:privy:abc \\",
      "    --destination 2rwWiBh2FJy7aLqbbi3YJraxHRmZHojB78WifjhQcfEg \\",
      "    --execute",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    keepLamports: 0,
    execute: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db") args.dbPath = argv[++i];
    else if (a === "--user-id") args.userId = argv[++i];
    else if (a === "--privy-user-id") args.privyUserId = argv[++i];
    else if (a === "--destination") args.destination = argv[++i];
    else if (a === "--rpc") args.rpcEndpoint = argv[++i];
    else if (a === "--keep-lamports")
      args.keepLamports = Number(argv[++i] ?? "0");
    else if (a === "--execute") args.execute = true;
    else usage();
  }

  if (!args.destination) usage();
  if (!args.userId && !args.privyUserId) usage();
  if (args.userId && args.privyUserId) usage();
  if (!Number.isFinite(args.keepLamports) || args.keepLamports < 0) {
    throw new Error("--keep-lamports must be a non-negative integer");
  }
  return args;
}

function readDotVars(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function sqlEscape(value: string): string {
  return value.replaceAll("'", "''");
}

function runSql(dbPath: string, sql: string): string[] {
  const res = spawnSync("sqlite3", ["-separator", "|", dbPath, sql], {
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(
      `sqlite3 failed (${res.status ?? "?"}): ${(res.stderr || "").trim()}`,
    );
  }
  return res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function autoDetectDbPath(): string {
  const baseDir = resolve(
    process.cwd(),
    ".wrangler",
    "state",
    "v3",
    "d1",
    "miniflare-D1DatabaseObject",
  );
  const files = readdirSync(baseDir).filter((f) => f.endsWith(".sqlite"));
  for (const name of files) {
    const path = join(baseDir, name);
    const rows = runSql(
      path,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','bots') ORDER BY name;",
    );
    if (rows.length === 2 && rows[0] === "bots" && rows[1] === "users") {
      return path;
    }
  }
  throw new Error("could not auto-detect local D1 db with users+bots tables");
}

function parseBotRows(lines: string[]): BotRow[] {
  const bots: BotRow[] = [];
  for (const line of lines) {
    const [id, userId, walletAddress, privyWalletId, createdAt] =
      line.split("|");
    if (!id || !userId || !walletAddress || !privyWalletId || !createdAt) {
      continue;
    }
    bots.push({ id, userId, walletAddress, privyWalletId, createdAt });
  }
  return bots;
}

function buildTransferTx(
  from: PublicKey,
  to: PublicKey,
  lamports: number,
  blockhash: string,
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: from,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports,
      }),
    ],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

async function estimateFeeLamports(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = buildTransferTx(from, to, 1, blockhash);
  const fee = await connection.getFeeForMessage(tx.message, "confirmed");
  return Number(fee.value ?? 5000);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const dotVars = readDotVars(resolve(process.cwd(), ".dev.vars"));
  const rpcEndpoint =
    args.rpcEndpoint ||
    process.env.RPC_ENDPOINT ||
    dotVars.RPC_ENDPOINT ||
    "https://api.mainnet-beta.solana.com";
  const privyAppId = process.env.PRIVY_APP_ID || dotVars.PRIVY_APP_ID;
  const privyAppSecret =
    process.env.PRIVY_APP_SECRET || dotVars.PRIVY_APP_SECRET;
  if (!privyAppId || !privyAppSecret) {
    throw new Error("missing PRIVY_APP_ID or PRIVY_APP_SECRET");
  }

  const dbPath = args.dbPath ? resolve(args.dbPath) : autoDetectDbPath();
  const selectorSql = args.userId
    ? `'${sqlEscape(args.userId)}'`
    : `(SELECT id FROM users WHERE privy_user_id='${sqlEscape(String(args.privyUserId))}' LIMIT 1)`;
  const userRows = runSql(
    dbPath,
    `SELECT ${selectorSql} as user_id WHERE ${selectorSql} IS NOT NULL;`,
  );
  if (userRows.length === 0) {
    throw new Error("no user found for selector");
  }
  const userId = userRows[0];

  const botLines = runSql(
    dbPath,
    `
    SELECT id, user_id, wallet_address, privy_wallet_id, created_at
    FROM bots
    WHERE user_id='${sqlEscape(userId)}'
    ORDER BY created_at DESC, id DESC;
    `,
  );
  const bots = parseBotRows(botLines);
  if (bots.length === 0) {
    throw new Error("no bots found for user");
  }

  const destination = new PublicKey(String(args.destination));
  const connection = new Connection(rpcEndpoint, "confirmed");
  const rpc = new SolanaRpc(rpcEndpoint);
  const privyEnv = {
    PRIVY_APP_ID: privyAppId,
    PRIVY_APP_SECRET: privyAppSecret,
  } as unknown as Env;

  let totalPlannedLamports = 0;
  let transfers = 0;

  console.log(
    `Mode=${args.execute ? "EXECUTE" : "DRY_RUN"} user=${userId} destination=${destination.toBase58()}`,
  );
  console.log(`RPC=${rpcEndpoint}`);
  console.log(`Found ${bots.length} bot wallets`);

  for (const bot of bots) {
    if (bot.walletAddress === destination.toBase58()) {
      console.log(`- skip ${bot.walletAddress} (destination wallet)`);
      continue;
    }

    const from = new PublicKey(bot.walletAddress);
    const balanceLamports = await connection.getBalance(from, "confirmed");
    if (balanceLamports <= 0) {
      console.log(`- skip ${bot.walletAddress} (balance=0)`);
      continue;
    }

    const resolvedPrivyAddress = await getPrivyWalletAddressById(
      privyEnv,
      bot.privyWalletId,
    );
    if (resolvedPrivyAddress !== bot.walletAddress) {
      console.log(
        `- skip ${bot.walletAddress} (privy wallet address mismatch: ${resolvedPrivyAddress})`,
      );
      continue;
    }

    const feeLamports = await estimateFeeLamports(
      connection,
      from,
      destination,
    );
    const amountLamports = balanceLamports - feeLamports - args.keepLamports;
    if (amountLamports <= 0) {
      console.log(
        `- skip ${bot.walletAddress} (balance=${balanceLamports}, fee=${feeLamports}, keep=${args.keepLamports})`,
      );
      continue;
    }

    totalPlannedLamports += amountLamports;
    transfers += 1;

    console.log(
      `- plan ${bot.walletAddress} -> ${destination.toBase58()} amount=${amountLamports} fee=${feeLamports}`,
    );

    if (!args.execute) continue;

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = buildTransferTx(from, destination, amountLamports, blockhash);
    const unsignedBase64 = Buffer.from(tx.serialize()).toString("base64");
    const signedBase64 = await signTransactionWithPrivyById(
      privyEnv,
      bot.privyWalletId,
      unsignedBase64,
    );
    const signature = await rpc.sendTransactionBase64(signedBase64, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
    const confirm = await rpc.confirmSignature(signature, {
      commitment: "confirmed",
      timeoutMs: 60_000,
      pollMs: 1_500,
    });
    if (!confirm.ok) {
      throw new Error(
        `transfer failed for ${bot.walletAddress}; signature=${signature}; status=${confirm.status ?? "unknown"}`,
      );
    }
    console.log(
      `  sent signature=${signature} status=${confirm.status ?? "confirmed"}`,
    );
  }

  const finalDestinationBalance = await connection.getBalance(
    destination,
    "confirmed",
  );
  console.log(
    `Done: transfers=${transfers} plannedLamports=${totalPlannedLamports} finalDestinationLamports=${finalDestinationBalance}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
