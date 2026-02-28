"use client";

import type { SVGProps } from "react";
import { FadeUp, StaggerChildren, StaggerItem } from "./motion";

// ── Icons (Inline SVGs) ──────────────────────────────────────────────────────

type IconProps = SVGProps<SVGSVGElement>;

function IconArrowRight(props: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Arrow right icon</title>
      <path d="M3.33334 8H12.6667" />
      <path d="M8 3.33334L12.6667 8.00001L8 12.6667" />
    </svg>
  );
}

function IconCheck(props: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Check icon</title>
      <polyline points="20 6 9 17 4 12" />
      <path d="M3.5 8L6.5 11L13 4.5" />
    </svg>
  );
}

function IconZap(props: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Zap icon</title>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function _IconTerminal(props: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Terminal icon</title>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function IconActivity(props: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Activity icon</title>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconCpu(props: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>CPU icon</title>
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}

function IconLayers(props: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Layers icon</title>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconLock(props: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Lock icon</title>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function GridBackground() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden select-none pointer-events-none">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--color-subtle-strong),_transparent_70%)] opacity-40" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          opacity: 0.15,
        }}
      />
    </div>
  );
}

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-paper/80 backdrop-blur-md">
      <div className="w-[min(1120px,92vw)] mx-auto h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-6 bg-accent rounded-sm shadow-[0_0_10px_var(--color-accent)]" />
          <span className="text-sm font-bold tracking-wider uppercase">
            Trader Ralph
          </span>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-muted">
          <a href="#features" className="hover:text-ink transition-colors">
            Features
          </a>
          <a href="#how-it-works" className="hover:text-ink transition-colors">
            How it works
          </a>
          <a href="#roadmap" className="hover:text-ink transition-colors">
            Roadmap
          </a>
          <a href="/api" className="hover:text-ink transition-colors">
            API
          </a>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="/login"
            className="text-sm font-medium text-muted hover:text-ink transition-colors"
          >
            Sign in
          </a>
          <a
            href="mailto:hello@ralph.fund"
            className="hidden sm:flex items-center gap-2 px-4 py-1.5  text-sm font-medium bg-white text-black rounded-full hover:bg-gray-200 transition-colors"
          >
            Request Access
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative min-h-[90vh] flex flex-col justify-center pt-20 overflow-hidden">
      <GridBackground />
      <div className="w-[min(1120px,92vw)] mx-auto relative z-10">
        <FadeUp>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-semibold tracking-wide uppercase mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
            </span>
            Solana Intelligence Infrastructure
          </div>
          <h1 className="max-w-4xl text-5xl md:text-7xl font-bold tracking-tight text-ink mb-6">
            Agentic hedge fund <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-purple-500">
              + Consumable Signals
            </span>
          </h1>
          <p className="max-w-2xl text-lg md:text-xl text-muted leading-relaxed mb-8">
            Trader Ralph is building a Solana-first intelligence factory:
            automated internal loops plus external signal access through our
            terminal and x402 endpoints.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="mailto:hello@ralph.fund"
              className="h-12 px-8 inline-flex items-center justify-center rounded-full bg-accent text-white font-medium text-lg shadow-[0_0_20px_var(--color-accent-soft)] hover:shadow-[0_0_30px_var(--color-accent-soft)] hover:scale-105 transition-all duration-300"
            >
              Request Access <IconArrowRight className="ml-2 w-5 h-5" />
            </a>
            <a
              href="#features"
              className="h-12 px-8 inline-flex items-center justify-center rounded-full border border-border bg-surface/50 text-ink font-medium text-lg hover:bg-surface transition-colors"
            >
              What Is Live
            </a>
          </div>
        </FadeUp>
      </div>

      {/* Decorative gradient blur at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-paper to-transparent pointer-events-none" />
    </section>
  );
}

function BentoGrid() {
  return (
    <section id="features" className="py-24 relative">
      <div className="w-[min(1120px,92vw)] mx-auto">
        <FadeUp>
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            Built for internal operations. <br />
            <span className="text-muted">Exposed through terminal + APIs.</span>
          </h2>
        </FadeUp>

        <StaggerChildren className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[320px]">
          {/* Large Card 1: Signals */}
          <StaggerItem className="md:col-span-2 relative group overflow-hidden rounded-2xl border border-border bg-surface p-8 transition-all hover:border-accent/50">
            <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
              <IconActivity className="w-32 h-32 text-accent" />
            </div>
            <div className="relative z-10 h-full flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-6 text-accent">
                  <IconZap className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Signals Layer</h3>
                <p className="text-muted max-w-md">
                  SOL-focused market and macro signals are available through the
                  terminal and x402 reads. Coverage expands incrementally as new
                  feeds are validated.
                </p>
              </div>
              <div className="bg-paper/50 rounded-lg p-4 font-mono text-xs text-muted border border-border">
                <span className="text-green-400">root@ralph:~#</span>{" "}
                ./consume_signal --feed=solana
                <br />
                <span className="text-blue-400">[INFO]</span> market_snapshot_v2
                refreshed
                <br />
                <span className="text-blue-400">[INFO]</span>{" "}
                macro_stablecoin_health updated
                <br />
                <span className="text-green-400">[SUCCESS]</span> Signal
                published to terminal + x402 cache
              </div>
            </div>
          </StaggerItem>

          {/* Small Card 1: Liquidity */}
          <StaggerItem className="relative group overflow-hidden rounded-2xl border border-border bg-surface p-8 transition-all hover:border-accent/50">
            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-6 text-blue-500">
              <IconLayers className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Swap Routing</h3>
            <p className="text-sm text-muted">
              SOL/USDC swaps route through supported Solana liquidity via
              Jupiter. The user signs through the Privy wallet flow.
            </p>
          </StaggerItem>

          {/* Small Card 2: Perps */}
          <StaggerItem className="relative group overflow-hidden rounded-2xl border border-border bg-surface p-8 transition-all hover:border-accent/50">
            <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-6 text-purple-500">
              <IconLock className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Execution Scope</h3>
            <p className="text-sm text-muted">
              Current terminal trading scope is spot SOL/USDC. Additional
              markets and derivatives are planned after core loop reliability.
            </p>
          </StaggerItem>

          {/* Large Card 2: Execution */}
          <StaggerItem className="md:col-span-2 relative group overflow-hidden rounded-2xl border border-border bg-surface p-8 transition-all hover:border-accent/50">
            <div className="absolute bottom-0 right-0 w-1/2 h-full bg-gradient-to-l from-paper to-transparent opacity-50"></div>
            <div className="relative z-10 h-full flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-6 text-emerald-500">
                  <IconCpu className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Execution Layer</h3>
                <p className="text-muted max-w-md">
                  Execution is server-side with policy checks, Privy signing,
                  and RPC submission. Built for deterministic behavior and
                  operational safety.
                </p>
              </div>
              <div className="flex items-center gap-4 mt-8">
                <div className="flex-1 bg-paper h-2 rounded-full overflow-hidden">
                  <div className="w-[70%] h-full bg-emerald-500 rounded-full"></div>
                </div>
                <span className="font-mono text-xs text-emerald-400">
                  Correctness first
                </span>
              </div>
            </div>
          </StaggerItem>
        </StaggerChildren>
      </div>
    </section>
  );
}

