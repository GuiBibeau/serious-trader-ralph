import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const REQUEST_ID = "execreq_proof_001";
const RECEIPT_ID = "execrcpt_proof_001";
const SIGNATURE = "5N9B8fQ1harnessProofReceiptSignature1111111111111111111111";
const PERP_REQUEST_ID = "execreq_perp_proof_001";
const PERP_RECEIPT_ID = "execrcpt_perp_proof_001";

function screenshotPath(name: string): string | null {
  const screenshotDir = process.env.PLAYWRIGHT_PROOF_SCREENSHOT_DIR?.trim();
  if (!screenshotDir) return null;
  mkdirSync(screenshotDir, { recursive: true });
  return join(screenshotDir, name);
}

async function captureCheckpoint(page: Page, name: string): Promise<void> {
  const path = screenshotPath(name);
  if (!path) return;
  await page.screenshot({ path, fullPage: true });
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/terminal/spot-preview", async (route) => {
    const payload = (route.request().postDataJSON() ?? {}) as {
      venueKey?: string;
      amountAtomic?: string;
    };
    const venueKey = String(payload.venueKey ?? "jupiter");
    const outAmountAtomicByVenue: Record<string, string> = {
      jupiter: "2000000000",
      raydium: "1985000000",
      orca: "1979000000",
    };
    const routeSummaryByVenue: Record<string, string> = {
      jupiter: "Jupiter routed spot swap",
      raydium: "Raydium direct route",
      orca: "Orca whirlpool path",
    };
    const priceImpactByVenue: Record<string, number> = {
      jupiter: 0.0018,
      raydium: 0.0026,
      orca: 0.0031,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        preview: {
          venueKey,
          provider: venueKey,
          inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          outputMint: "So11111111111111111111111111111111111111112",
          inAmountAtomic: String(payload.amountAtomic ?? "50000000"),
          outAmountAtomic: outAmountAtomicByVenue[venueKey] ?? "1950000000",
          priceImpactPct: priceImpactByVenue[venueKey] ?? 0.004,
          routeSummary:
            routeSummaryByVenue[venueKey] ?? "Unsupported venue preview",
        },
      }),
    });
  });

  await page.route("**/api/x402/exec/submit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: REQUEST_ID,
        status: {
          state: "queued",
          terminal: false,
          updatedAt: "2026-03-06T20:45:00.000Z",
        },
      }),
    });
  });

  await page.route("**/api/x402/exec/status/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: REQUEST_ID,
        status: {
          state: "finalized",
          terminal: true,
          mode: "privy_execute",
          lane: "safe",
          actorType: "user",
          receivedAt: "2026-03-06T20:45:00.000Z",
          updatedAt: "2026-03-06T20:45:02.000Z",
          terminalAt: "2026-03-06T20:45:03.000Z",
        },
        intent: {
          family: "spot_swap",
          venueKey: "jupiter",
          marketType: "spot",
          instrumentId: "SOL/USDC",
          instrumentLabel: "SOL / USDC",
        },
        lifecycle: {
          orderState: "filled",
          fillState: "complete",
          settlementState: "finalized",
          notes: ["spot_swap", "proof-harness"],
        },
        events: [
          {
            state: "queued",
            at: "2026-03-06T20:45:00.000Z",
            provider: "proof-harness",
            attempt: 1,
            note: "order accepted",
          },
          {
            state: "finalized",
            at: "2026-03-06T20:45:03.000Z",
            provider: "proof-harness",
            attempt: 1,
            note: "receipt available",
          },
        ],
        attempts: [
          {
            attempt: 1,
            provider: "proof-harness",
            state: "finalized",
            at: "2026-03-06T20:45:03.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/x402/exec/receipt/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: REQUEST_ID,
        ready: true,
        receipt: {
          receiptId: RECEIPT_ID,
          provider: "proof-harness",
          generatedAt: "2026-03-06T20:45:03.000Z",
          outcome: {
            status: "finalized",
            signature: SIGNATURE,
            networkFeeLamports: "5000",
            errorCode: null,
            errorMessage: null,
          },
        },
      }),
    });
  });

  await page.route("**/api/terminal/perp-preview", async (route) => {
    const payload = (route.request().postDataJSON() ?? {}) as {
      instrumentId?: string;
      side?: string;
      orderType?: string;
      timeInForce?: string;
      quantityAtomic?: string;
      collateralAtomic?: string;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        preview: {
          venueKey: "drift",
          provider: "drift",
          instrumentId: String(payload.instrumentId ?? "SOL-PERP"),
          instrumentLabel: "SOL-PERP",
          side: String(payload.side ?? "long"),
          orderType: String(payload.orderType ?? "market"),
          timeInForce: String(payload.timeInForce ?? "gtc"),
          reduceOnly: false,
          quantityAtomic: String(payload.quantityAtomic ?? "2"),
          quantityUi: "2.0",
          collateralAtomic: String(payload.collateralAtomic ?? "100000000"),
          collateralUi: "100.0",
          limitPriceAtomic: null,
          triggerPriceAtomic: null,
          markPrice: 153.3,
          oraclePrice: 153.25,
          oracle: "oracle-sol",
          oracleSource: "pyth",
          fundingRate1hBps: 1.2,
          initialMarginRatio: 0.1,
          maintenanceMarginRatio: 0.05,
          swiftSupported: false,
          currentSignedQuantityAtomic: "0",
          currentSignedQuantityUi: "0.0",
          currentCollateralAtomic: "0",
          currentCollateralUi: "0.0",
          currentAverageEntryPrice: null,
          projectedSignedQuantityAtomic: "2",
          projectedSignedQuantityUi: "2.0",
          projectedCollateralAtomic: "100000000",
          projectedCollateralUi: "100.0",
          projectedNotionalQuote: 306.6,
          requiredInitialMarginQuote: 30.66,
          requiredMaintenanceQuote: 15.33,
          projectedLeverage: 3.066,
          projectedLiquidationBufferPct: 84.67,
          projectedRiskLevel: "low",
          routeSummary: "Drift Perps",
          notes: ["MARKET GTC", "exposure-expanding", "paper-mode only"],
        },
      }),
    });
  });

  await page.route("**/api/terminal/perp-orders", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          requestId: PERP_REQUEST_ID,
          status: "finalized",
          terminal: true,
          updatedAt: "2026-03-06T20:46:00.000Z",
          receiptId: PERP_RECEIPT_ID,
          provider: "drift",
          instrumentId: "SOL-PERP",
          instrumentLabel: "SOL-PERP",
          side: "long",
          quantityAtomic: "2",
          collateralAtomic: "100000000",
          markPrice: 153.3,
          oraclePrice: 153.25,
          fundingRate1hBps: 1.2,
        },
      }),
    });
  });
});

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("heading").first()).toContainText(
    /Sign in to Terminal|Sign in unavailable|Missing Privy app id/,
  );
  await captureCheckpoint(page, "login-page.png");
});

