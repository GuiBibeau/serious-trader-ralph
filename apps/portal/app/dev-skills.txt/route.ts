import {
  buildDiscoveryUrls,
  resolveApiOriginFromRequest,
  toAbsoluteApiUrl,
  toApiRuntimePath,
} from "../api/_discovery";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";

type SkillSpec = {
  id: string;
  title: string;
  sourceUrl: string;
  purpose: string;
};

function codexSkillContent(skill: SkillSpec, apiOrigin: string): string {
  return [
    `# Skill: ${skill.id}`,
    "",
    "## Trigger",
    `Use this skill when the user asks for ${skill.title} from Trader Ralph.`,
    "",
    "## Source",
    `- Primary URL: ${skill.sourceUrl}`,
    `- API origin: ${apiOrigin}`,
    "",
    "## Workflow",
    "1. Fetch the source URL.",
    "2. Parse response body as authoritative for the current environment.",
    "3. Return explicit absolute URLs, not relative paths.",
    "4. If fields are missing, report the exact gap and fallback source.",
    "",
    "## Output Rules",
    "- Keep endpoint URLs fully-qualified.",
    "- Preserve x402 header requirements and method/path exactly.",
    "- Prefer machine-readable payload fields where available.",
  ].join("\n");
}

function claudeSkillContent(skill: SkillSpec, apiOrigin: string): string {
  return [
    "---",
    `name: ${skill.id}`,
    `description: Resolve and use ${skill.title} for the current Trader Ralph environment.`,
    "---",
    "",
    `Primary source: ${skill.sourceUrl}`,
    `API origin: ${apiOrigin}`,
    "",
    "Instructions:",
    "1. Read the source URL first.",
    "2. Extract absolute URLs for endpoints/discovery links.",
    "3. Keep outputs concise and machine-usable.",
    "4. Surface missing/invalid fields explicitly.",
  ].join("\n");
}

export function GET(request: Request): Response {
  const apiOrigin = resolveApiOriginFromRequest(request);
  const discovery = buildDiscoveryUrls(apiOrigin);

  const skills: SkillSpec[] = [
    {
      id: "trader-ralph-api-docs",
      title: "/api",
      sourceUrl: discovery.html,
      purpose: "Human-readable API overview and x402 flow guidance.",
    },
    {
      id: "trader-ralph-endpoints-json",
      title: "/endpoints.json",
      sourceUrl: discovery.json,
      purpose: "Machine-readable catalog with endpoint metadata.",
    },
    {
      id: "trader-ralph-endpoints-txt",
      title: "/endpoints.txt",
      sourceUrl: discovery.text,
      purpose: "Plain text catalog for agents and quick CLI ingestion.",
    },
    {
      id: "trader-ralph-llms-txt",
      title: "/llms.txt",
      sourceUrl: discovery.llms,
      purpose: "LLM discovery metadata and endpoint index.",
    },
    {
      id: "trader-ralph-openapi-json",
      title: "/openapi.json",
      sourceUrl: discovery.openapi,
      purpose: "OpenAPI 3.1 specification for all public routes.",
    },
    {
      id: "trader-ralph-agent-registry-metadata",
      title: "/agent-registry/metadata.json",
      sourceUrl: discovery.agentRegistryMetadata,
      purpose: "Lane-specific metadata document for Solana Agent Registry.",
    },
  ];

  const lines: string[] = [
    "Trader Ralph Developer Skills Pack",
    "",
    "AI-first, environment-aware skills for API discovery and ingestion.",
    `API origin: ${apiOrigin}`,
    `x402 runtime base: ${toAbsoluteApiUrl(apiOrigin, toApiRuntimePath("/x402/read"))}`,
    "",
    "Skill index:",
    ...skills.map(
      (skill) =>
        `- ${skill.id} | source=${skill.sourceUrl} | purpose=${skill.purpose}`,
    ),
    "",
    "Installation (Codex format):",
    "1) Create one folder per skill under $CODEX_HOME/skills/<skill-id>/",
    "2) Save SKILL.md with the corresponding block content below.",
    "",
    "Installation (Claude format):",
    "1) Create .claude/skills/ in your repo (or your Claude skills directory).",
    "2) Save one <skill-id>.md file per block below.",
    "",
    "Download this file:",
    `curl -fsSL ${discovery.skills} -o trader-ralph-dev-skills.txt`,
    "",
  ];

  for (const skill of skills) {
    lines.push(`=== CODEX SKILL START: ${skill.id} ===`);
    lines.push(codexSkillContent(skill, apiOrigin));
    lines.push(`=== CODEX SKILL END: ${skill.id} ===`);
    lines.push("");
    lines.push(`=== CLAUDE SKILL START: ${skill.id} ===`);
    lines.push(claudeSkillContent(skill, apiOrigin));
    lines.push(`=== CLAUDE SKILL END: ${skill.id} ===`);
    lines.push("");
  }

  const body = `${lines.join("\n")}\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": CACHE_CONTROL,
      "content-disposition":
        'attachment; filename="trader-ralph-dev-skills.txt"',
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
