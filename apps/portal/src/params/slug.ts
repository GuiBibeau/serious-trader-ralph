import { isAssetSlug } from "$lib/slugs";
import type { ParamMatcher } from "@sveltejs/kit";

export const match: ParamMatcher = (param) => isAssetSlug(param);
