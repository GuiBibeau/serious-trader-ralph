import type { Metadata } from "next";
import {
  X402_CATALOG_VERSION,
  X402_ENDPOINTS,
  X402_OVERVIEW,
  X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE,
  X402_SUPPORTED_TRADING,
} from "./_catalog";

export const metadata: Metadata = {
  title: "API Catalog | Trader Ralph",
  description:
    "Public x402 endpoint catalog for Trader Ralph market and macro reads.",
};

function renderFieldList(
  title: string,
  fields: Array<{ name: string; type: string; description: string }>,
) {
  if (fields.length < 1) {
    return (
      <p className="text-xs text-muted">
        {title}: <code>none</code>
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted mb-1.5">{title}:</p>
      <ul className="space-y-1 text-xs">
        {fields.map((field) => (
          <li key={field.name}>
            <code>{field.name}</code> (<code>{field.type}</code>) -{" "}
            {field.description}
          </li>
        ))}
      </ul>
    </div>
  );
}

function hasFields(record: Record<string, unknown>): boolean {
  return Object.keys(record).length > 0;
}

export default function ApiCatalogPage() {
  return (
    <main>
      <section className="py-[clamp(3rem,6vw,6rem)] border-t border-border">
        <div className="w-[min(1120px,92vw)] mx-auto space-y-6">
          <div className="card p-6">
            <p className="label">Public API Catalog</p>
            <h1 className="mt-2.5">x402 Read Endpoints</h1>
            <p className="text-muted mt-3 max-w-3xl">{X402_OVERVIEW.scope}</p>
            <p className="text-xs text-muted mt-3">
              Catalog version: <code>{X402_CATALOG_VERSION}</code>
            </p>
            <p className="text-xs text-muted mt-2">
              Supported trading pairs:{" "}
              <code>
                {X402_SUPPORTED_TRADING.pairs.map((pair) => pair.id).join(", ")}
              </code>
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <a
                className="underline hover:text-accent"
                href="/api/endpoints.json"
              >
                /api/endpoints.json
              </a>
              <a
                className="underline hover:text-accent"
                href="/api/endpoints.txt"
              >
                /api/endpoints.txt
              </a>
              <a className="underline hover:text-accent" href="/llms.txt">
                /llms.txt
              </a>
            </div>
          </div>

          <div className="card p-6">
            <p className="label">How x402 Works</p>
            <ol className="mt-3 space-y-2 text-sm">
              <li>
                1. Request an endpoint under <code>/api/x402/read/*</code>.
              </li>
              <li>
                2. If payment is missing, you get <code>402</code> with{" "}
                <code>payment-required</code>.
              </li>
              <li>
                3. Pay using those requirements, then retry with{" "}
                <code>payment-signature</code>.
              </li>
              <li>
                4. Successful responses include <code>payment-response</code>.
              </li>
            </ol>
            <div className="mt-4 text-sm space-y-1.5">
              <p>
                Request header: <code>payment-signature</code>
              </p>
              <p>
                Response headers: <code>payment-required</code>,{" "}
                <code>payment-response</code>
              </p>
            </div>
            <p className="text-xs text-muted mt-4">
              Route pricing should always be read from the{" "}
              <code>payment-required</code> header payload.
            </p>
            <div className="mt-4">
              <p className="text-xs text-muted mb-1.5">
                Example unpaid response body:
              </p>
              <pre className="overflow-x-auto rounded-md border border-border bg-subtle p-3 text-xs">
                {JSON.stringify(
                  X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE,
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>

          <div className="space-y-4">
            {X402_ENDPOINTS.map((endpoint) => (
              <article key={endpoint.id} className="card p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <code>
                    {endpoint.method} {endpoint.path}
                  </code>
                  <span className="text-[11px] rounded-full border border-border px-2 py-0.5 text-muted">
                    {endpoint.access}
                  </span>
                </div>
                <p className="text-sm text-muted mt-2">{endpoint.summary}</p>
                <div className="mt-4 space-y-3">
                  {renderFieldList("Required", endpoint.requiredFields)}
                  {renderFieldList("Optional", endpoint.optionalFields)}
                </div>
                <div className="mt-4">
                  <p className="text-xs text-muted mb-1.5">
                    Example request body:
                  </p>
                  {hasFields(endpoint.requestExample) ? (
                    <pre className="overflow-x-auto rounded-md border border-border bg-subtle p-3 text-xs">
                      {JSON.stringify(endpoint.requestExample, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted">
                      No request body required.
                    </p>
                  )}
                </div>
                <div className="mt-4">
                  <p className="text-xs text-muted mb-1.5">
                    Example success response body:
                  </p>
                  <pre className="overflow-x-auto rounded-md border border-border bg-subtle p-3 text-xs">
                    {JSON.stringify(endpoint.responseExample, null, 2)}
                  </pre>
                </div>
              </article>
            ))}
          </div>

          <div className="card p-6">
            <p className="label">Notes</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {X402_OVERVIEW.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
