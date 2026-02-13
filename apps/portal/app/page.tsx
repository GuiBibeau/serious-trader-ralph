"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "./lib";
import { FadeUp, StaggerChildren, StaggerItem } from "./motion";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default function Home() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);

  const canSubmitWaitlist = useMemo(
    () => waitlistEmail.trim().length > 0 && !waitlistBusy,
    [waitlistBusy, waitlistEmail],
  );

  const handleWaitlistSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = waitlistEmail.trim();
      if (!email || waitlistBusy) return;

      setWaitlistBusy(true);
      setWaitlistError(null);
      setWaitlistSuccess(false);

      try {
        const response = await fetch("/api/waitlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });

        const text = await response.text();
        const payload =
          text.trim() !== "" &&
          response.headers.get("content-type")?.includes("json")
            ? (() => {
                try {
                  return JSON.parse(text);
                } catch {
                  return {};
                }
              })()
            : text;

        const upstreamError =
          !response.ok || (isRecord(payload) && payload.ok === false)
            ? isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : text || "Could not join waitlist"
            : null;

        if (upstreamError) {
          throw new Error(upstreamError);
        }

        setWaitlistSuccess(true);
        setWaitlistEmail("");
      } catch (error) {
        const nextError =
          error instanceof Error
            ? error.message
            : "Could not join waitlist. Please try again.";
        setWaitlistError(nextError);
      } finally {
        setWaitlistBusy(false);
      }
    },
    [waitlistBusy, waitlistEmail],
  );

  useEffect(() => {
    if (ready && authenticated) router.replace("/app");
  }, [ready, authenticated, router]);

  return (
    <main>
      <header className="pt-[clamp(3.5rem,10vw,7rem)] pb-[clamp(3rem,8vw,6rem)]">
        <div className="w-[min(1120px,92vw)] mx-auto">
          <FadeUp>
            <p className="text-xs font-semibold tracking-[0.25em] uppercase text-muted">
              Agentic Edge Fund
            </p>
            <h1 className="max-w-[680px]">
              Build a policy-bound trading fund, not a black-box bot.
            </h1>
            <p className="text-muted mt-5 max-w-[560px]">
              Ralph is a trading operations layer for the fund model:
              autonomous strategy desks, strict guardrails, and explainable
              decisioning.
            </p>
            <form
              className="grid gap-2.5 mt-6 max-w-[420px]"
              onSubmit={handleWaitlistSubmit}
            >
              <label htmlFor="waitlist-email" className="label">
                Early-access updates
              </label>
              <div className="grid gap-3 grid-cols-[1fr_auto] max-sm:grid-cols-1">
                <input
                  id="waitlist-email"
                  name="email"
                  type="email"
                  value={waitlistEmail}
                  required
                  autoComplete="email"
                  onChange={(event) => setWaitlistEmail(event.target.value)}
                  placeholder="you@fund.com"
                  className="input"
                />
                <button
                  className={BTN_PRIMARY}
                  type="submit"
                  disabled={!canSubmitWaitlist}
                >
                  {waitlistBusy ? "Joining..." : "Get notified"}
                </button>
              </div>
              {waitlistSuccess && (
                <output className="text-xs text-emerald-500" aria-live="polite">
                  Thanks — you are on the list.
                </output>
              )}
              {waitlistError && (
                <p className="text-xs" role="alert" aria-live="assertive">
                  {waitlistError}
                </p>
              )}
              <span className="text-muted">
                Early access to fund updates, strategy drops, and tooling
                releases.
              </span>
            </form>
            <p className="text-xs text-muted mt-4">
              Not investment advice. You control risk and policy.
            </p>
          </FadeUp>
        </div>
      </header>

      <section
        className="py-[clamp(3rem,6vw,6rem)] border-t border-border"
        id="thesis"
      >
        <div className="w-[min(1120px,92vw)] mx-auto">
          <FadeUp>
            <h2>Built like a fund with autonomous strategy desks.</h2>
          </FadeUp>
          <p className="text-muted mt-4 max-w-[680px]">
            The operating thesis is fund-first: run multiple strategies with
            clear mandates, shared risk rails, and always-on execution. Trading
            bots are outputs of the fund process, not the product itself.
          </p>
          <StaggerChildren className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] mt-8">
            <StaggerItem>
              <div className="card card-flat p-6">
                <p className="label mb-2">Discipline</p>
                <h3>Risk first.</h3>
                <p className="text-muted">
                  Every action is filtered by policy. Position sizing, exposure,
                  and trade selection are always bounded.
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card card-flat p-6">
                <p className="label mb-2">Autonomy</p>
                <h3>Always on.</h3>
                <p className="text-muted">
                  The agent watches, evaluates, and acts on-chain in real
                  time—day or night.
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card card-flat p-6">
                <p className="label mb-2">Clarity</p>
                <h3>Desk-level structure.</h3>
                <p className="text-muted">
                  Strategies are grouped into operating desks with explicit
                  objectives, risk budgets, and execution responsibilities.
                </p>
              </div>
            </StaggerItem>
          </StaggerChildren>
        </div>
      </section>

      <section className="py-[clamp(3rem,6vw,6rem)] border-t border-border">
        <div className="w-[min(1120px,92vw)] mx-auto">
          <StaggerChildren className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <StaggerItem>
              <div className="card card-flat p-6">
                <p className="label mb-2">Agentic loop</p>
                <h3>Research → Allocate → Execute.</h3>
                <p className="text-muted">
                  Ralph follows a fund loop: monitor markets, allocate capital
                  by strategy mandate, and execute through policy gates.
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card card-flat p-6">
                <p className="label mb-2">Trade surfaces</p>
                <h3>On-chain breadth.</h3>
                <p className="text-muted">
                  Each strategy desk can route into spot, perps, and prediction
                  markets when edge and mandate align.
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card card-flat p-6">
                <p className="label mb-2">Control</p>
                <h3>Guardrails built in.</h3>
                <p className="text-muted">
                  Policies define exposure, slippage, and execution boundaries
                  across desks and shared capital pools.
                </p>
              </div>
            </StaggerItem>
          </StaggerChildren>
          <StaggerChildren className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(180px,1fr))] mt-8">
            <StaggerItem>
              <div className="card card-flat p-5">
                <strong className="text-[1.6rem] block">24/7</strong>
                <span className="text-muted">Market attention</span>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card card-flat p-5">
                <strong className="text-[1.6rem] block">On-chain</strong>
                <span className="text-muted">Execution by design</span>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card card-flat p-5">
                <strong className="text-[1.6rem] block">Policy</strong>
                <span className="text-muted">Bound autonomy</span>
              </div>
            </StaggerItem>
          </StaggerChildren>
        </div>
      </section>

      <section className="py-[clamp(3rem,6vw,6rem)] border-t border-border">
        <div className="w-[min(1120px,92vw)] mx-auto">
          <FadeUp>
            <h2>Private fund operations, public strategy tooling.</h2>
          </FadeUp>
          <StaggerChildren className="grid gap-5 mt-7">
            <StaggerItem>
              <div className="grid gap-3 grid-cols-[auto_1fr] items-start">
                <span
                  className="w-2.5 h-2.5 rounded-full bg-accent mt-2"
                  aria-hidden="true"
                />
                <div>
                  <h3>Relentless research</h3>
                  <p className="text-muted">
                    The fund runs continuous research and signal development
                    across strategy desks.
                  </p>
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="grid gap-3 grid-cols-[auto_1fr] items-start">
                <span
                  className="w-2.5 h-2.5 rounded-full bg-accent mt-2"
                  aria-hidden="true"
                />
                <div>
                  <h3>Open strategy releases</h3>
                  <p className="text-muted">
                    While the fund remains private, strategy frameworks and
                    tooling are released publicly under license.
                  </p>
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="grid gap-3 grid-cols-[auto_1fr] items-start">
                <span
                  className="w-2.5 h-2.5 rounded-full bg-accent mt-2"
                  aria-hidden="true"
                />
                <div>
                  <h3>License-backed access</h3>
                  <p className="text-muted">
                    License fees fund continued tooling releases, operations,
                    and infrastructure for the community.
                  </p>
                </div>
              </div>
            </StaggerItem>
          </StaggerChildren>
        </div>
      </section>

      <section
        className="py-[clamp(3rem,6vw,6rem)] border-t border-border"
        id="pricing"
      >
        <div className="w-[min(1120px,92vw)] mx-auto">
          <FadeUp className="text-center max-w-[760px] mx-auto">
            <p className="label">Pricing</p>
            <h2 className="mt-2">
              Find a license to access fund strategy tooling.
            </h2>
            <p className="text-muted mt-4">
              The fund is private. Strategy and tooling releases are public
              through annual licenses, billed on Solana.
            </p>
          </FadeUp>
          <StaggerChildren
            className="mt-9 rounded-2xl border border-border overflow-hidden bg-surface grid lg:grid-cols-3"
            stagger={0.07}
          >
            <StaggerItem>
              <div className="p-7 md:p-8 h-full border-b border-border lg:border-b-0 flex flex-col">
                <p className="label">BYOK</p>
                <h3 className="mt-2">BYOK Annual</h3>
                <p className="text-muted mt-3">
                  Full edge fund access with autonomous execution; you pay your
                  own inference.
                </p>
                <p className="mt-4 text-[2rem] font-semibold tracking-tight">
                  $99
                  <span className="text-base font-medium text-muted">
                    /year
                  </span>
                </p>
                <ul className="mt-5 grid gap-2 text-sm text-muted">
                  <li>1-year license</li>
                  <li>Full edge fund feature access</li>
                  <li>Autonomous execution enabled</li>
                  <li>Bring your own model/API keys</li>
                  <li>Inference billed to your own providers</li>
                </ul>
                <div className="mt-auto pt-7">
                  <Link
                    href="/checkout?plan=byok_annual&asset=USDC&pay=1"
                    className={`${BTN_SECONDARY} w-full`}
                  >
                    Select BYOK
                  </Link>
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="relative p-7 md:p-8 h-full border-y border-border lg:border-y-0 lg:border-x flex flex-col">
                <p className="label">Hobbyist</p>
                <h3 className="mt-2">Hobbyist Annual</h3>
                <p className="text-muted mt-3">
                  Full edge fund access with managed inference included.
                </p>
                <p className="mt-4 text-[2rem] font-semibold tracking-tight">
                  $790
                  <span className="text-base font-medium text-muted">
                    /year
                  </span>
                </p>
                <ul className="mt-5 grid gap-2 text-sm text-muted">
                  <li>1-year license</li>
                  <li>Full edge fund feature access</li>
                  <li>Autonomous execution enabled</li>
                  <li>AI LLM inference cost included</li>
                  <li>Managed execution routing</li>
                </ul>
                <div className="mt-auto pt-7">
                  <Link
                    href="/checkout?plan=hobbyist_annual&asset=USDC&pay=1"
                    className={`${BTN_PRIMARY} w-full`}
                  >
                    Select Hobbyist
                  </Link>
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="p-7 md:p-8 h-full flex flex-col">
                <p className="label">Fund</p>
                <h3 className="mt-2">Fund Access</h3>
                <p className="text-muted mt-3">
                  Express interest in participating directly in the private fund
                  with quant and HFT-grade infrastructure.
                </p>
                <p className="mt-4 text-[2rem] font-semibold tracking-tight">
                  Contact
                </p>
                <ul className="mt-5 grid gap-2 text-sm text-muted">
                  <li>Quant and HFT-level strategy infrastructure</li>
                  <li>Low-latency execution and risk stack</li>
                  <li>Interest intake and qualification review</li>
                  <li>Direct conversation with the fund team</li>
                </ul>
                <div className="mt-auto pt-7">
                  <a
                    href="mailto:hello@ralph.fund?subject=Fund%20Interest"
                    className={`${BTN_SECONDARY} w-full`}
                  >
                    Express interest
                  </a>
                </div>
              </div>
            </StaggerItem>
          </StaggerChildren>
        </div>
      </section>

      <section
        className="py-[clamp(3rem,6vw,6rem)] border-t border-border"
        id="contact"
      >
        <div className="w-[min(1120px,92vw)] mx-auto">
          <FadeUp>
            <div className="card p-8 grid gap-5">
              <h2>Build with Ralph.</h2>
              <p className="text-muted">
                We are assembling a focused group of partners who want a
                fund-first, strategy-desk platform with disciplined autonomous
                execution.
              </p>
              <div className="flex flex-wrap gap-4">
                <a className={BTN_PRIMARY} href="mailto:hello@ralph.fund">
                  Start a conversation
                </a>
              </div>
            </div>
          </FadeUp>
        </div>
      </section>

      <footer className="py-8 pb-12 border-t border-border text-[0.85rem]">
        <div className="w-[min(1120px,92vw)] mx-auto">
          <p className="text-muted">
            Serious Trader Ralph — agentic edge fund system.
          </p>
        </div>
      </footer>
    </main>
  );
}
