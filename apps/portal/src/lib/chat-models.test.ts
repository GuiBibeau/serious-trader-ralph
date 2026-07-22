import { describe, expect, test } from "bun:test";
import {
  type ChatModelChoice,
  FREE_MODEL,
  PRO_MODEL,
  resolveModel,
  type TaskClass,
} from "./chat-models";

describe("resolveModel", () => {
  const cases: {
    choice: ChatModelChoice;
    taskClass: TaskClass;
    proAllowed: boolean;
    tier: "free" | "pro";
    model: string;
    proLabel: boolean;
  }[] = [
    {
      choice: "auto",
      taskClass: "analysis",
      proAllowed: true,
      tier: "pro",
      model: PRO_MODEL,
      proLabel: true,
    },
    {
      choice: "auto",
      taskClass: "chat",
      proAllowed: true,
      tier: "free",
      model: FREE_MODEL,
      proLabel: false,
    },
    {
      choice: "auto",
      taskClass: "analysis",
      proAllowed: false,
      tier: "free",
      model: FREE_MODEL,
      proLabel: false,
    },
    {
      choice: "pro",
      taskClass: "analysis",
      proAllowed: false,
      tier: "free",
      model: FREE_MODEL,
      proLabel: false,
    },
    {
      choice: "pro",
      taskClass: "chat",
      proAllowed: true,
      tier: "pro",
      model: PRO_MODEL,
      proLabel: true,
    },
    {
      choice: "free",
      taskClass: "analysis",
      proAllowed: true,
      tier: "free",
      model: FREE_MODEL,
      proLabel: false,
    },
    {
      choice: "free",
      taskClass: "chat",
      proAllowed: false,
      tier: "free",
      model: FREE_MODEL,
      proLabel: false,
    },
  ];

  test.each(cases)("$choice + $taskClass + proAllowed=$proAllowed -> $tier", ({
    choice,
    taskClass,
    proAllowed,
    tier,
    model,
    proLabel,
  }) => {
    expect(resolveModel(choice, taskClass, proAllowed)).toEqual({
      tier,
      model,
      proLabel,
    });
  });

  test.each(
    cases,
  )("proLabel mirrors tier for $choice + $taskClass + proAllowed=$proAllowed", ({
    choice,
    taskClass,
    proAllowed,
  }) => {
    const resolved = resolveModel(choice, taskClass, proAllowed);

    expect(resolved.proLabel).toBe(resolved.tier === "pro");
  });
});
