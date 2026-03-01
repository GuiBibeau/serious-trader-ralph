/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
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
