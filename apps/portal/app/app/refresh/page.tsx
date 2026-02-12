"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

function RefreshInner() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tried = useRef(false);

  useEffect(() => {
    if (!ready || tried.current) return;
    tried.current = true;
    const redirect = searchParams.get("redirect") || "/app";

    if (!authenticated) {
      router.replace("/");
      return;
    }

    getAccessToken()
      .then((token) => router.replace(token ? redirect : "/"))
      .catch(() => router.replace("/"));
  }, [ready, authenticated, getAccessToken, router, searchParams]);

  return <h1>Resuming session…</h1>;
}

export default function RefreshPage() {
  return (
    <main>
      <div className="w-[min(1120px,92vw)] mx-auto py-20">
        <Suspense fallback={<h1>Resuming session…</h1>}>
          <RefreshInner />
        </Suspense>
      </div>
    </main>
  );
}
