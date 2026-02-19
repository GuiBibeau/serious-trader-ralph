"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "../lib";

export default function LoginPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace("/app");
  }, [ready, authenticated, router]);

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

  return (
    <main>
      <section className="py-[clamp(3rem,6vw,6rem)]">
        <div className="w-[min(720px,92vw)] mx-auto">
          <div className="card p-6">
            <p className="label">Access</p>
            <h1 className="mt-2.5">Sign in to Ralph</h1>
            <p className="text-muted mt-3 max-w-[540px]">
              Access is granted through manual onboarding. Sign in if your
              account has already been approved.
            </p>
            <p className="text-muted mt-2 text-[0.92rem] max-w-[540px]">
              Need access? Email{" "}
              <a className="underline" href="mailto:hello@ralph.fund">
                hello@ralph.fund
              </a>{" "}
              with your team details.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <button
                className={BTN_PRIMARY}
                onClick={() => login()}
                disabled={!ready}
                type="button"
              >
                {ready ? "Sign in" : "Loading..."}
              </button>
              <a className={BTN_SECONDARY} href="/">
                Back to landing
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
