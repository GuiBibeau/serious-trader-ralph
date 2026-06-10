import { error } from "@sveltejs/kit";
import { parsePositionParams } from "$lib/server/share";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const share = parsePositionParams(url.searchParams);
  if (!share) error(404, "Nothing to share");
  return { share, query: url.searchParams.toString() };
};
