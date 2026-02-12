import { type NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/app/:path*"],
};

export function middleware(req: NextRequest) {
  // Let OAuth callbacks through (Privy redirects back with this param)
  if (req.nextUrl.searchParams.has("privy_oauth_code"))
    return NextResponse.next();

  // Let the refresh page through — it handles token renewal client-side
  if (req.nextUrl.pathname === "/app/refresh") return NextResponse.next();

  const hasToken = Boolean(req.cookies.get("privy-token")?.value);
  const hasSession = Boolean(req.cookies.get("privy-session")?.value);

  // Token present → definitely authenticated → pass through
  if (hasToken) return NextResponse.next();

  // Session present but no token → token may have expired → try refreshing
  if (hasSession) {
    const url = new URL("/app/refresh", req.url);
    url.searchParams.set("redirect", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // No cookies at all → not authenticated → send to landing page
  return NextResponse.redirect(new URL("/", req.url));
}
