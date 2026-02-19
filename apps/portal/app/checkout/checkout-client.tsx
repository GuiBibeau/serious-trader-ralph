"use client";

import { BTN_PRIMARY, BTN_SECONDARY } from "../lib";

export default function CheckoutPage() {
  return (
    <main>
      <section className="py-[clamp(3rem,6vw,6rem)]">
        <div className="w-[min(760px,92vw)] mx-auto">
          <div className="card p-6">
            <p className="label">Manual Access</p>
            <h1 className="mt-2.5">Checkout has been disabled</h1>
            <p className="text-muted mt-3 max-w-[560px]">
              We are handling onboarding manually. Pricing and licensing are set
              during onboarding calls, not through self-serve plans.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <a className={BTN_PRIMARY} href="mailto:hello@ralph.fund">
                Request access
              </a>
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
