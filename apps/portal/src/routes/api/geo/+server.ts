import { json } from "@sveltejs/kit";
import { parseGeoHeaders } from "$lib/geo";
import type { RequestHandler } from "./$types";

// Country/region from Vercel's edge geo headers (absent in local dev →
// nulls). Capacity only (PRD #493): recorded to telemetry, gates nothing.
export const GET: RequestHandler = ({ request }) => {
  return json(parseGeoHeaders(request.headers), {
    headers: { "cache-control": "no-store" },
  });
};
