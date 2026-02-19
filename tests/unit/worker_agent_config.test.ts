import { describe, expect, test } from "bun:test";
import { buildAgentToolset } from "../../apps/worker/src/agent_tools";
import type { AgentStrategy } from "../../apps/worker/src/types";

describe("worker agent config", () => {
  test("buildAgentToolset returns default tools", () => {
    const strategy: AgentStrategy = { type: "agent" };
    const { tools } = buildAgentToolset(strategy);
    const names = tools.map((t) => t.function.name).sort();
    expect(names).toContain("control_finish");
    expect(names).toContain("market_snapshot");
    expect(names).toContain("market_jupiter_quote");
    expect(names).toContain("market_jupiter_quote_batch");
    expect(names).toContain("market_ohlcv_history");
    expect(names).toContain("market_indicators");
    expect(names).toContain("macro_signals");
    expect(names).toContain("macro_fred_indicators");
    expect(names).toContain("macro_etf_flows");
    expect(names).toContain("macro_stablecoin_health");
    expect(names).toContain("macro_oil_analytics");
    expect(names).toContain("backtest_run_create");
    expect(names).toContain("backtest_run_list");
    expect(names).toContain("backtest_run_get");
    expect(names).toContain("trade_jupiter_swap");
    expect(names).toContain("memory_update_thesis");
    expect(names).toContain("memory_log_observation");
  });

  test("allowedActions filters action tools but keeps research tools", () => {
    const strategy: AgentStrategy = {
      type: "agent",
      allowedActions: ["trade"],
    };
    const { tools } = buildAgentToolset(strategy);
    const names = tools.map((t) => t.function.name).sort();
    expect(names).toContain("control_finish");
    expect(names).toContain("market_snapshot");
    expect(names).toContain("market_jupiter_quote");
    expect(names).toContain("market_jupiter_quote_batch");
    expect(names).toContain("market_ohlcv_history");
    expect(names).toContain("market_indicators");
    expect(names).toContain("macro_signals");
    expect(names).toContain("macro_fred_indicators");
    expect(names).toContain("macro_etf_flows");
    expect(names).toContain("macro_stablecoin_health");
    expect(names).toContain("macro_oil_analytics");
    expect(names).toContain("backtest_run_create");
    expect(names).toContain("backtest_run_list");
    expect(names).toContain("backtest_run_get");
    expect(names).toContain("trade_jupiter_swap");
    expect(names).not.toContain("memory_update_thesis");
    expect(names).not.toContain("memory_log_observation");
  });

  test("toolPolicy allow-list restricts tools but keeps control_finish", () => {
    const strategy: AgentStrategy = {
      type: "agent",
      toolPolicy: { allow: ["market_snapshot"] },
    };
    const { tools } = buildAgentToolset(strategy);
    expect(tools.map((t) => t.function.name).sort()).toEqual(
      ["control_finish", "market_snapshot"].sort(),
    );
  });

  test("toolPolicy allow-list can include market_ohlcv_history", () => {
    const strategy: AgentStrategy = {
      type: "agent",
      toolPolicy: { allow: ["market_ohlcv_history"] },
    };
    const { tools } = buildAgentToolset(strategy);
    expect(tools.map((t) => t.function.name).sort()).toEqual(
      ["control_finish", "market_ohlcv_history"].sort(),
    );
  });

  test("toolPolicy allow-list can include backtest run tools", () => {
    const strategy: AgentStrategy = {
      type: "agent",
      toolPolicy: {
        allow: ["backtest_run_create", "backtest_run_list", "backtest_run_get"],
      },
    };
    const { tools } = buildAgentToolset(strategy);
    expect(tools.map((t) => t.function.name).sort()).toEqual(
      [
        "control_finish",
        "backtest_run_create",
        "backtest_run_list",
        "backtest_run_get",
      ].sort(),
    );
  });
});
