const DEFAULT_LOCAL_API_ORIGIN = "http://127.0.0.1:8888";

type HeaderLike = {
  get(name: string): string | null;
};

function parseForwardedValue(value: string | null): string {
  return String(value ?? "")
    .split(",")[0]
    .trim();
}

function normalizeProtocol(value: string): "http:" | "https:" {
  return value.trim().toLowerCase() === "http:" ? "http:" : "https:";
}

function parseHost(value: string): { hostname: string; port: string } {
  if (!value.trim()) return { hostname: "", port: "" };
  try {
    const parsed = new URL(`http://${value.trim()}`);
    return {
      hostname: parsed.hostname.toLowerCase(),
      port: parsed.port,
    };
  } catch {
    return { hostname: "", port: "" };
  }
}

function isDefaultPort(protocol: string, port: string): boolean {
  if (!port) return true;
  return (
    (protocol === "https:" && port === "443") ||
    (protocol === "http:" && port === "80")
  );
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0"
  );
}

function isVercelPreviewHostname(hostname: string): boolean {
  return hostname.endsWith(".vercel.app");
}

function mapToApiHostname(hostname: string): string {
  if (!hostname) return hostname;
  if (hostname.startsWith("api.") || hostname.includes(".api.")) {
    return hostname;
  }
  if (hostname === "trader-ralph.com" || hostname === "www.trader-ralph.com") {
    return "api.trader-ralph.com";
  }
  if (hostname === "dev.trader-ralph.com") {
    return "dev.api.trader-ralph.com";
  }
  if (hostname === "staging.trader-ralph.com") {
    return "staging.api.trader-ralph.com";
  }
  return hostname;
}

function configuredApiBase(): string {
  return String(process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function resolveApiOrigin(protocolRaw: string, hostRaw: string): string {
  const protocol = normalizeProtocol(protocolRaw);
  const { hostname, port } = parseHost(hostRaw);
  if (!hostname) return "";
  const configured = configuredApiBase();

  if (isLocalHostname(hostname)) {
    return configured || DEFAULT_LOCAL_API_ORIGIN;
  }

  if (configured && isVercelPreviewHostname(hostname)) {
    return configured;
  }

  const apiHostname = mapToApiHostname(hostname);
  const portSuffix = isDefaultPort(protocol, port) ? "" : `:${port}`;
  return `${protocol}//${apiHostname}${portSuffix}`;
}

export function resolveApiOriginFromRequest(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = parseForwardedValue(
    request.headers.get("x-forwarded-proto"),
  );
  const forwardedHost = parseForwardedValue(
    request.headers.get("x-forwarded-host"),
  );
  return resolveApiOrigin(
    forwardedProto || requestUrl.protocol,
    forwardedHost || requestUrl.host,
  );
}

export function resolveApiOriginFromHeaders(headers: HeaderLike): string {
  const forwardedProto =
    parseForwardedValue(headers.get("x-forwarded-proto")) || "https:";
  const forwardedHost =
    parseForwardedValue(headers.get("x-forwarded-host")) ||
    parseForwardedValue(headers.get("host"));
  return resolveApiOrigin(forwardedProto, forwardedHost);
}

export function toApiRuntimePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.startsWith("/api/") ? normalized : `/api${normalized}`;
}

export function toAbsoluteApiUrl(apiOrigin: string, path: string): string {
  const origin = apiOrigin.replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalized}`;
}

export type DiscoveryUrls = {
  html: string;
  json: string;
  text: string;
  llms: string;
  skills: string;
  openapi: string;
  agentRegistryMetadata: string;
};

export function buildDiscoveryUrls(apiOrigin: string): DiscoveryUrls {
  return {
    html: toAbsoluteApiUrl(apiOrigin, "/api"),
    json: toAbsoluteApiUrl(apiOrigin, "/endpoints.json"),
    text: toAbsoluteApiUrl(apiOrigin, "/endpoints.txt"),
    llms: toAbsoluteApiUrl(apiOrigin, "/llms.txt"),
    skills: toAbsoluteApiUrl(apiOrigin, "/dev-skills.txt"),
    openapi: toAbsoluteApiUrl(apiOrigin, "/openapi.json"),
    agentRegistryMetadata: toAbsoluteApiUrl(
      apiOrigin,
      "/agent-registry/metadata.json",
    ),
  };
}
