import type { MetadataRoute } from "next";

const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");

const PUBLIC_PATHS = [
  "/",
  "/api",
  "/endpoints.json",
  "/endpoints.txt",
  "/api/endpoints.json",
  "/api/endpoints.txt",
  "/llms.txt",
  "/api/llms.txt",
  "/openapi.json",
  "/api/openapi.json",
  "/agent-registry/metadata.json",
  "/api/agent-registry/metadata.json",
  "/login",
  "/terminal",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PATHS.map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency:
      path.startsWith("/api") ||
      path.startsWith("/endpoints.") ||
      path === "/llms.txt"
        ? "daily"
        : "weekly",
    priority: path === "/" ? 1 : path === "/api" ? 0.9 : 0.7,
  }));
}
