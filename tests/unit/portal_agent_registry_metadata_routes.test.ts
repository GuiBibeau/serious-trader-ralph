import { describe, expect, test } from "bun:test";
import { GET as getMetadata } from "../../apps/portal/app/agent-registry/metadata.json/route";
import { GET as getMetadataAlias } from "../../apps/portal/app/api/agent-registry/metadata.json/route";

describe("portal agent registry metadata routes", () => {
  test("serves dev lane metadata from host mapping", async () => {
    const response = getMetadata(
      new Request("https://dev.trader-ralph.com/agent-registry/metadata.json"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.lane).toBe("dev");
    expect(String(payload.queryEndpoint)).toBe(
      "https://dev.api.trader-ralph.com/api/agent/query",
    );
  });

  test("serves staging lane metadata from host mapping", async () => {
    const response = getMetadata(
      new Request(
        "https://staging.trader-ralph.com/agent-registry/metadata.json",
      ),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.lane).toBe("staging");
    expect(String(payload.openApiUrl)).toBe(
      "https://staging.api.trader-ralph.com/openapi.json",
    );
  });

  test("serves production lane metadata and alias", async () => {
    const response = getMetadata(
      new Request("https://trader-ralph.com/agent-registry/metadata.json"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.lane).toBe("production");
    expect(String(payload.metadataUrl)).toContain(
      "https://api.trader-ralph.com/agent-registry/metadata.json",
    );

    const aliasResponse = getMetadataAlias(
      new Request("https://trader-ralph.com/api/agent-registry/metadata.json"),
    );
    expect(aliasResponse.status).toBe(200);
    const aliasPayload = (await aliasResponse.json()) as Record<
      string,
      unknown
    >;
    expect(aliasPayload.lane).toBe("production");
  });
});
