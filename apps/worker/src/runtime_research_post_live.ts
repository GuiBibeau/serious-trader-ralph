import {
  buildRuntimeResearchPostLiveMarkdown,
  buildRuntimeResearchPostLiveReview,
  parseRuntimeResearchPostLiveRequest,
  type RuntimeResearchPostLiveRequest,
  type RuntimeResearchPostLiveScorecardSnapshot,
} from "../../../src/runtime/research/post_live.js";
import {
  parseRuntimeAssetRecord,
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeStrategyLabPostLiveArtifact,
  parseRuntimeStrategyLabSubjectControl,
  type RuntimeDeploymentRecord,
  type RuntimeStrategyLabPostLiveArtifact,
  type RuntimeStrategyLabSubjectControl,
} from "./runtime_contracts";
import {
  evaluateRuntimeDeployment,
  readRuntimeAssetRegistry,
  readRuntimeCostModelRegistry,
  readRuntimeDeployment,
  readRuntimeExecutionCostObservations,
  readRuntimeScorecard,
} from "./runtime_internal";
import { runRuntimeResearchPromotionWorkflow } from "./runtime_research_promotion";
import {
  getStrategyLabPostLiveArtifact,
  listStrategyLabPostLiveArtifacts,
  writeStrategyLabPostLiveArtifact,
} from "./strategy_lab_post_live_repository";
import { listStrategyLabPromotions } from "./strategy_lab_promotion_repository";
import {
  getStrategyLabSubjectControl,
  listStrategyLabReadinessArtifacts,
  listStrategyLabReadinessCanaryRuns,
  writeStrategyLabSubjectControl,
} from "./strategy_lab_readiness_repository";
import type { Env } from "./types";

type RuntimeResearchPostLiveWorkflowResult = {
  artifact: RuntimeStrategyLabPostLiveArtifact;
  markdown: string;
  promotion?: Awaited<
    ReturnType<typeof runRuntimeResearchPromotionWorkflow>
  >["promotion"];
  event?: Awaited<
    ReturnType<typeof runRuntimeResearchPromotionWorkflow>
  >["event"];
  control?: RuntimeStrategyLabSubjectControl;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function requireRuntimeInternalPayload(
  resultPromise: Promise<{ ok: boolean; payload: Record<string, unknown> }>,
  errorCode: string,
): Promise<Record<string, unknown>> {
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(String(result.payload.error ?? errorCode));
  }
  return result.payload;
}

function parseRuntimeAssetRecords(payload: Record<string, unknown>) {
  const raw =
    isRecord(payload.registry) && Array.isArray(payload.registry.assets)
      ? payload.registry.assets
      : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeAssetRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is ReturnType<typeof parseRuntimeAssetRecord> =>
        entry !== null,
    );
}

function parseRuntimeCostModels(payload: Record<string, unknown>) {
  const raw =
    isRecord(payload.registry) && Array.isArray(payload.registry.costModels)
      ? payload.registry.costModels
      : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeExecutionCostModelRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (
        entry,
      ): entry is ReturnType<typeof parseRuntimeExecutionCostModelRecord> =>
        entry !== null,
    );
}

function parseRuntimeCostObservations(payload: Record<string, unknown>) {
  const raw =
    isRecord(payload.registry) &&
    Array.isArray(payload.registry.costObservations)
      ? payload.registry.costObservations
      : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeExecutionCostObservationRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (
        entry,
      ): entry is ReturnType<
        typeof parseRuntimeExecutionCostObservationRecord
      > => entry !== null,
    );
}

function selectLatestByUpdatedAt<T extends { updatedAt?: string }>(
  entries: T[],
): T | null {
  const [first] = [...entries].sort((left, right) =>
    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
  );
  return first ?? null;
}

function selectLatestByObservedAt<T extends { observedAt?: string }>(
  entries: T[],
): T | null {
  const [first] = [...entries].sort((left, right) =>
    String(right.observedAt ?? "").localeCompare(String(left.observedAt ?? "")),
  );
  return first ?? null;
}

