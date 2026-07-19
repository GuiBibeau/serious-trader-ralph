import { describe, expect, test } from "bun:test";
import {
  BURST_CAP,
  BURST_WINDOW_MS,
  buildMessages,
  burstAllowed,
  CHAT_SYSTEM_PROMPT,
  CHAT_TOOLS,
  type ChatMessage,
  capHistory,
  DAILY_MESSAGE_CAP,
  dailyAllowed,
  groundedOrNull,
  toolToEdgePath,
  utcDayKey,
} from "./chat-core";

const NOW = Date.UTC(2026, 6, 19, 14, 2, 0);

describe("burstAllowed", () => {
  test("allows the 10th message and blocks the 11th inside the window", () => {
    const nineRecent = Array.from(
      { length: BURST_CAP - 1 },
      (_, index) => NOW - index,
    );
    const tenRecent = Array.from(
      { length: BURST_CAP },
      (_, index) => NOW - index,
    );

    expect(burstAllowed(nineRecent, NOW)).toBe(true);
    expect(burstAllowed(tenRecent, NOW)).toBe(false);
  });

  test("ignores entries at or older than the burst window", () => {
    const recent = Array.from({ length: BURST_CAP }, (_, index) => NOW - index);
    const oldEntries = [NOW - BURST_WINDOW_MS, NOW - BURST_WINDOW_MS - 1];

    expect(burstAllowed([...oldEntries, ...recent.slice(1)], NOW)).toBe(true);
  });
});

describe("dailyAllowed", () => {
  test("increments up to the daily cap and then blocks", () => {
    const dayKey = utcDayKey(NOW);

    expect(dailyAllowed({ dayKey, count: DAILY_MESSAGE_CAP - 1 }, NOW)).toEqual(
      {
        allowed: true,
        nextRecord: { dayKey, count: DAILY_MESSAGE_CAP },
      },
    );
    expect(dailyAllowed({ dayKey, count: DAILY_MESSAGE_CAP }, NOW)).toEqual({
      allowed: false,
      nextRecord: { dayKey, count: DAILY_MESSAGE_CAP },
    });
  });

  test("rolls over at UTC midnight when the day key changes", () => {
    const beforeMidnight = Date.UTC(2026, 6, 19, 23, 59, 59);
    const afterMidnight = Date.UTC(2026, 6, 20, 0, 0, 0);

    expect(utcDayKey(beforeMidnight)).toBe("2026-07-19");
    expect(
      dailyAllowed(
        { dayKey: utcDayKey(beforeMidnight), count: DAILY_MESSAGE_CAP },
        afterMidnight,
      ),
    ).toEqual({
      allowed: true,
      nextRecord: { dayKey: "2026-07-20", count: 1 },
    });
  });
});

describe("groundedOrNull", () => {
  test("rejects invented numbers", () => {
    expect(groundedOrNull("BTC is at 99", "BTC is gated")).toBeNull();
  });

  test("passes numbers present in the context facts", () => {
    expect(groundedOrNull("BTC is at 43210.5", "price: 43210.5")).toBe(
      "BTC is at 43210.5",
    );
  });

  test("allows the standing 24/7/30 wording numbers", () => {
    expect(groundedOrNull("Coverage is 24/7 over 30 days.", "")).toBe(
      "Coverage is 24/7 over 30 days.",
    );
  });

  test("strips commas before comparing numbers", () => {
    expect(groundedOrNull("Volume is 1234567", "volume: 1,234,567")).toBe(
      "Volume is 1234567",
    );
  });
});

describe("buildMessages", () => {
  test("assembles system, timestamped context, and capped history", () => {
    const messages = buildMessages(
      { price: "123" },
      [{ role: "user", content: "what changed?" }],
      NOW,
    );

    expect(messages[0]).toEqual({
      role: "system",
      content: CHAT_SYSTEM_PROMPT,
    });
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toBe(
      'DESK CONTEXT (as of 2026-07-19T14:02:00.000Z):\n{"price":"123"}',
    );
    expect(messages[2]).toEqual({ role: "user", content: "what changed?" });
  });

  test("caps the context message at 12,000 chars with a truncation marker", () => {
    const messages = buildMessages({ blob: "x".repeat(13_000) }, [], NOW);

    expect(messages[1]?.content).toHaveLength(12_000);
    expect(messages[1]?.content.endsWith("\n[context truncated]")).toBe(true);
  });
});

describe("capHistory", () => {
  test("keeps the last 12 messages and caps each content at 2,000 chars", () => {
    const history: ChatMessage[] = Array.from({ length: 13 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index}:${"x".repeat(2_100)}`,
    }));

    const capped = capHistory(history);

    expect(capped).toHaveLength(12);
    expect(capped[0]?.content.startsWith("1:")).toBe(true);
    expect(capped.every((message) => message.content.length === 2_000)).toBe(
      true,
    );
  });
});

describe("tools", () => {
  test("declares the five macro tools in order", () => {
    expect(CHAT_TOOLS.map((tool) => tool.name)).toEqual([
      "macro_signals",
      "macro_fred",
      "macro_etf_flows",
      "macro_stablecoins",
      "macro_oil",
    ]);
    expect(
      CHAT_TOOLS.every((tool) => Object.keys(tool.parameters).length > 0),
    ).toBe(true);
  });

  test("maps every tool to its edge path and unknown tools to null", () => {
    expect(toolToEdgePath("macro_signals")).toBe(
      "/api/x402/read/macro_signals",
    );
    expect(toolToEdgePath("macro_fred")).toBe(
      "/api/x402/read/macro_fred_indicators",
    );
    expect(toolToEdgePath("macro_etf_flows")).toBe(
      "/api/x402/read/macro_etf_flows",
    );
    expect(toolToEdgePath("macro_stablecoins")).toBe(
      "/api/x402/read/macro_stablecoin_health",
    );
    expect(toolToEdgePath("macro_oil")).toBe(
      "/api/x402/read/macro_oil_analytics",
    );
    expect(toolToEdgePath("macro_unknown")).toBeNull();
  });
});
