"use client";

import { BTN_PRIMARY, BTN_SECONDARY } from "../lib";

export default function CheckoutPage() {
  return (
    <main>
      <section className="py-[clamp(3rem,6vw,6rem)]">
        <div className="w-[min(760px,92vw)] mx-auto">
          <div className="card p-6">
            <p className="label">Plans</p>
            <h1 className="mt-2.5">Checkout is coming soon</h1>
            <p className="text-muted mt-3 max-w-[560px]">
              Paid bundles and checkout will launch in a later phase.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <a className={BTN_PRIMARY} href="/terminal">
                Open terminal
              </a>
              <a className={BTN_SECONDARY} href="/login">
                Sign in
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
