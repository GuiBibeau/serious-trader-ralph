import { describe, expect, test } from "bun:test";
import {
  buildCustomWorkspaceLayoutStorageKey,
  createDefaultWorkspaceStore,
  parseCustomWorkspaceStore,
  sanitizeWorkspaceModules,
} from "../../apps/portal/app/terminal/components/workspace-presets";

describe("portal terminal custom workspace presets", () => {
  test("sanitizes module visibility with safe fallback", () => {
    expect(
      sanitizeWorkspaceModules({
        market: false,
        wallet: false,
        macro_radar: false,
        macro_fred: false,
        macro_etf: false,
        macro_stablecoin: false,
        macro_oil: false,
      }).market,
    ).toBe(true);
  });

  test("parses and normalizes workspace store payload", () => {
    const parsed = parseCustomWorkspaceStore({
      activeId: "ws-2",
      presets: [
        {
          id: "ws-1",
          name: "Alpha",
          modules: { market: true },
        },
        {
          id: "ws-2",
          name: "Beta",
          modules: { wallet: true, market: false },
        },
        {
          id: "ws-2",
          name: "Duplicate",
          modules: { market: true },
        },
      ],
    });

    expect(parsed.presets.length).toBe(2);
    expect(parsed.activeId).toBe("ws-2");
    const beta = parsed.presets.find((item) => item.id === "ws-2");
    expect(beta).toBeDefined();
    expect(beta?.modules.market).toBe(false);
    expect(beta?.modules.wallet).toBe(true);
  });

  test("falls back to default store for invalid data", () => {
    const parsed = parseCustomWorkspaceStore({
      activeId: "missing",
      presets: "bad",
    });
    const fallback = createDefaultWorkspaceStore();
    expect(parsed.activeId).toBe(fallback.activeId);
    expect(parsed.presets.length).toBe(fallback.presets.length);
  });

  test("builds stable layout storage key", () => {
    expect(buildCustomWorkspaceLayoutStorageKey("ws-7")).toBe(
      "dashboard-grid-layouts:v6:custom:ws-7",
    );
    expect(buildCustomWorkspaceLayoutStorageKey("")).toBe(
      "dashboard-grid-layouts:v6:custom:default",
    );
  });
});
