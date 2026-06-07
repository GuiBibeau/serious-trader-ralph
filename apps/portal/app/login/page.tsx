"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "../lib";

function isSignInHostAllowed(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "dev.trader-ralph.com" ||
    normalized === "trader-ralph.com" ||
    normalized === "www.trader-ralph.com"
  );
}

export default function LoginPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  const [signInAllowed, setSignInAllowed] = useState<boolean | null>(null);
  const [loginError, setLoginError] = useState<"origin-not-allowed" | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSignInAllowed(isSignInHostAllowed(window.location.hostname));
  }, []);

  useEffect(() => {
    if (!ready || !authenticated || signInAllowed !== true) return;
    router.replace("/terminal");
  }, [ready, authenticated, signInAllowed, router]);

  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <main>
        <section className="py-[clamp(3rem,6vw,6rem)]">
          <div className="w-[min(720px,92vw)] mx-auto">
            <div className="card card-flat p-6">
              <p className="label">Config</p>
              <h1 className="mt-2.5">Missing Privy app id</h1>
              <p className="text-muted mt-3.5">
                Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in{" "}
                <code>apps/portal/.env.local</code>.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (signInAllowed === null) {
    return (
      <main>
        <section className="py-[clamp(3rem,6vw,6rem)]">
          <div className="w-[min(720px,92vw)] mx-auto">
            <div className="card p-6">
              <p className="label">Access</p>
              <h1 className="mt-2.5">Loading access policy</h1>
              <p className="text-muted mt-3 max-w-[540px]">
                Checking environment access controls.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (signInAllowed === false) {
    return (
      <main>
        <section className="py-[clamp(3rem,6vw,6rem)]">
          <div className="w-[min(720px,92vw)] mx-auto">
            <div className="card p-6">
              <p className="label">Access</p>
              <h1 className="mt-2.5">Sign in unavailable</h1>
              <p className="text-muted mt-3 max-w-[540px]">
                Sign in is currently available on dev and the production
                domains.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-6">
                <a className={BTN_SECONDARY} href="/terminal">
                  Terminal
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="py-[clamp(3rem,6vw,6rem)]">
        <div className="w-[min(720px,92vw)] mx-auto">
          <div className="card p-6">
            <p className="label">Access</p>
            <h1 className="mt-2.5">Sign in to Terminal</h1>
            <p className="text-muted mt-3 max-w-[540px]">
              Authenticate with email to access the Trader Ralph terminal.
            </p>
            {loginError === "origin-not-allowed" ? (
              <p className="text-sm text-amber-300 mt-3">
                This Privy app id does not allow the current origin. Add{" "}
                <code>http://localhost:3000</code> and{" "}
                <code>http://127.0.0.1:3000</code> to allowed origins in the
                Privy dashboard.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <button
                className={BTN_PRIMARY}
                onClick={async () => {
                  setLoginError(null);
                  try {
                    await login();
                  } catch (error) {
                    const message =
                      error instanceof Error
                        ? error.message
                        : String(error ?? "login-failed");
                    if (/origin not allowed/i.test(message)) {
                      setLoginError("origin-not-allowed");
                    }
                  }
                }}
                disabled={!ready}
                type="button"
              >
                {ready ? "Sign in" : "Loading..."}
              </button>
              <a className={BTN_SECONDARY} href="/terminal">
                Terminal
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
