import { parseRuntimeDeploymentRecord } from "../../../src/runtime/contracts/autonomous_runtime.js";
import type {
  RuntimeResearchPromotionRequest,
  RuntimeScorecardGate,
} from "../../../src/runtime/research/promotion.js";
import {
  buildRuntimeResearchPromotion,
  buildRuntimeResearchPromotionMarkdown,
} from "../../../src/runtime/research/promotion.js";
import {
  applyRuntimeDeploymentControl,
  evaluateRuntimeDeployment,
  readRuntimeScorecard,
  upsertRuntimeDeployment,
} from "./runtime_internal";
import {
  appendStrategyLabPromotionEvent,
  getStrategyLabPromotion,
  listStrategyLabPromotionEvents,
  listStrategyLabPromotions,
  writeStrategyLabPromotion,
} from "./strategy_lab_promotion_repository";
import type { Env } from "./types";

export type RuntimeResearchPromotionWorkflowResult = {
  promotion: ReturnType<typeof buildRuntimeResearchPromotion>["promotion"];
  event: ReturnType<typeof buildRuntimeResearchPromotion>["event"];
  markdown: string;
};

export async function runRuntimeResearchPromotionWorkflow(input: {
  env: Env;
  request: RuntimeResearchPromotionRequest;
}): Promise<RuntimeResearchPromotionWorkflowResult> {
  const resolvedRequest = await hydratePromotionRequest(input);
  const { promotion, event } = buildRuntimeResearchPromotion({
    request: resolvedRequest,
  });

  if (promotion.status === "applied") {
    for (const action of promotion.actions) {
      if (action.actionType === "record_state_transition") {
        continue;
      }
      await applyPromotionAction({
        env: input.env,
        action,
      });
    }
  }

  await writeStrategyLabPromotion(input.env.WAITLIST_DB, promotion);
  await appendStrategyLabPromotionEvent(input.env.WAITLIST_DB, event);

  return {
    promotion,
    event,
    markdown: buildRuntimeResearchPromotionMarkdown(promotion),
  };
}

export async function listRuntimeResearchPromotionWorkflow(input: {
  env: Env;
  promotionId?: string;
  subjectKind?: "strategy" | "venue" | "asset";
  subjectKey?: string;
  limit?: number;
}): Promise<{
  promotions: Awaited<ReturnType<typeof listStrategyLabPromotions>>;
  events: Awaited<ReturnType<typeof listStrategyLabPromotionEvents>> | null;
}> {
  if (input.promotionId) {
    const promotion = await getStrategyLabPromotion(
      input.env.WAITLIST_DB,
      input.promotionId,
    );
    if (!promotion) {
      return {
        promotions: [],
        events: null,
      };
    }
    return {
      promotions: [promotion],
      events: await listStrategyLabPromotionEvents(
        input.env.WAITLIST_DB,
        input.promotionId,
      ),
    };
  }

  return {
    promotions: await listStrategyLabPromotions(input.env.WAITLIST_DB, {
      subjectKind: input.subjectKind,
      subjectKey: input.subjectKey,
      limit: input.limit,
    }),
    events: null,
  };
}

async function hydratePromotionRequest(input: {
  env: Env;
  request: RuntimeResearchPromotionRequest;
}): Promise<RuntimeResearchPromotionRequest> {
  if (
    input.request.runtimeScorecard ||
    !input.request.deployment ||
    (input.request.targetState !== "paper" &&
      input.request.targetState !== "limited_live")
  ) {
    return input.request;
  }

  const scorecardResponse = await readRuntimeScorecard(
    input.env,
    input.request.deployment.deploymentId,
  );
  if (!scorecardResponse.ok) {
    return input.request;
  }

  const promotionGates = readScorecardPromotionGates(
    scorecardResponse.payload.report,
  );
  return {
    ...input.request,
    runtimeScorecard: {
      promotionGates,
    },
  };
}

function readScorecardPromotionGates(value: unknown): RuntimeScorecardGate[] {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as { promotionGates?: unknown[] }).promotionGates)
  ) {
    return [];
  }
  return ((value as { promotionGates?: unknown[] }).promotionGates ?? []).map(
    (entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return {};
      }
      const sourceMode =
        typeof (entry as { sourceMode?: unknown }).sourceMode === "string"
          ? String((entry as { sourceMode?: unknown }).sourceMode)
          : undefined;
      const targetMode =
        typeof (entry as { targetMode?: unknown }).targetMode === "string"
          ? String((entry as { targetMode?: unknown }).targetMode)
          : undefined;
      const status =
        typeof (entry as { status?: unknown }).status === "string"
          ? String((entry as { status?: unknown }).status)
          : undefined;
      return {
        ...(sourceMode ? { sourceMode } : {}),
        ...(targetMode ? { targetMode } : {}),
        ...(status ? { status } : {}),
      };
    },
  );
}

async function applyPromotionAction(input: {
  env: Env;
  action: RuntimeResearchPromotionWorkflowResult["promotion"]["actions"][number];
}): Promise<void> {
  const payload =
    input.action.payload &&
    typeof input.action.payload === "object" &&
    !Array.isArray(input.action.payload)
      ? (input.action.payload as Record<string, unknown>)
      : {};

  switch (input.action.actionType) {
    case "upsert_runtime_deployment": {
      const deployment = parseRuntimeDeploymentRecord(payload.deployment);
      const response = await upsertRuntimeDeployment(input.env, deployment);
      if (!response.ok) {
        throw new Error(
          String(
            response.payload.error ??
              "runtime-research-promotion-upsert-deployment-failed",
          ),
        );
      }
      return;
    }
    case "evaluate_runtime_deployment": {
      const deploymentId = String(payload.deploymentId ?? "").trim();
      if (!deploymentId) {
        throw new Error(
          "runtime-research-promotion-missing-evaluate-deployment",
        );
      }
      const response = await evaluateRuntimeDeployment({
        env: input.env,
        deploymentId,
        body:
          payload.body &&
          typeof payload.body === "object" &&
          !Array.isArray(payload.body)
            ? (payload.body as Record<string, unknown>)
            : {},
      });
      if (!response.ok) {
        throw new Error(
          String(
            response.payload.error ??
              "runtime-research-promotion-evaluate-deployment-failed",
          ),
        );
      }
      return;
    }
    case "apply_runtime_control": {
      const deploymentId = String(payload.deploymentId ?? "").trim();
      const action = String(payload.action ?? "").trim();
      if (!deploymentId || !["pause", "resume", "kill"].includes(action)) {
        throw new Error("runtime-research-promotion-invalid-runtime-control");
      }
      const response = await applyRuntimeDeploymentControl({
        env: input.env,
        deploymentId,
        action: action as "pause" | "resume" | "kill",
      });
      if (!response.ok) {
        throw new Error(
          String(
            response.payload.error ??
              "runtime-research-promotion-runtime-control-failed",
          ),
        );
      }
      return;
    }
    case "record_allowlist_change":
    case "record_state_transition":
      return;
  }
}
