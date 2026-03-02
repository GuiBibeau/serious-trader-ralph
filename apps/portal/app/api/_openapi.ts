import {
  type FieldSpec,
  X402_CATALOG_VERSION,
  X402_ENDPOINTS,
  X402_OVERVIEW,
  X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE,
  type X402EndpointSpec,
} from "./_catalog";
import {
  buildDiscoveryUrls,
  toAbsoluteApiUrl,
  toApiRuntimePath,
} from "./_discovery";

const PAYMENT_SIGNATURE_HEADER = "payment-signature";
const PAYMENT_REQUIRED_HEADER = "payment-required";
const PAYMENT_RESPONSE_HEADER = "payment-response";

function enumValuesFromType(type: string): string[] {
  const values = Array.from(type.matchAll(/"([^"]+)"/g)).map((match) =>
    match[1].trim(),
  );
  return Array.from(new Set(values.filter(Boolean)));
}

function fieldSchema(field: FieldSpec): Record<string, unknown> {
  const type = field.type.trim();
  const enums = enumValuesFromType(type);

  if (field.name === "requests") {
    return {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
      },
      description: field.description,
    };
  }

  if (enums.length > 0) {
    return {
      type: "string",
      enum: enums,
      description: field.description,
    };
  }

  if (type.includes("boolean")) {
    return {
      type: "boolean",
      description: field.description,
    };
  }

  if (type.includes("number")) {
    return {
      type: "number",
      description: field.description,
    };
  }

  if (type.endsWith("[]") || type.startsWith("Array<")) {
    return {
      type: "array",
      items: { type: "string" },
      description: field.description,
    };
  }

  return {
    type: "string",
    description: field.description,
  };
}

function requestSchema(endpoint: X402EndpointSpec): Record<string, unknown> {
  const allFields = [...endpoint.requiredFields, ...endpoint.optionalFields];
  const properties = Object.fromEntries(
    allFields.map((field) => [field.name, fieldSchema(field)]),
  );

  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: endpoint.requiredFields.map((field) => field.name),
  };
}

function hasRequestBody(endpoint: X402EndpointSpec): boolean {
  return (
    endpoint.requiredFields.length > 0 ||
    endpoint.optionalFields.length > 0 ||
    Object.keys(endpoint.requestExample).length > 0
  );
}

function x402Operation(endpoint: X402EndpointSpec): Record<string, unknown> {
  return {
    tags: ["x402"],
    operationId: `x402_${endpoint.id}`,
    summary: endpoint.summary,
    description: `${endpoint.summary} ${X402_OVERVIEW.scope}`,
    security: [{ paymentSignature: [] }],
    ...(hasRequestBody(endpoint)
      ? {
          requestBody: {
            required: endpoint.requiredFields.length > 0,
            content: {
              "application/json": {
                schema: requestSchema(endpoint),
                example: endpoint.requestExample,
              },
            },
          },
        }
      : {}),
    responses: {
      "200": {
        description: "Paid request accepted and completed.",
        headers: {
          [PAYMENT_RESPONSE_HEADER]: {
            description:
              "x402 settlement metadata for the successful paid request.",
            schema: { type: "string" },
          },
        },
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: true,
            },
            example: endpoint.responseExample,
          },
        },
      },
      "400": {
        description: "Invalid request payload.",
      },
      "402": {
        description: "Payment is required before this route can be accessed.",
        headers: {
          [PAYMENT_REQUIRED_HEADER]: {
            description: "x402 payment requirements for this route.",
            schema: { type: "string" },
          },
        },
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: true,
            },
            example: X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE,
          },
        },
      },
      "503": {
        description: "Route configuration or upstream dependency unavailable.",
      },
    },
  };
}

function x402Paths(): Record<string, unknown> {
  return Object.fromEntries(
    X402_ENDPOINTS.map((endpoint) => {
      const runtimePath = toApiRuntimePath(endpoint.path);
      return [runtimePath, { post: x402Operation(endpoint) }];
    }),
  );
}

