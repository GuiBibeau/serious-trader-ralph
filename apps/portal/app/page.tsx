"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "./lib";
import { FadeUp, PillPop, StaggerChildren, StaggerItem } from "./motion";

export default function Home() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace("/app");
  }, [ready, authenticated, router]);

  return (
    <main>
      <header className="pt-[clamp(3.5rem,10vw,7rem)] pb-[clamp(3rem,8vw,6rem)]">
        <div className="w-[min(1120px,92vw)] mx-auto grid gap-10 grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-end">
          <FadeUp>
            <p className="text-sm font-medium text-muted">Agentic edge fund</p>
            <h1>Autonomous trading with hedge fund discipline.</h1>
            <p className="text-muted mt-5 max-w-[560px]">
              Serious Trader Ralph is an agentic edge fund system that observes
              markets, decides with policy-driven risk control, and executes
              on-chain without hesitation. Built to stay focused, deliberate,
              and always on.
            </p>
            <div className="flex flex-wrap gap-4 mt-8">
              <a className={BTN_PRIMARY} href="#contact">
                Request access
              </a>
              <a className={BTN_SECONDARY} href="#thesis">
                Read the thesis
              </a>
            </div>
            <form
              className="grid gap-2.5 mt-6 max-w-[420px]"
              method="post"
              action="/api/waitlist"
            >
              <label htmlFor="waitlist-email" className="label">
                Join the waitlist
              </label>
              <div className="grid gap-3 grid-cols-[1fr_auto] max-sm:grid-cols-1">
                <input
                  id="waitlist-email"
                  name="email"
                  type="email"
                  required
                  placeholder="you@fund.com"
                  className="input"
                />
                <button className={BTN_SECONDARY} type="submit">
                  Join
                </button>
              </div>
              <span className="text-muted">
                Early access to the agentic edge fund.
              </span>
            </form>
            <div className="flex flex-wrap gap-2.5 mt-6">
              <PillPop>
                <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-border text-xs font-medium text-muted bg-surface">
                  Autonomous
                </span>
              </PillPop>
              <PillPop>
                <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-border text-xs font-medium text-muted bg-surface">
                  On-Chain
                </span>
              </PillPop>
              <PillPop>
                <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-border text-xs font-medium text-muted bg-surface">
                  Policy-Bound
                </span>
              </PillPop>
            </div>
          </FadeUp>
          <FadeUp delay={0.2}>
            <div className="card p-8">
              <h3 className="text-[1.2rem] mb-3 font-semibold">Fund profile</h3>
              <p className="text-muted">
                Ralph is designed as a compact hedge fund engine focused on
                on-chain markets. It prioritizes discipline, continuous
                attention, and fast execution.
              </p>
              <div className="mt-6 grid gap-6 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                <div>
                  <p className="label">Mandate</p>
                  <p>Agentic edge fund</p>
                </div>
                <div>
                  <p className="label">Execution</p>
                  <p>Spot, perps, prediction markets</p>
                </div>
                <div>
                  <p className="label">Governance</p>
                  <p>Human override, strict guardrails</p>
                </div>
              </div>
            </div>
          </FadeUp>
        </div>
      </header>

      <section
        className="py-[clamp(3rem,6vw,6rem)] border-t border-border"
        id="thesis"
      >
        <div className="w-[min(1120px,92vw)] mx-auto">
          <FadeUp>
            <h2>A hedge fund mind, an agentic body.</h2>
          </FadeUp>
          <p className="text-muted mt-4 max-w-[680px]">
            The thesis is simple: markets move fast, and a hedge fund needs
            relentless attention. Ralph stays active, researches constantly, and
            executes when the signal is clear—without drama, without noise.
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
                <h3>Simple thesis.</h3>
                <p className="text-muted">
                  No overfit complexity. Clear signals, clean execution, and a
                  narrow focus on edge.
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
                <h3>Observe → Decide → Execute.</h3>
                <p className="text-muted">
                  Ralph follows a tight loop that mirrors a hedge fund
                  desk—monitor, propose, validate, and act.
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card card-flat p-6">
                <p className="label mb-2">Trade surfaces</p>
                <h3>On-chain breadth.</h3>
                <p className="text-muted">
                  Focused on the edges that matter, with the flexibility to
                  access spot swaps, perps, and prediction markets when signals
                  appear.
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card card-flat p-6">
                <p className="label mb-2">Control</p>
                <h3>Guardrails built in.</h3>
                <p className="text-muted">
                  Policies define exposure, slippage, and execution
                  boundaries—no surprises, no improvisation.
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
            <h2>How it shows up.</h2>
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
                    The agent stays busy with focused research, scanning for
                    asymmetric opportunities and avoiding noise.
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
                  <h3>Signal discipline</h3>
                  <p className="text-muted">
                    Trades happen only when the signal is clear and the risk
                    budget allows it.
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
                  <h3>Autonomous execution</h3>
                  <p className="text-muted">
                    On-chain actions are executed swiftly, then monitored for
                    follow-through or exit.
                  </p>
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
                We are assembling a focused group of partners who want an
                agentic edge fund system that executes on-chain with discipline.
              </p>
              <div className="flex flex-wrap gap-4">
                <a className={BTN_PRIMARY} href="mailto:hello@ralph.fund">
                  Start a conversation
                </a>
              </div>
              <p className="text-muted mt-3">Not investment advice.</p>
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
