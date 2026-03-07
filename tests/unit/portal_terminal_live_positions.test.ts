import { describe, expect, test } from "bun:test";
import {
  buildLivePositions,
  type PositionFill,
  summarizeLivePositions,
} from "../../apps/portal/app/terminal/components/live-positions";

function fill(input: Partial<PositionFill> & { id: string }): PositionFill {
  return {
    id: input.id,
    ts: input.ts ?? 0,
    pairId: input.pairId ?? "SOL/USDC",
    direction: input.direction ?? "buy",
    status: input.status ?? "finalized",
    signature: input.signature ?? "sig",
    baseFilledUi: input.baseFilledUi ?? 1,
    quoteFilledUi: input.quoteFilledUi ?? 100,
    fillPrice: input.fillPrice ?? 100,
    qualitySummary: input.qualitySummary ?? "lane safe",
  };
}

describe("portal terminal live positions model", () => {
  test("builds unrealized/realized pnl from fills and mark", () => {
    const positions = buildLivePositions({
      fills: [
        fill({
          id: "f1",
          ts: 1,
          direction: "buy",
          baseFilledUi: 2,
          quoteFilledUi: 200,
          fillPrice: 100,
        }),
      ],
      markByPair: { "SOL/USDC": 110 },
      quoteBalanceBySymbol: { USDC: 1000 },
    });

    expect(positions).toHaveLength(1);
    expect(positions[0]?.pairId).toBe("SOL/USDC");
    expect(positions[0]?.sizeBase).toBeCloseTo(2, 8);
    expect(positions[0]?.avgEntry).toBeCloseTo(100, 8);
    expect(positions[0]?.mark).toBeCloseTo(110, 8);
    expect(positions[0]?.unrealizedPnl).toBeCloseTo(20, 8);
    expect(positions[0]?.realizedPnl).toBeCloseTo(0, 8);
    expect(positions[0]?.leverage).toBeCloseTo(0.22, 8);
  });

  test("tracks realized pnl after partial close", () => {
    const positions = buildLivePositions({
      fills: [
        fill({
          id: "f1",
          ts: 1,
          direction: "buy",
          baseFilledUi: 2,
          quoteFilledUi: 200,
          fillPrice: 100,
        }),
        fill({
          id: "f2",
          ts: 2,
          direction: "sell",
          baseFilledUi: 1,
          quoteFilledUi: 120,
          fillPrice: 120,
        }),
      ],
      markByPair: { "SOL/USDC": 115 },
      quoteBalanceBySymbol: { USDC: 1000 },
    });
    const totals = summarizeLivePositions(positions);

    expect(positions).toHaveLength(1);
    expect(positions[0]?.sizeBase).toBeCloseTo(1, 8);
    expect(positions[0]?.avgEntry).toBeCloseTo(100, 8);
    expect(positions[0]?.realizedPnl).toBeCloseTo(20, 8);
    expect(positions[0]?.unrealizedPnl).toBeCloseTo(15, 8);
    expect(totals.realizedPnl).toBeCloseTo(20, 8);
    expect(totals.unrealizedPnl).toBeCloseTo(15, 8);
  });
});
