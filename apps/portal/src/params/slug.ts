import type { ParamMatcher } from "@sveltejs/kit";
import { isAssetSlug } from "$lib/slugs";

export const match: ParamMatcher = (param) => isAssetSlug(param);
