import { NextResponse } from "next/server";

const LOCAL_EDGE_API_BASE = "http://127.0.0.1:8888";
const LOCAL_ORIGIN_ALLOWLIST = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function resolveAllowedOrigins(request: Request): Set<string> {
  const allowed = new Set<string>();
  const requestOrigin = normalizeOrigin(new URL(request.url).origin);
  if (requestOrigin) allowed.add(requestOrigin);

  const siteOrigin = normalizeOrigin(
    String(process.env.NEXT_PUBLIC_SITE_URL ?? ""),
  );
  if (siteOrigin) allowed.add(siteOrigin);

  const extraOrigins = String(process.env.WAITLIST_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter((item): item is string => Boolean(item));
  for (const origin of extraOrigins) allowed.add(origin);

  if (process.env.NODE_ENV !== "production") {
    for (const localOrigin of LOCAL_ORIGIN_ALLOWLIST) {
      allowed.add(localOrigin);
    }
  }

  return allowed;
}

function isAllowedWaitlistOrigin(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  const normalizedOrigin = normalizeOrigin(String(originHeader ?? ""));
  if (!normalizedOrigin) return false;
  return resolveAllowedOrigins(request).has(normalizedOrigin);
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!isAllowedWaitlistOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "invalid-origin" },
      { status: 403 },
    );
  }

  const payloadRaw = (await request.json().catch(() => null)) as unknown;
  const payload = isRecord(payloadRaw) ? payloadRaw : {};

  const email = normalizeEmail(payload.email);
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "invalid-email" },
      { status: 400 },
    );
  }

  const source = String(payload.source ?? "landing_page")
    .trim()
    .slice(0, 80);
  const configured = (process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "")
    .trim()
    .replace(/\/+$/, "");
  const base =
    configured ||
    (process.env.NODE_ENV === "production" ? "" : LOCAL_EDGE_API_BASE);

  if (!base) {
    return NextResponse.json(
      { ok: false, error: "missing NEXT_PUBLIC_EDGE_API_BASE" },
      { status: 503 },
    );
  }
  const bearerToken = String(
    process.env.WAITLIST_UPSTREAM_BEARER_TOKEN ?? "",
  ).trim();
  if (!bearerToken) {
    return NextResponse.json(
      { ok: false, error: "missing WAITLIST_UPSTREAM_BEARER_TOKEN" },
      { status: 503 },
    );
  }

  const upstream = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ email, source: source || "landing_page_modal" }),
  });
  const upstreamJson = (await upstream.json().catch(() => null)) as unknown;
  const body =
    isRecord(upstreamJson) && "ok" in upstreamJson
      ? upstreamJson
      : { ok: false, error: "waitlist-upstream-error" };

  return NextResponse.json(body, { status: upstream.status });
}
