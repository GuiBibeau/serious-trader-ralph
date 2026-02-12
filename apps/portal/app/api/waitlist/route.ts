import { NextResponse } from "next/server";

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  if (contentType.includes("form")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return {};
}

export async function POST(request: Request) {
  const base = (process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "").replace(
    /\/+$/,
    "",
  );
  if (!base) {
    return NextResponse.json(
      { ok: false, error: "missing-edge-api-base" },
      { status: 500 },
    );
  }

  const payload = await readPayload(request);
  const upstream = await fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const contentType =
    upstream.headers.get("content-type") ?? "application/json";
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": contentType },
  });
}