function selectLatestByStartedAt<T extends { startedAt?: string }>(
  entries: T[],
): T | null {
  const [first] = [...entries].sort((left, right) =>
    String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")),
  );
  return first ?? null;
}

function parseScorecardSnapshot(
  payload: Record<string, unknown>,
): RuntimeResearchPostLiveScorecardSnapshot | null {
  const report = isRecord(payload.report) ? payload.report : null;
  const scorecard = isRecord(report?.scorecard) ? report.scorecard : null;
  const expectedVsObserved = isRecord(scorecard?.expectedVsObserved)
    ? scorecard.expectedVsObserved
    : null;
  const pnl = isRecord(scorecard?.pnl) ? scorecard.pnl : null;
  const cost = isRecord(scorecard?.cost) ? scorecard.cost : null;
  const featureCatalog = isRecord(scorecard?.featureCatalog)
    ? scorecard.featureCatalog
    : null;
  const deploymentId =
    stringOrNull(payload.deploymentId) ?? stringOrNull(report?.deploymentId);
  if (!deploymentId || !scorecard) {
    return null;
  }

  return {
    deploymentId,
    failedRunCount: numberValue(expectedVsObserved?.failedRunCount, 0),
    manualReviewRunCount: numberValue(
      expectedVsObserved?.manualReviewRunCount,
      0,
    ),
    driftAlertCount: numberValue(expectedVsObserved?.driftAlertCount, 0),
    ...(stringOrNull(pnl?.totalPnlUsd)
      ? { totalPnlUsd: stringOrNull(pnl?.totalPnlUsd) as string }
      : {}),
    ...(stringOrNull(pnl?.maxDrawdownUsd)
      ? { maxDrawdownUsd: stringOrNull(pnl?.maxDrawdownUsd) as string }
      : {}),
    ...(Number.isFinite(Number(cost?.costDriftBps))
      ? { costDriftBps: numberValue(cost?.costDriftBps, 0) }
      : {}),
    ...(Number.isFinite(Number(cost?.latencyDriftMs))
      ? { latencyDriftMs: numberValue(cost?.latencyDriftMs, 0) }
      : {}),
    ...(Number.isFinite(Number(featureCatalog?.maxObservedFeatureAgeMs))
      ? {
          maxObservedFeatureAgeMs: numberValue(
            featureCatalog?.maxObservedFeatureAgeMs,
            0,
          ),
        }
      : {}),
    ...(Number.isFinite(Number(featureCatalog?.freshnessSloMs))
      ? { freshnessSloMs: numberValue(featureCatalog?.freshnessSloMs, 0) }
      : {}),
    ...(Number.isFinite(Number(featureCatalog?.featureDefinitionCoverageBps))
      ? {
          featureDefinitionCoverageBps: numberValue(
            featureCatalog?.featureDefinitionCoverageBps,
            0,
          ),
        }
      : {}),
    ...(Number.isFinite(Number(featureCatalog?.regimeTagCoverageBps))
      ? {
          regimeTagCoverageBps: numberValue(
            featureCatalog?.regimeTagCoverageBps,
            0,
          ),
        }
      : {}),
    missingFeatureKeys: Array.isArray(featureCatalog?.missingFeatureKeys)
      ? featureCatalog.missingFeatureKeys.map((value) => String(value))
      : [],
    missingRegimeKeys: Array.isArray(featureCatalog?.missingRegimeKeys)
      ? featureCatalog.missingRegimeKeys.map((value) => String(value))
      : [],
  };
}

