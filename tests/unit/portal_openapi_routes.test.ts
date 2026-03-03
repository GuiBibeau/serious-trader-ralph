import { describe, expect, test } from "bun:test";
import { X402_ENDPOINTS } from "../../apps/portal/app/api/_catalog";
import { toApiRuntimePath } from "../../apps/portal/app/api/_discovery";
import { GET as getOpenApiAlias } from "../../apps/portal/app/api/openapi.json/route";
import { GET as getOpenApi } from "../../apps/portal/app/openapi.json/route";

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

describe("portal openapi routes", () => {
  test("GET /openapi.json returns OpenAPI 3.1 with public routes", async () => {
    const response = getOpenApi(
      new Request("https://portal.example/openapi.json"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const payload = (await response.json()) as unknown;
    const doc = toRecord(payload);
    expect(doc).not.toBeNull();
    expect(doc?.openapi).toBe("3.1.0");

    const paths = toRecord(doc?.paths);
    expect(paths).not.toBeNull();
    expect(paths?.["/api/health"]).toBeDefined();
    expect(paths?.["/api/agent/query"]).toBeDefined();
    expect(paths?.["/openapi.json"]).toBeDefined();
    expect(paths?.["/api/llms.txt"]).toBeDefined();
    expect(paths?.["/agent-registry/metadata.json"]).toBeDefined();

    for (const endpoint of X402_ENDPOINTS) {
      const path = toApiRuntimePath(endpoint.path);
      const pathItem = toRecord(paths?.[path]);
      expect(pathItem).not.toBeNull();
      const post = toRecord(pathItem?.post);
      expect(post).not.toBeNull();
      const security = Array.isArray(post?.security) ? post.security : [];
      expect(security.length).toBeGreaterThan(0);
    }

    const components = toRecord(doc?.components);
    const securitySchemes = toRecord(components?.securitySchemes);
    const payment = toRecord(securitySchemes?.paymentSignature);
    expect(payment?.type).toBe("apiKey");
    expect(payment?.name).toBe("payment-signature");
  });

  test("GET /api/openapi.json returns alias content", async () => {
    const response = getOpenApiAlias(
      new Request("https://portal.example/api/openapi.json"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.openapi).toBe("3.1.0");
  });
});
