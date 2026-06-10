import { proxyRequest, upstreams } from "$lib/server/proxy";
import type { RequestHandler } from "./$types";

const handle: RequestHandler = (event) =>
  proxyRequest(event, "/deepseek", upstreams.deepseek());

export const GET = handle;
export const POST = handle;
