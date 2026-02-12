import type { Env } from "./types";

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function withCors(response: Response, env: Env) {
  const allowed = env.ALLOWED_ORIGINS ?? "*";
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowed);
  headers.set("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");
  headers.set("access-control-max-age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function okCors(env: Env) {
  return withCors(new Response(null, { status: 204 }), env);
}