export function buildOpenApiDocument(
  apiOrigin: string,
): Record<string, unknown> {
  const discovery = buildDiscoveryUrls(apiOrigin);

  return {
    openapi: "3.1.0",
    info: {
      title: "Trader Ralph Public API",
      version: X402_CATALOG_VERSION,
      summary:
        "Public API documentation for Trader Ralph discovery, registry, and x402 paid reads.",
      description:
        "Includes all public endpoints, including discovery docs, agent query, and x402 paid market/macro/perps intelligence reads.",
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    servers: [
      {
        url: apiOrigin,
      },
    ],
    tags: [
      {
        name: "system",
        description: "Health and service utility endpoints.",
      },
      {
        name: "discovery",
        description: "Machine-readable discovery and catalog resources.",
      },
      {
        name: "agent-registry",
        description: "Agent Registry metadata and query endpoints.",
      },
      {
        name: "x402",
        description:
          "Paid x402 read endpoints requiring the payment-signature header.",
      },
    ],
    components: {
      securitySchemes: {
        paymentSignature: {
          type: "apiKey",
          in: "header",
          name: PAYMENT_SIGNATURE_HEADER,
          description:
            "On-chain Solana transaction signature proving payment for x402 routes.",
        },
      },
      schemas: {
        AgentQueryResponse: {
          type: "object",
          required: [
            "ok",
            "query",
            "answer",
            "suggestedEndpoints",
            "discovery",
          ],
          properties: {
            ok: { type: "boolean" },
            query: { type: "string" },
            answer: { type: "string" },
            suggestedEndpoints: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "path", "runtimePath", "url", "reason"],
                properties: {
                  id: { type: "string" },
                  path: { type: "string" },
                  runtimePath: { type: "string" },
                  url: { type: "string" },
                  reason: { type: "string" },
                },
              },
            },
            discovery: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
      },
    },
    paths: {
      "/api/health": {
        get: {
          tags: ["system"],
          operationId: "health",
          summary: "Service health check.",
          responses: {
            "200": {
              description: "Service is healthy.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                  example: { ok: true },
                },
              },
            },
          },
        },
      },
      "/api/agent/query": {
        get: {
          tags: ["agent-registry"],
          operationId: "agentQueryGet",
          summary: "Lightweight public query endpoint for registry testing.",
          parameters: [
            {
              name: "q",
              in: "query",
              required: false,
              schema: { type: "string", maxLength: 512 },
            },
          ],
          responses: {
            "200": {
              description: "Deterministic query response.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AgentQueryResponse",
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["agent-registry"],
          operationId: "agentQueryPost",
          summary: "Lightweight public query endpoint for registry testing.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query: { type: "string", maxLength: 512 },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deterministic query response.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AgentQueryResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryHtml",
          summary: "Human-readable x402 API catalog page.",
          responses: {
            "200": {
              description: "HTML catalog.",
              content: {
                "text/html": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/endpoints.json": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryJson",
          summary: "Machine-readable x402 endpoint catalog.",
          responses: {
            "200": {
              description: "JSON catalog document.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      "/endpoints.txt": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryText",
          summary: "Plain-text x402 endpoint catalog.",
          responses: {
            "200": {
              description: "Text catalog document.",
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/llms.txt": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryLlms",
          summary: "LLM discovery index.",
          responses: {
            "200": {
              description: "LLM discovery text.",
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/dev-skills.txt": {
        get: {
          tags: ["discovery"],
          operationId: "discoverySkills",
          summary: "Developer skills pack for API ingestion.",
          responses: {
            "200": {
              description: "Skills pack document.",
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/api/dev-skills.txt": {
        get: {
          tags: ["discovery"],
          operationId: "discoverySkillsAlias",
          summary: "Alias for /dev-skills.txt.",
          responses: {
            "200": {
              description: "Skills pack document.",
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryOpenapi",
          summary: "OpenAPI specification for public routes.",
          responses: {
            "200": {
              description: "OpenAPI document.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      "/agent-registry/metadata.json": {
        get: {
          tags: ["agent-registry"],
          operationId: "agentRegistryMetadata",
          summary: "Lane-specific Agent Registry metadata document.",
          responses: {
            "200": {
              description: "Agent metadata payload.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      "/api/endpoints.json": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryJsonAlias",
          summary: "Alias for /endpoints.json.",
          responses: {
            "200": {
              description: "JSON catalog document.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      "/api/endpoints.txt": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryTextAlias",
          summary: "Alias for /endpoints.txt.",
          responses: {
            "200": {
              description: "Text catalog document.",
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/api/llms.txt": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryLlmsAlias",
          summary: "Alias for /llms.txt.",
          responses: {
            "200": {
              description: "LLM discovery text.",
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/api/openapi.json": {
        get: {
          tags: ["discovery"],
          operationId: "discoveryOpenapiAlias",
          summary: "Alias for /openapi.json.",
          responses: {
            "200": {
              description: "OpenAPI document.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      "/api/agent-registry/metadata.json": {
        get: {
          tags: ["agent-registry"],
          operationId: "agentRegistryMetadataAlias",
          summary: "Alias for /agent-registry/metadata.json.",
          responses: {
            "200": {
              description: "Agent metadata payload.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      ...x402Paths(),
    },
    externalDocs: {
      description: "Trader Ralph discovery links",
      url: discovery.json,
    },
    "x-trader-ralph": {
      discovery,
      queryEndpoint: toAbsoluteApiUrl(apiOrigin, "/api/agent/query"),
      x402BaseUrl: toAbsoluteApiUrl(apiOrigin, toApiRuntimePath("/x402/read")),
      paymentHeaders: {
        request: PAYMENT_SIGNATURE_HEADER,
        required: PAYMENT_REQUIRED_HEADER,
        response: PAYMENT_RESPONSE_HEADER,
      },
    },
  };
}
