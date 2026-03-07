import {
  X402_CATALOG_VERSION,
  X402_ENDPOINTS,
  X402_OVERVIEW,
  X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE,
  X402_SUPPORTED_TRADING,
  type X402EndpointSpec,
} from "../_catalog";
import {
  buildDiscoveryUrls,
  resolveApiOriginFromRequest,
  toAbsoluteApiUrl,
  toApiRuntimePath,
} from "../_discovery";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";
const EXEC_SUBMIT_PRIVY_EXAMPLE = {
  schemaVersion: "v1",
  mode: "privy_execute",
  lane: "safe",
  metadata: {
    source: "terminal-ui",
    reason: "rebalance",
    clientRequestId: "ui-001",
  },
  privyExecute: {
    intentType: "swap",
    wallet: "4Nd1mYjtY9p7jW3nX5z9r4s1v6u8t2q3m5n7p9r1s2t3",
    swap: {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountAtomic: "100000000",
      slippageBps: 50,
    },
    options: {
      commitment: "confirmed",
    },
  },
} satisfies Record<string, unknown>;

function formatFields(
  label: string,
  fields: X402EndpointSpec["requiredFields"],
): string {
  if (fields.length < 1) return `${label}: none`;
  const fieldText = fields
    .map((field) => `${field.name}:${field.type}`)
    .join(", ");
  return `${label}: ${fieldText}`;
}

function formatExample(value: Record<string, unknown>): string {
  if (Object.keys(value).length < 1) return "{} (no body required)";
  return JSON.stringify(value);
}

export function GET(request: Request): Response {
  const apiOrigin = resolveApiOriginFromRequest(request);
  const discovery = buildDiscoveryUrls(apiOrigin);

  const lines: string[] = [
    "Trader Ralph x402 API Catalog",
    `version: ${X402_CATALOG_VERSION}`,
    "",
    `offering: ${X402_OVERVIEW.offering}`,
    "scope: public x402 endpoints (/x402/read/* and /x402/exec/*)",
    "",
    "x402 flow:",
    "1) POST endpoint",
    "2) if unpaid, receive 402 + payment-required",
    "3) pay, retry with payment-signature",
    "4) on success, response includes payment-response",
    "",
    "verification:",
    "payment-signature must reference an on-chain Solana transfer that matches network, mint, payTo, and amount.",
    "dev environment uses devnet USDC; production uses mainnet USDC.",
    "",
    "headers:",
    "request: payment-signature",
    "response: payment-required, payment-response",
    "note: /x402/exec/status/{requestId} and /x402/exec/receipt/{requestId} are public and do not require payment.",
    "",
    "runtime urls:",
    `api origin: ${apiOrigin}`,
    `x402 base path: ${toApiRuntimePath("/x402")}`,
    `x402 base url: ${toAbsoluteApiUrl(apiOrigin, toApiRuntimePath("/x402"))}`,
    "",
    `example 402 response: ${JSON.stringify(X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE)}`,
    "",
    `supported trading tokens: ${X402_SUPPORTED_TRADING.tokens.map((token) => token.symbol).join(", ")}`,
    `supported trading pairs: ${X402_SUPPORTED_TRADING.pairs.map((pair) => pair.id).join(", ")}`,
    "",
    "discovery:",
    `html: ${discovery.html}`,
    `json: ${discovery.json}`,
    `text: ${discovery.text}`,
    `llms: ${discovery.llms}`,
    `skills: ${discovery.skills}`,
    `openapi: ${discovery.openapi}`,
    `agent registry metadata: ${discovery.agentRegistryMetadata}`,
    "",
    "endpoints:",
  ];

  for (const endpoint of X402_ENDPOINTS) {
    const runtimePath = toApiRuntimePath(endpoint.path);
    const runtimeUrl = toAbsoluteApiUrl(apiOrigin, runtimePath);
    lines.push(
      `${endpoint.method} ${endpoint.path} (runtime: ${runtimeUrl}) - ${endpoint.summary}`,
    );
    lines.push(`  ${formatFields("required", endpoint.requiredFields)}`);
    lines.push(`  ${formatFields("optional", endpoint.optionalFields)}`);
    lines.push(`  example request: ${formatExample(endpoint.requestExample)}`);
    lines.push(
      `  example response: ${JSON.stringify(endpoint.responseExample)}`,
    );
    if (endpoint.id === "exec_submit") {
      lines.push(
        `  example request (privy_execute): ${JSON.stringify(EXEC_SUBMIT_PRIVY_EXAMPLE)}`,
      );
      lines.push("  required header: Idempotency-Key");
    }
  }

  const body = `${lines.join("\n")}\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": CACHE_CONTROL,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
