import { describe, expect, test } from "bun:test";
import {
  type SpotAsset,
  type TriggerOrder,
  triggerOrderView,
  USDC_MINT,
} from "./spot";

const SOL = "So11111111111111111111111111111111111111112";

function asset(overrides: Partial<SpotAsset> = {}): SpotAsset {
  return {
    symbol: "SOL",
    name: "Solana",
    mint: SOL,
    decimals: 9,
    hub: "crypto",
    price: 100,
    change24hPct: null,
    volume24hUsd: null,
    marketCap: null,
    ...overrides,
  } as SpotAsset;
}

function order(overrides: Partial<TriggerOrder> = {}): TriggerOrder {
  return {
    orderKey: "k",
    inputMint: USDC_MINT,
    outputMint: SOL,
    makingAmountAtoms: 250_000_000, // 250 USDC
    takingAmountAtoms: 2_000_000_000, // 2 SOL
    ...overrides,
  } as TriggerOrder;
}

describe("triggerOrderView", () => {
  test("USDC input → buy; notional from USDC atoms; implied limit", () => {
    const view = triggerOrderView(order(), [asset()]);
    expect(view?.side).toBe("buy");
    expect(view?.symbol).toBe("SOL");
    expect(view?.notionalUsd).toBe(250);
    expect(view?.limitPrice).toBe(125); // 250 USDC / 2 SOL
  });

  test("token input → sell with mint orientation flipped", () => {
    const view = triggerOrderView(
      order({
        inputMint: SOL,
        outputMint: USDC_MINT,
        makingAmountAtoms: 2_000_000_000, // 2 SOL out
        takingAmountAtoms: 300_000_000, // 300 USDC in
      }),
      [asset()],
    );
    expect(view?.side).toBe("sell");
    expect(view?.notionalUsd).toBe(300);
    expect(view?.limitPrice).toBe(150);
  });

  test("non-9-decimal tokens use asset decimals for quantity", () => {
    const view = triggerOrderView(
      order({
        outputMint: "mint6",
        takingAmountAtoms: 5_000_000, // 5 tokens at 6 decimals
      }),
      [asset({ mint: "mint6", decimals: 6, symbol: "USDT" })],
    );
    expect(view?.limitPrice).toBe(50); // 250 / 5
  });

  test("unknown mint → null", () => {
    expect(
      triggerOrderView(order({ outputMint: "ghost" }), [asset()]),
    ).toBeNull();
  });

  test("zero/absent amounts guard to null fields", () => {
    const view = triggerOrderView(
      order({ makingAmountAtoms: 0, takingAmountAtoms: 0 }),
      [asset()],
    );
    expect(view?.notionalUsd).toBeNull();
    expect(view?.limitPrice).toBeNull();
  });
});
