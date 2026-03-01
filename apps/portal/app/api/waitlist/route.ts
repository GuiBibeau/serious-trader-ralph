import { NextResponse } from "next/server";

const LOCAL_EDGE_API_BASE = "http://127.0.0.1:8888";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
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

  const upstream = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, source }),
  });
  const upstreamJson = (await upstream.json().catch(() => null)) as unknown;
  const body =
    isRecord(upstreamJson) && "ok" in upstreamJson
      ? upstreamJson
      : { ok: false, error: "waitlist-upstream-error" };

  return NextResponse.json(body, { status: upstream.status });
}
