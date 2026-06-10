import { proxyRequest, upstreams } from "$lib/server/proxy";
import type { RequestHandler } from "./$types";

const handle: RequestHandler = (event) =>
  proxyRequest(event, "/gdelt", upstreams.gdelt());

export const GET = handle;
export const POST = handle;
