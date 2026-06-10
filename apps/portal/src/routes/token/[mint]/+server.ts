// Canonical-by-mint entrypoint: /token/<mint> 301s to the slug spotlight.
// Lets integrators and explorers link by mint without knowing our slugs.

import { error, redirect } from "@sveltejs/kit";
import { findByMint } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params }) => {
  const asset = await findByMint(params.mint);
  if (!asset) error(404, "Unknown mint");
  // 307, not 301: slugs can be reassigned between catalog refreshes, and
  // browsers cache permanent redirects forever. The mint is the stable id —
  // clients should re-resolve it every time; the spotlight page's canonical
  // tag handles SEO.
  redirect(307, `/${asset.slug}`);
};
