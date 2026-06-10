import { proxyRequest, upstreams } from "$lib/server/proxy";
import type { RequestHandler } from "./$types";

const handle: RequestHandler = (event) =>
  proxyRequest(event, "/yahoo", upstreams.yahoo());

export const GET = handle;
export const POST = handle;
