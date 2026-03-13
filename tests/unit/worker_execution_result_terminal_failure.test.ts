import { describe, expect, test } from "bun:test";
import { resolveTerminalFailureFromExecuteResult } from "../../apps/worker/src/index";

describe("worker execution terminal failure resolution", () => {
  test("keeps signed but unconfirmed submissions non-terminal", () => {
    expect(
      resolveTerminalFailureFromExecuteResult(
        "error",
        { message: "timeout" },
        "sig-pending",
      ),
    ).toBeNull();
  });

  test("still terminalizes unsigned execution errors", () => {
    expect(
      resolveTerminalFailureFromExecuteResult("error", { message: "timeout" }),
    ).toMatchObject({
      terminalStatus: "failed",
      errorCode: "venue-timeout",
    });
  });
});
