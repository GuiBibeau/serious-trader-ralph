/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    "localhost",
    "*.localhost",
    "127.0.0.1",
    "dev.trader-ralph.com",
    "trader-ralph.com",
    "www.trader-ralph.com",
    "api.trader-ralph.com",
    "dev.api.trader-ralph.com",
  ],
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
          has: [{ type: "host", value: "api.trader-ralph.com" }],
          destination: "https://ralph-edge.gui-bibeau.workers.dev/:path*",
        },
      ],
    };
  },
};

module.exports = nextConfig;
