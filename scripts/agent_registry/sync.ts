import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Keypair, PublicKey } from "@solana/web3.js";
import { IPFSClient, SolanaSDK } from "8004-solana";

type Lane = "dev" | "staging" | "production";
type Step = "validate" | "publish" | "register" | "submit" | "all";

type AgentMetadata = {
  name: string;
  description: string;
  image: string;
  category: string;
  queryEndpoint: string;
  openApiUrl: string;
  discoveryUrls: {
    html: string;
    json: string;
    text: string;
    llms: string;
    skills: string;
    metadata: string;
  };
  skills: string[];
  domains: string[];
  socials?: Record<string, string>;
  contact?: Record<string, string>;
};

type RunState = {
  lane: Lane;
  cluster: "devnet" | "mainnet-beta";
  updatedAt: string;
  metadataPath: string;
  metadataSha256: string;
  metadataCid?: string;
  metadataUri?: string;
  assetPubkey?: string;
  registrationSignature?: string;
  registrySubmission?: Record<string, unknown>;
};

const LANE_TO_BASE_URL: Record<Lane, string> = {
  dev: "https://dev.api.trader-ralph.com",
  staging: "https://staging.api.trader-ralph.com",
  production: "https://api.trader-ralph.com",
};

const LANE_TO_CLUSTER: Record<Lane, "devnet" | "mainnet-beta"> = {
  dev: "devnet",
  staging: "devnet",
  production: "mainnet-beta",
};

const LANE_TO_METADATA_PATH: Record<Lane, string> = {
  dev: resolve("docs/agent-registry/metadata.dev.json"),
  staging: resolve("docs/agent-registry/metadata.staging.json"),
  production: resolve("docs/agent-registry/metadata.production.json"),
};

function parseArgs(argv: string[]): {
  lane: Lane;
  step: Step;
  dryRun: boolean;
} {
  let lane: Lane | null = null;
  let step: Step = "all";
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--lane") {
      const value = argv[i + 1] as Lane | undefined;
      if (!value || !["dev", "staging", "production"].includes(value)) {
        throw new Error("invalid-or-missing-lane");
      }
      lane = value;
      i += 1;
      continue;
    }
    if (arg === "--step") {
      const value = argv[i + 1] as Step | undefined;
      if (
        !value ||
        !["validate", "publish", "register", "submit", "all"].includes(value)
      ) {
        throw new Error("invalid-step");
      }
      step = value;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  if (!lane) throw new Error("missing-lane");
  return { lane, step, dryRun };
}

async function readMetadata(path: string): Promise<AgentMetadata> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as AgentMetadata;
}

function ensureStartsWith(value: string, prefix: string, field: string): void {
  if (!value.startsWith(prefix)) {
    throw new Error(`metadata-domain-mismatch:${field}`);
  }
}

function validateMetadata(metadata: AgentMetadata, lane: Lane): void {
  const expectedBase = LANE_TO_BASE_URL[lane];
  const required = [
    metadata.name,
    metadata.description,
    metadata.image,
    metadata.category,
    metadata.queryEndpoint,
    metadata.openApiUrl,
  ];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("metadata-missing-required-fields");
  }
  if (!Array.isArray(metadata.skills) || metadata.skills.length < 1) {
    throw new Error("metadata-skills-required");
  }
  if (!Array.isArray(metadata.domains) || metadata.domains.length < 1) {
    throw new Error("metadata-domains-required");
  }

  ensureStartsWith(metadata.queryEndpoint, expectedBase, "queryEndpoint");
  ensureStartsWith(metadata.openApiUrl, expectedBase, "openApiUrl");

  const urls = metadata.discoveryUrls;
  ensureStartsWith(urls.html, expectedBase, "discoveryUrls.html");
  ensureStartsWith(urls.json, expectedBase, "discoveryUrls.json");
  ensureStartsWith(urls.text, expectedBase, "discoveryUrls.text");
  ensureStartsWith(urls.llms, expectedBase, "discoveryUrls.llms");
  ensureStartsWith(urls.skills, expectedBase, "discoveryUrls.skills");
  ensureStartsWith(urls.metadata, expectedBase, "discoveryUrls.metadata");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function statePathForLane(lane: Lane): Promise<string> {
  const dir = resolve(".tmp/agent-registry");
  await mkdir(dir, { recursive: true });
  return resolve(dir, `${lane}.state.json`);
}

