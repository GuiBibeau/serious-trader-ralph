"use client";

import { useEffect } from "react";

type RuntimeWindow = Window & {
  __TRADER_RALPH_EDGE_API_BASE__?: string;
};

const CLIENT_EDGE_API_BASE = String(process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "")
  .trim()
  .replace(/\/+$/, "");

export function EdgeApiRuntimeBridge() {
  useEffect(() => {
    if (!CLIENT_EDGE_API_BASE || typeof window === "undefined") return;
    (window as RuntimeWindow).__TRADER_RALPH_EDGE_API_BASE__ =
      CLIENT_EDGE_API_BASE;
  }, []);

  return null;
}
