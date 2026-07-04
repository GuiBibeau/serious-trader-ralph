import { describe, expect, test } from "bun:test";
import { parseTerminalDeepLink, snapLeverage } from "./deep-link";

describe("snapLeverage", () => {
  test("snaps to nearest allowed option", () => {
    const allowed = [1, 2, 5, 10, 20];
    expect(snapLeverage(3, allowed)).toBe(2); // ties keep the earlier option
    expect(snapLeverage(4, allowed)).toBe(5);
    expect(snapLeverage(100, allowed)).toBe(20);
    expect(snapLeverage(1, allowed)).toBe(1);
  });
});

describe("parseTerminalDeepLink", () => {
  test("null when no KNOWN param present (replaceState no-op)", () => {
    expect(parseTerminalDeepLink("")).toBeNull();
    expect(parseTerminalDeepLink("?utm_source=x&ref=abc")).toBeNull();
  });

  test("perp venue: symbol uppercased, -PERP stripped, side/size/leverage", () => {
    const intent = parseTerminalDeepLink(
      "?venue=perps&asset=sol-perp&side=short&size=500&leverage=8",
    );
    expect(intent?.venue).toBe("perp");
    expect(intent?.symbol).toBe("SOL");
    expect(intent?.side).toBe("sell");
    expect(intent?.sizeUsd).toBe(500);
    expect(intent?.leverage).toBe(10); // 8 snaps to 10
    expect(intent?.bookTab).toBe("trade");
  });

  test("default venue is spot; asset id lowercased", () => {
    const intent = parseTerminalDeepLink("?asset=SOL&side=sell&size=25");
    expect(intent?.venue).toBe("spot");
    expect(intent?.spotAssetId).toBe("sol");
    expect(intent?.side).toBe("sell");
    expect(intent?.sizeUsd).toBe(25);
  });

  test("tf-only link touches neither venue nor bookTab", () => {
    const intent = parseTerminalDeepLink("?tf=1h");
    expect(intent?.venue).toBeNull();
    expect(intent?.bookTab).toBeNull();
    expect(intent?.timeframe).toBe("1h");
  });

  test("price implies limit type and beats explicit type param", () => {
    const priced = parseTerminalDeepLink("?venue=perp&price=150.5&type=market");
    expect(priced?.orderType).toBe("limit");
    expect(priced?.limitPrice).toBe(150.5);
    const typed = parseTerminalDeepLink("?venue=perp&type=limit");
    expect(typed?.orderType).toBe("limit");
    expect(typed?.limitPrice).toBeNull();
  });

  test("bounds rejection: zero, negative, huge, NaN", () => {
    const intent = parseTerminalDeepLink(
      "?venue=perp&size=0&price=-5&tp=200000001&sl=abc&leverage=101",
    );
    expect(intent?.sizeUsd).toBeNull();
    expect(intent?.limitPrice).toBeNull();
    expect(intent?.takeProfit).toBeNull();
    expect(intent?.stopLoss).toBeNull();
    expect(intent?.leverage).toBeNull();
  });

  test("tp/sl within bounds pass through", () => {
    const intent = parseTerminalDeepLink("?venue=perp&tp=180&sl=140");
    expect(intent?.takeProfit).toBe(180);
    expect(intent?.stopLoss).toBe(140);
  });

  test("tab overrides branch default; cmd overrides tab", () => {
    expect(parseTerminalDeepLink("?venue=perp&tab=book")?.bookTab).toBe("book");
    expect(parseTerminalDeepLink("?asset=sol&tab=book")?.bookTab).toBe("book");
    expect(
      parseTerminalDeepLink("?venue=perp&tab=book&cmd=buy%20sol")?.bookTab,
    ).toBe("trade");
  });

  test("watch tokens: trim, uppercase, charset rule, keeps order", () => {
    const intent = parseTerminalDeepLink(
      "?watch=sol,%20btc%20,toolongsymbol123,we$rd",
    );
    expect(intent?.watchSymbols).toEqual(["SOL", "BTC"]);
  });

  test("overlay precedence: funds > ticket > alerts", () => {
    const funds = parseTerminalDeepLink(
      "?venue=perp&fund=convert&ticket=1&alerts=1",
    );
    expect(funds?.overlay).toEqual({ kind: "funds", tab: "convert" });
    const ticket = parseTerminalDeepLink("?venue=perp&ticket=1&alerts=1");
    expect(ticket?.overlay).toEqual({ kind: "ticket" });
    const alerts = parseTerminalDeepLink("?ticket=1&alerts=1");
    // ticket flag only opens the ticket on the perp venue
    expect(alerts?.overlay).toEqual({ kind: "alerts" });
  });

  test("fund opens on ANY value (even 0/false); unknown tab → null tab", () => {
    expect(parseTerminalDeepLink("?fund=0")?.overlay).toEqual({
      kind: "funds",
      tab: null,
    });
    expect(parseTerminalDeepLink("?fund=phoenix")?.overlay).toEqual({
      kind: "funds",
      tab: "phoenix",
    });
  });

  test("ticket/alerts flags reject 0 and false", () => {
    expect(
      parseTerminalDeepLink("?venue=perp&ticket=false")?.overlay,
    ).toBeNull();
    expect(parseTerminalDeepLink("?alerts=0")?.overlay).toBeNull();
  });

  test("mode param whitelists last/mark", () => {
    expect(parseTerminalDeepLink("?mode=mark")?.priceMode).toBe("mark");
    expect(parseTerminalDeepLink("?mode=oracle")?.priceMode).toBeNull();
  });
});
