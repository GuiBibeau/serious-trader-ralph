import { proxyRequest, upstreams } from "$lib/server/proxy";
import type { RequestHandler } from "./$types";

const handle: RequestHandler = (event) =>
  proxyRequest(event, "/tokensxyz", upstreams.tokensxyz());

export const GET = handle;
export const POST = handle;
