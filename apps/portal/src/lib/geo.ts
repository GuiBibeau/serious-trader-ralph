// Geo capacity (PRD #493): country/region resolved from Vercel's edge
// headers, recorded to telemetry, surfaced in no UI. Consumers (the
// feature-gate layer, later) read `geo` — a session-scoped store.

import { writable } from "svelte/store";
import { track } from "$lib/telemetry";

export type Geo = {
  country: string | null;
  region: string | null;
  resolved: boolean;
};

/** Pure parser — testable without a request. */
export function parseGeoHeaders(headers: Headers): Omit<Geo, "resolved"> {
  const country = headers.get("x-vercel-ip-country");
  const region = headers.get("x-vercel-ip-country-region");
  return {
    country: country && country.length === 2 ? country.toUpperCase() : null,
    region: region && region.length > 0 ? region.toUpperCase() : null,
  };
}

export const geo = writable<Geo>({
  country: null,
  region: null,
  resolved: false,
});

let started = false;

/** Fetch once per session; safe to call repeatedly. */
export function initGeo(fetcher: typeof fetch = fetch): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void fetcher("/api/geo")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { country: string | null; region: string | null } | null) => {
      if (!data) return;
      geo.set({ country: data.country, region: data.region, resolved: true });
      track("geo_resolved", {
        country: data.country ?? "unknown",
        region: data.region ?? "unknown",
      });
    })
    .catch(() => {
      /* geo is best-effort capacity; failures stay silent */
    });
}