async function writeState(path: string, state: RunState): Promise<void> {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readState(path: string): Promise<RunState | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as RunState;
  } catch {
    return null;
  }
}

async function publishMetadata(
  metadata: AgentMetadata,
  dryRun: boolean,
): Promise<{ cid: string; uri: string }> {
  if (dryRun) {
    const pseudoCid = `dryrun-${sha256(JSON.stringify(metadata)).slice(0, 24)}`;
    return {
      cid: pseudoCid,
      uri: `ipfs://${pseudoCid}`,
    };
  }

  const pinataJwt = String(process.env.AGENT_PINATA_JWT ?? "").trim();
  if (!pinataJwt) throw new Error("missing-AGENT_PINATA_JWT");

  const ipfs = new IPFSClient({ pinataEnabled: true, pinataJwt });
  const cid = await ipfs.addJson(metadata);
  return {
    cid,
    uri: `ipfs://${cid}`,
  };
}

function parseSecretKey(raw: string): Uint8Array {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 64) {
    throw new Error("invalid-AGENT_SOLANA_PRIVATE_KEY");
  }
  return Uint8Array.from(parsed as number[]);
}

async function registerAgent(
  lane: Lane,
  metadataUri: string,
  dryRun: boolean,
): Promise<{ assetPubkey: string; signature?: string }> {
  if (dryRun) {
    return {
      assetPubkey: `dryrun-${lane}-asset`,
      signature: "dryrun-signature",
    };
  }

  const rawPk = String(process.env.AGENT_SOLANA_PRIVATE_KEY ?? "").trim();
  if (!rawPk) throw new Error("missing-AGENT_SOLANA_PRIVATE_KEY");
  const signer = Keypair.fromSecretKey(parseSecretKey(rawPk));
  const cluster = LANE_TO_CLUSTER[lane];
  const sdk = new SolanaSDK({ cluster, signer });

  const existingAssetPubkey = String(
    process.env.AGENT_ASSET_PUBKEY ?? "",
  ).trim();
  if (existingAssetPubkey) {
    const asset = new PublicKey(existingAssetPubkey);
    const result = (await sdk.setAgentUri(asset, metadataUri)) as {
      signature?: string;
    };
    return {
      assetPubkey: asset.toBase58(),
      signature: result?.signature,
    };
  }

  const result = (await sdk.registerAgent(metadataUri, {
    atomEnabled: false,
  })) as {
    asset?: PublicKey;
    signature?: string;
  };

  if (!result?.asset) {
    throw new Error("register-agent-missing-asset");
  }

  return {
    assetPubkey: result.asset.toBase58(),
    signature: result.signature,
  };
}