function AccessModel() {
  const steps = [
    {
      title: "Signal Request",
      desc: "Your terminal or agent calls an x402 read endpoint.",
    },
    {
      title: "HTTP 402",
      desc: "Server responds with payment requirements for the requested resource.",
    },
    {
      title: "Delivery",
      desc: "After payment verification, the response is returned and cached.",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 border-t border-border/50">
      <div className="w-[min(1120px,92vw)] mx-auto">
        <FadeUp>
          <div className="mb-16 text-center">
            <span className="text-accent font-mono text-sm tracking-wider uppercase">
              The x402 Standard
            </span>
            <h2 className="text-3xl font-bold mt-2">Pay-per-request access.</h2>
            <p className="text-muted mt-2 max-w-lg mx-auto">
              We use the{" "}
              <a
                href="https://x402.org"
                target="_blank"
                className="underline hover:text-accent"
                rel="noopener"
              >
                x402 standard
              </a>{" "}
              for machine-native billing on selected read endpoints.
              Authenticated account features remain separate.
            </p>
          </div>
        </FadeUp>

        <div className="grid md:grid-cols-3 gap-8 relative">
          {/* Connecting Line (Desktop) */}
          <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-[2px] bg-border z-0"></div>

          {steps.map((step, i) => (
            <div
              key={step.title}
              className="relative z-10 flex flex-col items-center text-center"
            >
              <div className="w-24 h-24 rounded-full bg-paper border-4 border-surface shadow-xl flex items-center justify-center mb-6 z-10">
                {i === 1 ? (
                  <span className="text-3xl font-bold text-accent">402</span>
                ) : (
                  <span className="text-3xl font-bold text-muted/50">
                    {i + 1}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold mb-2">{step.title}</h3>
              <p className="text-sm text-muted max-w-[200px]">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="py-24 border-t border-border">
      <div className="w-[min(1120px,92vw)] mx-auto text-center">
        <p className="text-sm font-semibold tracking-wider text-muted uppercase mb-8">
          Current stage
        </p>
        <div className="flex flex-wrap justify-center items-center gap-12 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
          <div className="h-8 w-32 bg-muted/20 rounded animate-pulse"></div>
          <div className="h-8 w-32 bg-muted/20 rounded animate-pulse delay-75"></div>
          <div className="h-8 w-32 bg-muted/20 rounded animate-pulse delay-150"></div>
          <div className="h-8 w-32 bg-muted/20 rounded animate-pulse delay-200"></div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-surface/30 pt-16 pb-8">
      <div className="w-[min(1120px,92vw)] mx-auto grid md:grid-cols-4 gap-12 mb-16">
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <div className="size-5 bg-muted rounded-sm" />
            <span className="font-bold uppercase tracking-wider text-muted">
              Trader Ralph
            </span>
          </div>
          <p className="text-muted max-w-sm">
            Trader Ralph builds Solana trading infrastructure and intelligence
            systems. This product provides software and data infrastructure, not
            financial advice.
            <br />
            <br />© {new Date().getFullYear()} Trader Ralph. All rights
            reserved.
          </p>
        </div>
        <div>
          <h4 className="font-bold mb-4">Explore</h4>
          <ul className="space-y-2 text-sm text-muted">
            <li>
              <a href="#features" className="hover:text-ink">
                Features
              </a>
            </li>
            <li>
              <a href="#how-it-works" className="hover:text-ink">
                Access Model
              </a>
            </li>
            <li>
              <a href="#roadmap" className="hover:text-ink">
                Roadmap
              </a>
            </li>
            <li>
              <a href="/api" className="hover:text-ink">
                API
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold mb-4">Legal</h4>
          <ul className="space-y-2 text-sm text-muted">
            <li>Terms of Service</li>
            <li>Privacy Policy</li>
            <li>Risk Disclosure</li>
          </ul>
        </div>
      </div>
      <div className="w-[min(1120px,92vw)] mx-auto text-center text-xs text-muted/50">
        <p>Infrastructure and signals only. No investment advice.</p>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <main className="dark bg-paper text-ink min-h-screen selection:bg-accent selection:text-ink">
      <Navbar />
      <Hero />
      <BentoGrid />
      <AccessModel />
      <Roadmap />
      <Trust />
      <Footer />
    </main>
  );
}

function Roadmap() {
  return (
    <section
      id="roadmap"
      className="py-24 border-t border-border/50 relative overflow-hidden"
    >
      <div className="w-[min(1120px,92vw)] mx-auto">
        <FadeUp>
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold">Build Tracks</h2>
            <p className="text-muted mt-2">
              Two tracks: internal automation loops and consumable signal
              products.
            </p>
          </div>
        </FadeUp>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Current Release */}
          <div className="p-8 rounded-2xl border border-border bg-surface/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
              <h3 className="text-lg font-bold">Current (Live)</h3>
            </div>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <IconCheck className="w-5 h-5 text-emerald-500 mt-0.5" />
                <div>
                  <p className="font-medium">Terminal + Wallet</p>
                  <p className="text-sm text-muted">
                    Privy-authenticated terminal with account wallet balances
                    and trade actions.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <IconCheck className="w-5 h-5 text-emerald-500 mt-0.5" />
                <div>
                  <p className="font-medium">x402 Read Endpoints</p>
                  <p className="text-sm text-muted">
                    Paid market, macro, and perps reads exposed over HTTP for agent
                    consumption.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <IconCheck className="w-5 h-5 text-emerald-500 mt-0.5" />
                <div>
                  <p className="font-medium">Server-side Swap Path</p>
                  <p className="text-sm text-muted">
                    SOL/USDC swap with policy checks, Privy signing, and RPC
                    submission.
                  </p>
                </div>
              </li>
            </ul>
          </div>

          {/* Upcoming */}
          <div className="p-8 rounded-2xl border border-dashed border-border bg-paper/50 opacity-80 hover:opacity-100 transition-opacity">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
              <h3 className="text-lg font-bold">Development Pipeline</h3>
            </div>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border border-border flex items-center justify-center mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-muted"></div>
                </div>
                <div>
                  <p className="font-medium">Loop A: Slot Truth Engine</p>
                  <p className="text-sm text-muted">
                    Canonical per-slot state, marks, and repairable ingestion
                    for Solana entities.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border border-border flex items-center justify-center mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-muted"></div>
                </div>
                <div>
                  <p className="font-medium">Loop B: Minute Scoring Engine</p>
                  <p className="text-sm text-muted">
                    Versioned features, scores, and cacheable views for terminal
                    and x402 products.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border border-border flex items-center justify-center mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-muted"></div>
                </div>
                <div>
                  <p className="font-medium">Agentic Hedge Fund Loops</p>
                  <p className="text-sm text-muted">
                    Internal automation loops first, then selective external
                    product surfaces.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
