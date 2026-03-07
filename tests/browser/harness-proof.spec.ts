import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const REQUEST_ID = "execreq_proof_001";
const RECEIPT_ID = "execrcpt_proof_001";
const SIGNATURE = "5N9B8fQ1harnessProofReceiptSignature1111111111111111111111";

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
  await page.route("**/api/x402/read/market_jupiter_quote", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        quote: {
          outAmount: "2000000000",
          priceImpactPct: 0.0018,
          routePlan: [{ swapInfo: { label: "Jupiter" } }],
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

  await page.getByTestId("trade-ticket-order-type").selectOption("trigger");
  await expect(
    page.getByText("Trigger orders require a trigger price."),
  ).toBeVisible();
  await captureCheckpoint(page, "trade-validation.png");

  await page.getByTestId("trade-ticket-order-type").selectOption("market");
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
  await captureCheckpoint(page, "receipt-drawer.png");
});
