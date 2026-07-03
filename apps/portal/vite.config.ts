import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load all env vars (no prefix filter) so server-side secrets are available
  // to the dev proxies without ever being exposed to the client bundle.
  const env = loadEnv(mode, process.cwd(), "");
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim();
  const tokensXyzKey = env.TOKENS_XYZ_API_KEY?.trim();
  const discordWebhook = env.DISCORD_WEBHOOK_URL?.trim();
  const discordPath = discordWebhook
    ? new URL(discordWebhook).pathname + new URL(discordWebhook).search
    : "";

  return {
    envPrefix: ["VITE_", "PUBLIC_", "NEXT_PUBLIC_"],
    plugins: [sveltekit()],
    ssr: { noExternal: ["@trader-ralph/ui"] },
    server: {
      proxy: {
        // DeepSeek — key injected server-side, never in the client bundle.
        "/deepseek": {
          target: "https://api.deepseek.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/deepseek/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (deepseekKey) {
                proxyReq.setHeader("Authorization", `Bearer ${deepseekKey}`);
              }
            });
          },
        },
        // Yahoo Finance v8 chart — keyless macro/market quotes (CORS workaround).
        "/yahoo": {
          target: "https://query1.finance.yahoo.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/yahoo/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("user-agent", "Mozilla/5.0");
            });
          },
        },
        // GDELT 2.0 — keyless geopolitical/market event + news stream.
        "/gdelt": {
          target: "https://api.gdeltproject.org",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gdelt/, ""),
        },
        // Jupiter swap API (keyless lite tier) for SOL→USDC conversion.
        "/jupiter": {
          target: "https://lite-api.jup.ag",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/jupiter/, ""),
        },
        // tokens.xyz asset catalog — API key injected server-side only.
        "/tokensxyz": {
          target: "https://api.tokens.xyz",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tokensxyz/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (tokensXyzKey) {
                proxyReq.setHeader("x-api-key", tokensXyzKey);
              }
            });
          },
        },
        // Optional Discord webhook delivery — full URL (incl. token) kept server-side.
        ...(discordPath
          ? {
              "/notify-discord": {
                target: "https://discord.com",
                changeOrigin: true,
                rewrite: () => discordPath,
              },
            }
          : {}),
      },
    },
  };
});
