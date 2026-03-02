import { resolveApiOriginFromRequest } from "../api/_discovery";
import { buildOpenApiDocument } from "../api/_openapi";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";

export function GET(request: Request): Response {
  const apiOrigin = resolveApiOriginFromRequest(request);
  const payload = buildOpenApiDocument(apiOrigin);
  return Response.json(payload, {
    headers: {
      "cache-control": CACHE_CONTROL,
      "content-type": "application/json; charset=utf-8",
    },
  });
}
