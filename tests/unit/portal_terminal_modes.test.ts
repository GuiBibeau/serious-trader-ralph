import { describe, expect, test } from "bun:test";
import {
  getTerminalModeCapabilities,
  mergeProfileWithTerminalMode,
  modeAllowsAction,
  modeShowsModule,
  readTerminalModeFromProfile,
  resolveDefaultTerminalMode,
} from "../../apps/portal/app/terminal/terminal-modes";

describe("portal terminal modes", () => {
  test("resolves default mode with regular fallback", () => {
    expect(resolveDefaultTerminalMode("degen")).toBe("degen");
    expect(resolveDefaultTerminalMode("custom")).toBe("custom");
    expect(resolveDefaultTerminalMode("REGULAR")).toBe("regular");
    expect(resolveDefaultTerminalMode("unknown")).toBe("regular");
    expect(resolveDefaultTerminalMode("")).toBe("regular");
  });

  test("reads terminal mode from persisted profile object", () => {
    expect(
      readTerminalModeFromProfile({
        terminal: { mode: "degen" },
      }),
    ).toBe("degen");
    expect(
      readTerminalModeFromProfile({
        terminal: { mode: "invalid" },
      }),
    ).toBeNull();
    expect(readTerminalModeFromProfile(null)).toBeNull();
  });

  test("merges terminal mode into existing profile payload", () => {
    const merged = mergeProfileWithTerminalMode(
      {
        consumer: { riskBand: "balanced" },
        terminal: { mode: "regular", source: "default_fallback" },
      },
      {
        mode: "custom",
        source: "manual",
      },
    );
    expect(merged.consumer).toEqual({ riskBand: "balanced" });
    expect(merged.terminal).toMatchObject({
      mode: "custom",
      source: "manual",
    });
    expect(typeof (merged.terminal as { updatedAt?: unknown }).updatedAt).toBe(
      "string",
    );
  });

  test("applies deterministic module visibility and action matrix", () => {
    const regular = getTerminalModeCapabilities("regular");
    expect(regular.label).toBe("Regular");
    expect(modeShowsModule("regular", "macro_stablecoin")).toBe(false);
    expect(modeShowsModule("regular", "macro_radar")).toBe(true);
    expect(modeAllowsAction("regular", "macro_trade")).toBe(false);
    expect(modeShowsModule("regular", "degen_watchlist")).toBe(false);

    expect(modeShowsModule("degen", "macro_stablecoin")).toBe(true);
    expect(modeShowsModule("degen", "degen_watchlist")).toBe(true);
    expect(modeShowsModule("degen", "degen_event_hooks")).toBe(true);
    expect(modeAllowsAction("degen", "macro_trade")).toBe(true);
    expect(modeAllowsAction("degen", "layout_edit")).toBe(true);
  });
});
