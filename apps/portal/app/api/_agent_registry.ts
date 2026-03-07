import devMetadata from "../../../../docs/agent-registry/metadata.dev.json";
import productionMetadata from "../../../../docs/agent-registry/metadata.production.json";
import { buildDiscoveryUrls, toAbsoluteApiUrl } from "./_discovery";

export type AgentRegistryLane = "dev" | "production";

type AgentRegistryMetadata = {
  name: string;
  description: string;
  image: string;
  category: string;
  queryEndpoint: string;
  openApiUrl: string;
  discoveryUrls: {
    html: string;
    json: string;
    text: string;
    llms: string;
    skills: string;
    metadata: string;
  };
  skills: string[];
  domains: string[];
  socials?: Record<string, string>;
  contact?: Record<string, string>;
};

function parseHostname(apiOrigin: string): string {
  try {
    return new URL(apiOrigin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function laneFromApiOrigin(apiOrigin: string): AgentRegistryLane {
  const hostname = parseHostname(apiOrigin);
  if (hostname === "dev.api.trader-ralph.com") return "dev";
  return "production";
}

export function metadataForLane(
  lane: AgentRegistryLane,
): AgentRegistryMetadata {
  if (lane === "dev") return structuredClone(devMetadata);
  return structuredClone(productionMetadata);
}

export function resolveAgentRegistryMetadata(
  apiOrigin: string,
): AgentRegistryMetadata & {
  lane: AgentRegistryLane;
  generatedAt: string;
} {
  const lane = laneFromApiOrigin(apiOrigin);
  const discovery = buildDiscoveryUrls(apiOrigin);
  const metadata = metadataForLane(lane);
  return {
    ...metadata,
    queryEndpoint: toAbsoluteApiUrl(apiOrigin, "/api/agent/query"),
    openApiUrl: discovery.openapi,
    discoveryUrls: {
      html: discovery.html,
      json: discovery.json,
      text: discovery.text,
      llms: discovery.llms,
      skills: discovery.skills,
      metadata: discovery.agentRegistryMetadata,
    },
    lane,
    generatedAt: new Date().toISOString(),
  };
}