function buildFollowUpDeployment(input: {
  deployment: RuntimeDeploymentRecord;
  targetState: "paper" | "limited_live" | "paused";
}): RuntimeDeploymentRecord {
  const nowIso = new Date().toISOString();
  const next: Record<string, unknown> = {
    ...input.deployment,
    updatedAt: nowIso,
    tags: Array.from(
      new Set([...(input.deployment.tags ?? []), "strategy-lab", "post-live"]),
    ),
  };

  delete next.pausedAt;
  delete next.killedAt;

  if (input.targetState === "paper") {
    next.mode = "paper";
    next.state = "paper";
  } else if (input.targetState === "limited_live") {
    next.mode = "live";
    next.state = "live";
  } else {
    next.mode = input.deployment.mode;
    next.state = "paused";
    next.pausedAt = nowIso;
  }

  return parseRuntimeDeploymentRecord(next);
}

async function hydratePostLiveContext(input: {
  env: Env;
  request: RuntimeResearchPostLiveRequest;
}): Promise<{
  context: RuntimeResearchPostLiveContext;
  deployment: RuntimeDeploymentRecord | null;
}> {
  let deployment: RuntimeDeploymentRecord | null = null;
  let venueKey = input.request.venueKey ?? null;
  let assetKey = input.request.assetKey ?? null;
  let pairSymbol = input.request.pairSymbol ?? null;

  if (input.request.deploymentId) {
    const deploymentPayload = await requireRuntimeInternalPayload(
      readRuntimeDeployment(input.env, input.request.deploymentId),
      "runtime-research-post-live-deployment-read-failed",
    );
    const parsedDeployment = parseRuntimeDeploymentRecord(
      deploymentPayload.deployment,
    );
    deployment = parsedDeployment;
    venueKey = venueKey ?? parsedDeployment.venueKey;
    pairSymbol = pairSymbol ?? parsedDeployment.pair.symbol;
    assetKey = assetKey ?? parsedDeployment.pair.symbol.split("/", 1)[0];
  }

  const latestPromotion =
    (
      await listStrategyLabPromotions(input.env.WAITLIST_DB, {
        subjectKind: input.request.subjectKind,
        subjectKey: input.request.subjectKey,
        limit: 1,
      })
    )[0] ?? null;

  const venueControl = venueKey
    ? await getStrategyLabSubjectControl(
        input.env.WAITLIST_DB,
        "venue",
        venueKey,
      )
    : null;
  const assetControl = assetKey
    ? await getStrategyLabSubjectControl(
        input.env.WAITLIST_DB,
        "asset",
        assetKey,
      )
    : null;

  let assetRecord: RuntimeAssetRecord | null = null;
  if (assetKey) {
    const assetPayload = await requireRuntimeInternalPayload(
      readRuntimeAssetRegistry({
        env: input.env,
        assetKey,
        ...(venueKey ? { venueKey } : {}),
      }),
      "runtime-research-post-live-asset-registry-read-failed",
    );
    assetRecord =
      parseRuntimeAssetRecords(assetPayload).find(
        (record) => record.assetKey === assetKey,
      ) ?? null;
  }

  const readinessSubjectKind =
    input.request.subjectKind === "strategy"
      ? "asset"
      : input.request.subjectKind;
  const readinessSubjectKey =
    input.request.subjectKind === "strategy"
      ? assetKey
      : input.request.subjectKey;
  const latestReadinessArtifact =
    readinessSubjectKey && readinessSubjectKind
      ? ((
          await listStrategyLabReadinessArtifacts(input.env.WAITLIST_DB, {
            subjectKind: readinessSubjectKind,
            subjectKey: readinessSubjectKey,
            limit: 1,
          })
        )[0] ?? null)
      : null;
  const latestCanaryRun =
    readinessSubjectKey && readinessSubjectKind
      ? selectLatestByStartedAt(
          await listStrategyLabReadinessCanaryRuns(input.env.WAITLIST_DB, {
            subjectKind: readinessSubjectKind,
            subjectKey: readinessSubjectKey,
            limit: 5,
          }),
        )
      : null;

  const scorecard =
    input.request.subjectKind === "strategy" && input.request.deploymentId
      ? await (async () => {
          if (input.request.refreshEvaluation !== false) {
            await requireRuntimeInternalPayload(
              evaluateRuntimeDeployment({
                env: input.env,
                deploymentId: input.request.deploymentId,
                body: {
                  trigger: {
                    kind: "operator",
                    source: "strategy-lab-post-live",
                    reason: "monitor",
                  },
                },
              }),
              "runtime-research-post-live-evaluate-failed",
            );
          }
          const payload = await requireRuntimeInternalPayload(
            readRuntimeScorecard(input.env, input.request.deploymentId),
            "runtime-research-post-live-scorecard-read-failed",
          );
          return parseScorecardSnapshot(payload);
        })()
      : null;

  let latestCostModel: RuntimeExecutionCostModelRecord | null = null;
  let latestCostObservation: RuntimeExecutionCostObservationRecord | null =
    null;
  if (venueKey && assetKey && pairSymbol) {
    const costModelPayload = await requireRuntimeInternalPayload(
      readRuntimeCostModelRegistry({
        env: input.env,
        venueKey,
        assetKey,
        pairSymbol,
      }),
      "runtime-research-post-live-cost-model-read-failed",
    );
    latestCostModel = selectLatestByUpdatedAt(
      parseRuntimeCostModels(costModelPayload),
    );

    const costObservationPayload = await requireRuntimeInternalPayload(
      readRuntimeExecutionCostObservations({
        env: input.env,
        ...(input.request.deploymentId
          ? { deploymentId: input.request.deploymentId }
          : {}),
        venueKey,
        assetKey,
        pairSymbol,
      }),
      "runtime-research-post-live-cost-observation-read-failed",
    );
    latestCostObservation = selectLatestByObservedAt(
      parseRuntimeCostObservations(costObservationPayload),
    );
  }

  return {
    deployment,
    context: {
      currentState:
        input.request.currentState ?? latestPromotion?.targetState ?? undefined,
      scorecard,
      latestCostModel,
      latestCostObservation,
      latestReadinessArtifact,
      latestCanaryRun,
      venueControl,
      assetControl,
      assetRecord,
      linkedPromotionId: latestPromotion?.promotionId ?? null,
      linkedControlRef: assetControl
        ? `asset:${assetControl.subjectKey}`
        : venueControl
          ? `venue:${venueControl.subjectKey}`
          : null,
    },
  };
}

