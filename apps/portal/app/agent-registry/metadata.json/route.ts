import { resolveAgentRegistryMetadata } from "../../api/_agent_registry";
import {
  resolveApiOriginFromRequest,
  toAbsoluteApiUrl,
} from "../../api/_discovery";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";

export function GET(request: Request): Response {
  const apiOrigin = resolveApiOriginFromRequest(request);
  const metadata = resolveAgentRegistryMetadata(apiOrigin);

  return Response.json(
    {
      ...metadata,
      metadataUrl: toAbsoluteApiUrl(apiOrigin, "/agent-registry/metadata.json"),
    },
    {
      headers: {
        "cache-control": CACHE_CONTROL,
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
