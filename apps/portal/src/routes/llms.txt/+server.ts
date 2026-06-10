import { error } from "@sveltejs/kit";
import { getCatalog } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

const SITE = "https://traderralph.com";

export const GET: RequestHandler = async ({ setHeaders }) => {
  // Fail rather than cache an asset-less llms.txt at the CDN for an hour.
  const assets = await getCatalog().catch(() => {
    error(503, "Catalog unavailable");
  });
  const byHub = (hub: string) => assets.filter((asset) => asset.hub === hub);

  const section = (title: string, list: typeof assets) =>
    list.length
      ? `## ${title}\n\n${list
          .map(
            (asset) =>
              `- [${asset.symbol} — ${asset.name}](${SITE}/${asset.slug}.md): live price, news and trading for ${asset.name} on Solana`,
          )
          .join("\n")}\n`
      : "";

  const body = `# Trader Ralph

> A Solana trading terminal for crypto, tokenized equities and pre-IPO names.
> Spot trading is routed by Jupiter; perps run on Phoenix. Accounts settle in
> USDC and log in with email — a wallet is created automatically.

## Pages

- [Terminal](${SITE}/terminal): the trading terminal (requires login)
- [News](${SITE}/news): live market headlines tagged to tradable assets
- [Equities](${SITE}/equities): tokenized stocks hub
- [Pre-IPO](${SITE}/pre-ipo): tokenized private-company exposure hub
- [Crypto](${SITE}/crypto): crypto majors hub

${section("Equities", byHub("equities"))}
${section("Pre-IPO", byHub("pre-ipo"))}
${section("Crypto", byHub("crypto"))}
## Notes

- Tokenized equities provide synthetic price exposure, not shareholder rights.
- AI-generated desk commentary is informational, never financial advice.
`;

  setHeaders({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
  });
  return new Response(body);
};