test("proof route exercises market render, trade validation, and receipt drilldown", async ({
  page,
}) => {
  await page.goto("/proof/browser");

  await expect(page.getByTestId("browser-proof-page")).toBeVisible();
  await expect(page.getByTestId("proof-market-card")).toBeVisible();
  await captureCheckpoint(page, "proof-home.png");

  await page.getByTestId("proof-open-trade").click();
  await expect(page.getByTestId("trade-ticket-modal")).toBeVisible();
  await expect(page.getByTestId("trade-ticket-venue-select")).toHaveValue(
    "jupiter",
  );
  await expect(page.getByTestId("trade-ticket-venue-path")).toContainText(
    "Routed AMM / Trigger",
  );
  await expect(page.getByTestId("trade-ticket-quote-route")).toContainText(
    "Jupiter routed spot swap",
  );
  await expect(page.getByTestId("trade-ticket-quote-reference")).not.toHaveText(
    "--",
  );

  await page.getByTestId("trade-ticket-order-type").selectOption("trigger");
  await expect(
    page.getByText("Trigger orders require a trigger price."),
  ).toBeVisible();
  await captureCheckpoint(page, "trade-validation.png");

  await page.getByTestId("trade-ticket-venue-select").selectOption("raydium");
  await expect(page.getByTestId("trade-ticket-venue-path")).toContainText(
    "Direct AMM route",
  );
  await expect(page.getByTestId("trade-ticket-venue-readiness")).toContainText(
    "Shadow / paper",
  );
  await expect(page.getByTestId("trade-ticket-submit")).toHaveText(
    "Preview Only",
  );
  await expect(page.getByText(/Raydium is preview-only/i)).toBeVisible();
  await expect(page.getByTestId("trade-ticket-submit")).toBeDisabled();
  await captureCheckpoint(page, "trade-venue-preview.png");

  await page.getByTestId("trade-ticket-venue-select").selectOption("jupiter");
  await page.getByTestId("trade-ticket-order-type").selectOption("market");
  await expect(page.getByTestId("trade-ticket-submit")).toContainText(
    "Execute Buy",
  );
  await expect(page.getByText("2 SOL")).toBeVisible();

  await page.getByTestId("trade-ticket-submit").click();
  await expect(page.getByTestId("proof-trade-completion")).toContainText(
    REQUEST_ID,
  );
  await captureCheckpoint(page, "trade-complete.png");

  await page.getByTestId("proof-open-inspector").click();
  const inspector = page.getByTestId("execution-inspector-drawer");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText(`receipt ${RECEIPT_ID}`)).toBeVisible();
  await expect(inspector.getByText(`signature: ${SIGNATURE}`)).toBeVisible();
  await expect(inspector.getByText(/venue Jupiter/i)).toBeVisible();
  await captureCheckpoint(page, "receipt-drawer.png");
  await page.getByRole("button", { name: "Close execution inspector" }).click();
  await expect(inspector).toBeHidden();

  await page.getByTestId("proof-open-perp").click();
  await expect(page.getByTestId("perp-ticket-modal")).toBeVisible();
  await expect(page.getByTestId("perp-ticket-preview-route")).toContainText(
    "Drift Perps",
  );
  await expect(page.getByTestId("perp-ticket-preview-risk")).toContainText(
    "LOW",
  );
  await captureCheckpoint(page, "perp-proof.png");

  await page.getByTestId("perp-ticket-submit").click();
  await expect(page.getByTestId("proof-perp-completion")).toContainText(
    PERP_REQUEST_ID,
  );
  await captureCheckpoint(page, "perp-complete.png");
});

test("runtime operator proof shows deployment detail and control affordances", async ({
  page,
}) => {
  await page.goto("/proof/runtime");

  await expect(page.getByTestId("runtime-operator-proof-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Runtime deployments/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Latest hypotheses, sources, experiments, and evidence bundles/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Readiness targets, canary posture, and disable drills by venue/i,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("runtime-program-jupiter")).toContainText(
    "Jupiter",
  );
  await captureCheckpoint(page, "runtime-operator-home.png");

  await page.getByRole("button", { name: /mean_reversion/i }).click();
  await expect(
    page.getByRole("heading", {
      name: "deployment_mean_reversion_paper",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run canary" }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(
    page.getByText("paused", { exact: false }).first(),
  ).toBeVisible();
  await captureCheckpoint(page, "runtime-operator-paused.png");
});
