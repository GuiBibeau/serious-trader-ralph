// Production equivalents of the vite dev proxies: same-origin paths that
// forward to upstream APIs with secrets injected server-side. In `vite dev`
// the dev proxies intercept these paths first; in production these handlers
// serve them. Client code is identical in both environments.

import type { RequestEvent } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";

type ProxyOptions = {
  target: string;
  headers?: () => Record<string, string>;
  /** Cache-Control for successful GET responses. */
  cacheControl?: string;
};

export async function proxyRequest(
  event: RequestEvent,
  prefix: string,
  options: ProxyOptions,
): Promise<Response> {
  const url = new URL(event.request.url);
  const upstreamPath = url.pathname.slice(prefix.length) || "/";
  const upstream = `${options.target}${upstreamPath}${url.search}`;

  const headers = new Headers();
  const contentType = event.request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  for (const [key, value] of Object.entries(options.headers?.() ?? {})) {
    if (value) headers.set(key, value);
  }

  const init: RequestInit = {
    method: event.request.method,
    headers,
  };
  if (event.request.method !== "GET" && event.request.method !== "HEAD") {
    init.body = await event.request.arrayBuffer();
  }

  const response = await fetch(upstream, init);
  const responseHeaders = new Headers();
  const upstreamType = response.headers.get("content-type");
  if (upstreamType) responseHeaders.set("content-type", upstreamType);
  if (response.ok && event.request.method === "GET" && options.cacheControl) {
    responseHeaders.set("cache-control", options.cacheControl);
  }
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const upstreams = {
  tokensxyz: (): ProxyOptions => ({
    target: "https://api.tokens.xyz",
    headers: () => ({ "x-api-key": env.TOKENS_XYZ_API_KEY ?? "" }),
    cacheControl: "public, s-maxage=30, stale-while-revalidate=300",
  }),
  deepseek: (): ProxyOptions => ({
    target: "https://api.deepseek.com",
    headers: () => ({
      authorization: env.DEEPSEEK_API_KEY
        ? `Bearer ${env.DEEPSEEK_API_KEY}`
        : "",
    }),
  }),
  jupiter: (): ProxyOptions => ({
    target: "https://lite-api.jup.ag",
  }),
  yahoo: (): ProxyOptions => ({
    target: "https://query1.finance.yahoo.com",
    headers: () => ({ "user-agent": "Mozilla/5.0" }),
    cacheControl: "public, s-maxage=30, stale-while-revalidate=300",
  }),
  gdelt: (): ProxyOptions => ({
    target: "https://api.gdeltproject.org",
    cacheControl: "public, s-maxage=60, stale-while-revalidate=600",
  }),
};