export async function runRuntimeResearchPostLiveWorkflow(input: {
  env: Env;
  request: RuntimeResearchPostLiveRequest;
}): Promise<RuntimeResearchPostLiveWorkflowResult> {
  const { context, deployment } = await hydratePostLiveContext(input);
  let { artifact, markdown } = buildRuntimeResearchPostLiveReview({
    request: input.request,
    context,
  });

  let promotion:
    | Awaited<
        ReturnType<typeof runRuntimeResearchPromotionWorkflow>
      >["promotion"]
    | undefined;
  let event:
    | Awaited<ReturnType<typeof runRuntimeResearchPromotionWorkflow>>["event"]
    | undefined;
  let control: RuntimeStrategyLabSubjectControl | undefined;

  if (
    input.request.applyAction === true &&
    artifact.recommendedAction !== "observe" &&
    artifact.recommendedAction !== "revalidate"
  ) {
    if (input.request.subjectKind === "strategy") {
      const targetState =
        artifact.recommendedTargetState ??
        (artifact.recommendedAction === "pause" ? "paused" : "paper");
      const sourceDeployment =
        deployment ??
        parseRuntimeDeploymentRecord({
          schemaVersion: "v1",
          deploymentId: input.request.deploymentId ?? input.request.subjectKey,
          strategyKey: input.request.subjectKey,
          sleeveId: "sleeve_alpha",
          ownerUserId: "user_runtime_fixture",
          venueKey: input.request.venueKey ?? "jupiter",
          pair: {
            symbol: input.request.pairSymbol ?? "SOL/USDC",
            baseMint: "So11111111111111111111111111111111111111112",
            quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          },
          mode: "live",
          state: "live",
          lane: "safe",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          policy: {
            maxNotionalUsd: "25",
            dailyLossLimitUsd: "10",
            maxSlippageBps: 50,
            maxConcurrentRuns: 1,
            rebalanceToleranceBps: 100,
          },
          capital: {
            allocatedUsd: "100",
            reservedUsd: "5",
            availableUsd: "95",
          },
          tags: ["strategy-lab", "post-live"],
        });

      const promotionResult = await runRuntimeResearchPromotionWorkflow({
        env: input.env,
        request: {
          subjectKind: "strategy",
          subjectKey: input.request.subjectKey,
          currentState: artifact.currentState ?? "limited_live",
          targetState,
          requestedBy: input.request.requestedBy,
          ...(input.request.issueNumber
            ? { issueNumber: input.request.issueNumber }
            : {}),
          evidenceRefs: [
            ...artifact.evidenceRefs,
            {
              kind: "post_live_review",
              ref: artifact.postLiveId,
            },
          ],
          deployment: buildFollowUpDeployment({
            deployment: sourceDeployment,
            targetState:
              targetState === "paused"
                ? "paused"
                : targetState === "limited_live"
                  ? "limited_live"
                  : "paper",
          }),
          applyTransition: true,
          metadata: {
            source: "strategy-lab-post-live",
            recommendedAction: artifact.recommendedAction,
          },
        },
      });
      promotion = promotionResult.promotion;
      event = promotionResult.event;
      artifact = parseRuntimeStrategyLabPostLiveArtifact({
        ...artifact,
        status: "applied",
        appliedAction: artifact.recommendedAction,
        ...(artifact.recommendedTargetState
          ? { appliedTargetState: artifact.recommendedTargetState }
          : {}),
        followUpPromotionId: promotion.promotionId,
        appliedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const nowIso = new Date().toISOString();
      const nextControl = parseRuntimeStrategyLabSubjectControl({
        schemaVersion: "v1",
        subjectKind: input.request.subjectKind,
        subjectKey: input.request.subjectKey,
        liveAllowed: false,
        killSwitchEnabled: true,
        disabledReason: `post-live-drift:${artifact.postLiveId}`,
        updatedAt: nowIso,
        updatedBy: input.request.requestedBy,
        metadata: {
          source: "strategy-lab-post-live",
          pairSymbol: input.request.pairSymbol ?? null,
        },
      });
      control = await writeStrategyLabSubjectControl(
        input.env.WAITLIST_DB,
        nextControl,
      );
      artifact = parseRuntimeStrategyLabPostLiveArtifact({
        ...artifact,
        status: "applied",
        appliedAction: "disable_subject",
        followUpControlRef: `${control.subjectKind}:${control.subjectKey}`,
        appliedAt: nowIso,
        updatedAt: nowIso,
      });
    }
    markdown = buildRuntimeResearchPostLiveMarkdown(artifact);
  }

  await writeStrategyLabPostLiveArtifact(input.env.WAITLIST_DB, artifact);

  return {
    artifact,
    markdown,
    ...(promotion ? { promotion } : {}),
    ...(event ? { event } : {}),
    ...(control ? { control } : {}),
  };
}

export async function listRuntimeResearchPostLiveWorkflow(input: {
  env: Env;
  postLiveId?: string;
  subjectKind?: "strategy" | "venue" | "asset";
  subjectKey?: string;
  limit?: number;
}): Promise<{
  artifacts: RuntimeStrategyLabPostLiveArtifact[];
}> {
  if (input.postLiveId) {
    const artifact = await getStrategyLabPostLiveArtifact(
      input.env.WAITLIST_DB,
      input.postLiveId,
    );
    return {
      artifacts: artifact ? [artifact] : [],
    };
  }

  return {
    artifacts: await listStrategyLabPostLiveArtifacts(input.env.WAITLIST_DB, {
      subjectKind: input.subjectKind,
      subjectKey: input.subjectKey,
      limit: input.limit,
    }),
  };
}

export { parseRuntimeResearchPostLiveRequest };
