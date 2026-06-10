import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const webhook = env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhook) return new Response(null, { status: 204 });
  const body = await event.request.text();
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return new Response(null, { status: response.ok ? 204 : response.status });
};
