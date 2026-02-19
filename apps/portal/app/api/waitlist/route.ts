import { NextResponse } from "next/server";

export async function POST(request: Request) {
  void request;
  return NextResponse.json(
    { ok: false, error: "manual-onboarding-only" },
    { status: 410 },
  );
}
