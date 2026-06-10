export function GET() {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /terminal",
    "",
    "Sitemap: https://traderralph.com/sitemap.xml",
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, s-maxage=86400",
    },
  });
}