async function callRegistry(
  baseUrl: string,
  token: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      `registry-api-failed:${path}:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return body;
}

async function submitToRegistry(
  lane: Lane,
  metadata: AgentMetadata,
  metadataUri: string,
  assetPubkey: string,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  if (dryRun) {
    return {
      mode: "dry-run",
      lane,
      createProfile: { ok: true },
      submitAgent: { ok: true },
      testAgent: { ok: true },
    };
  }

  const baseUrl = String(process.env.AGENT_REGISTRY_API_BASE_URL ?? "").trim();
  const token = String(process.env.AGENT_REGISTRY_API_TOKEN ?? "").trim();
  if (!baseUrl) throw new Error("missing-AGENT_REGISTRY_API_BASE_URL");
  if (!token) throw new Error("missing-AGENT_REGISTRY_API_TOKEN");

  let normalizedBase: string;
  try {
    normalizedBase = new URL(baseUrl).toString().replace(/\/+$/, "");
  } catch {
    throw new Error("invalid-AGENT_REGISTRY_API_BASE_URL");
  }

  const createProfile = await callRegistry(
    normalizedBase,
    token,
    "/v1/create_profile",
    {
      name: metadata.name,
      description: metadata.description,
      category: metadata.category,
    },
  );
  const submitAgent = await callRegistry(
    normalizedBase,
    token,
    "/v1/submit_agent",
    {
      lane,
      metadataUri,
      assetPubkey,
      queryEndpoint: metadata.queryEndpoint,
      openApiUrl: metadata.openApiUrl,
      metadata,
    },
  );
  const testAgent = await callRegistry(
    normalizedBase,
    token,
    "/v1/test_agent",
    {
      lane,
      queryEndpoint: metadata.queryEndpoint,
      query: "health",
    },
  );

  return {
    createProfile,
    submitAgent,
    testAgent,
  };
}

function stepsFor(step: Step): Exclude<Step, "all">[] {
  if (step === "all") return ["validate", "publish", "register", "submit"];
  return [step];
}

async function main() {
  const { lane, step, dryRun } = parseArgs(process.argv.slice(2));
  const metadataPath = LANE_TO_METADATA_PATH[lane];
  const cluster = LANE_TO_CLUSTER[lane];
  const statePath = await statePathForLane(lane);
  const previousState = await readState(statePath);

  const metadata = await readMetadata(metadataPath);
  const metadataRaw = JSON.stringify(metadata);
  const metadataSha256 = sha256(metadataRaw);

  let state: RunState = {
    ...(previousState ?? {}),
    lane,
    cluster,
    updatedAt: new Date().toISOString(),
    metadataPath,
    metadataSha256,
  };

  for (const item of stepsFor(step)) {
    if (item === "validate") {
      validateMetadata(metadata, lane);
      console.log(`[agent-registry] validated metadata for lane=${lane}`);
    }

    if (item === "publish") {
      const published = await publishMetadata(metadata, dryRun);
      state = {
        ...state,
        metadataCid: published.cid,
        metadataUri: published.uri,
        updatedAt: new Date().toISOString(),
      };
      console.log(
        `[agent-registry] published metadata lane=${lane} uri=${published.uri}`,
      );
      await writeState(statePath, state);
    }

    if (item === "register") {
      const metadataUri = state.metadataUri;
      if (!metadataUri) {
        throw new Error(
          "missing-metadata-uri:run-publish-first-or-use---step-all",
        );
      }
      const registration = await registerAgent(lane, metadataUri, dryRun);
      state = {
        ...state,
        assetPubkey: registration.assetPubkey,
        registrationSignature: registration.signature,
        updatedAt: new Date().toISOString(),
      };
      console.log(
        `[agent-registry] registered lane=${lane} asset=${registration.assetPubkey}`,
      );
      await writeState(statePath, state);
    }

    if (item === "submit") {
      const metadataUri = state.metadataUri;
      const assetPubkey = state.assetPubkey;
      if (!metadataUri || !assetPubkey) {
        throw new Error(
          "missing-registration-state:run-publish-and-register-before-submit",
        );
      }
      const submission = await submitToRegistry(
        lane,
        metadata,
        metadataUri,
        assetPubkey,
        dryRun,
      );
      state = {
        ...state,
        registrySubmission: submission,
        updatedAt: new Date().toISOString(),
      };
      console.log(`[agent-registry] submitted lane=${lane}`);
      await writeState(statePath, state);
    }
  }

  if (!["publish", "register", "submit", "all"].includes(step)) {
    await writeState(statePath, state);
  }

  console.log(
    `[agent-registry] done lane=${lane} step=${step} dryRun=${dryRun}`,
  );
  console.log(`[agent-registry] state: ${statePath}`);
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-registry] error: ${message}`);
  process.exitCode = 1;
});
