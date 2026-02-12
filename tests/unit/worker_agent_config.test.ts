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
});
