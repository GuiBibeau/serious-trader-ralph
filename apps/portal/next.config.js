/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/:path*",
          has: [{ type: "host", value: "dev.api.trader-ralph.com" }],
          destination: "https://ralph-edge-dev.gui-bibeau.workers.dev/:path*",
        },
        {
          source: "/:path*",
          has: [{ type: "host", value: "staging.api.trader-ralph.com" }],
          destination:
            "https://ralph-edge-staging.gui-bibeau.workers.dev/:path*",
        },
        {
          source: "/:path*",
          has: [{ type: "host", value: "api.trader-ralph.com" }],
          destination: "https://ralph-edge.gui-bibeau.workers.dev/:path*",
        },
      ],
    };
  },
};

module.exports = nextConfig;
