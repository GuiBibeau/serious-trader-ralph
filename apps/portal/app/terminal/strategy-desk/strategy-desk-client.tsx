"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState, useTransition } from "react";
import { StrategyDeskView } from "./strategy-desk-view";
import {
  type StrategyDeskApiPayload,
  type StrategyDeskExecuteRunKind,
  type StrategyDeskMutationResult,
  type StrategyDeskStudyRunKind,
  type StrategyDeskStudySelectionMetric,
  selectStrategyDeskHandoffForAction,
} from "./types";

async function readJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

async function fetchStrategyDeskPayload(input: {
  accessToken: string;
  scenarioId?: string;
}): Promise<StrategyDeskApiPayload> {
  const query = input.scenarioId
    ? `?scenarioId=${encodeURIComponent(input.scenarioId)}`
    : "";
  const response = await fetch(`/api/runtime/strategy-desk${query}`, {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
    },
    cache: "no-store",
  });
  const body = await readJson<StrategyDeskApiPayload & { error?: string }>(
    response,
  );
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error ?? `http-${response.status}`);
  }
  return body;
}

function draftStateFromPayload(payload: StrategyDeskApiPayload): {
  editorValue: string;
  walletAddress: string;
} {
  const scenario = payload.snapshot.selectedScenario;
  if (scenario) {
    const nextDraft = JSON.stringify(scenario, null, 2);
    return {
      editorValue: nextDraft,
      walletAddress: detectWalletAddressFromDraft(nextDraft),
    };
  }
  const nextDraft = defaultScenarioDraft();
  return {
    editorValue: nextDraft,
    walletAddress: detectWalletAddressFromDraft(nextDraft),
  };
}

function defaultScenarioDraft(): string {
  return JSON.stringify(
    {
      schemaVersion: "v1",
      scenarioId: "desk_new_strategy",
      title: "New composite strategy desk scenario",
      summary:
        "Mixed spot, perp, prediction, and flash scenario staged from the portal.",
      ownerUserId: "operator_user",
      strategyKey: "strategy_desk::new_composite",
      thesis: "Start with a primary alpha leg, then layer bounded hedges.",
      state: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      riskLimits: {
        maxReservedCapitalUsd: "1000",
        maxGrossExposureUsd: "2500",
        maxNetExposureUsd: "1000",
      },
      legs: [
        {
          legId: "leg_spot_alpha",
          label: "Spot alpha",
          role: "primary_alpha",
          venueKey: "jupiter",
          intentFamily: "spot_swap",
          marketType: "spot",
          pair: {
            symbol: "SOL/USDC",
            baseMint: "So11111111111111111111111111111111111111112",
            quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            marketType: "spot",
          },
          assetKeys: ["SOL", "USDC"],
          enabledModes: ["shadow", "paper"],
          sizing: {
            targetNotionalUsd: "500",
            maxNotionalUsd: "1000",
            reserveUsd: "250",
            maxSlippageBps: 50,
          },
          intent: {
            side: "buy",
          },
        },
      ],
      evidence: [],
      implementationReferences: [],
      tags: ["strategy-desk", "draft"],
      metadata: {
        operatorWalletAddress: "11111111111111111111111111111111",
      },
    },
    null,
    2,
  );
}

function detectWalletAddressFromDraft(draft: string): string {
  try {
    const parsed = JSON.parse(draft) as Record<string, unknown>;
    const metadata =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed.metadata
        : null;
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const metadataRecord = metadata as Record<string, unknown>;
      if (typeof metadataRecord.operatorWalletAddress === "string") {
        return metadataRecord.operatorWalletAddress.trim();
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function StrategyDeskClient() {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const [payload, setPayload] = useState<StrategyDeskApiPayload | null>(null);
  const [editorValue, setEditorValue] = useState<string>(defaultScenarioDraft);
  const [walletAddress, setWalletAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const requestedBy =
    String(
      (user as { id?: string } | null | undefined)?.id ??
        "portal.strategy-desk",
    ).trim() || "portal.strategy-desk";

  async function loadStrategyDesk(scenarioId?: string) {
    const token = await getAccessToken();
    if (!token) {
      setPayload(null);
      setError("operator-auth-token-unavailable");
      return;
    }
    const body = await fetchStrategyDeskPayload({
      accessToken: token,
      scenarioId,
    });
    const nextDraftState = draftStateFromPayload(body);
    setPayload(body);
    setEditorValue(nextDraftState.editorValue);
    setWalletAddress(nextDraftState.walletAddress);
    setError(null);
  }

  function patchDraft(mutator: (draft: Record<string, unknown>) => void) {
    try {
      const parsed = JSON.parse(editorValue) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("strategy-desk-editor-not-object");
      }
      mutator(parsed);
      const nextDraft = JSON.stringify(parsed, null, 2);
      setEditorValue(nextDraft);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "strategy-desk-editor-parse-failed",
      );
    }
  }

  async function runAction(
    requestBody: Record<string, unknown>,
    actionKey: string,
    scenarioId?: string,
  ) {
    const token = await getAccessToken();
    if (!token) {
      setError("operator-auth-token-unavailable");
      return null;
    }

    setActionPending(actionKey);
    try {
      const response = await fetch("/api/runtime/strategy-desk", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const body = await readJson<StrategyDeskMutationResult>(response);
      if (!response.ok || body?.ok === false) {
        setError(body?.error ?? `http-${response.status}`);
        return null;
      }
      const nextScenarioId =
        scenarioId ??
        body?.scenario?.scenarioId ??
        payload?.snapshot.selectedScenarioId ??
        undefined;
      await loadStrategyDesk(nextScenarioId);
      return body;
    } finally {
      setActionPending(null);
    }
  }

  async function prepareHandoff() {
    const scenarioId = payload?.snapshot.selectedScenarioId;
    if (!scenarioId) {
      setError("strategy-desk-scenario-required");
      return;
    }
    await runAction(
      {
        action: "prepare_handoff",
        scenarioId,
        requestedBy,
        targetMode: "limited_live",
      },
      "handoff:prepare",
      scenarioId,
    );
  }

  async function transitionHandoff(
    action:
      | "submit"
      | "approve"
      | "reject"
      | "apply"
      | "pause"
      | "kill"
      | "demote"
      | "archive",
  ) {
    const scenarioId = payload?.snapshot.selectedScenarioId;
    const handoffId = selectStrategyDeskHandoffForAction(
      payload?.snapshot,
      action,
    )?.handoffId;
    if (!scenarioId || !handoffId) {
      setError("strategy-desk-handoff-required");
      return;
    }
    await runAction(
      {
        action: "transition_handoff",
        handoffId,
        handoffAction: action,
        actor: requestedBy,
      },
      `handoff:${action}`,
      scenarioId,
    );
  }

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setPayload(null);
      setError(null);
      return;
    }

    let cancelled = false;
    startTransition(() => {
      void getAccessToken()
        .then((token) => {
          if (!token) {
            setPayload(null);
            setError("operator-auth-token-unavailable");
            return null;
          }
          return fetchStrategyDeskPayload({ accessToken: token });
        })
        .then((nextPayload) => {
          if (cancelled || !nextPayload) return;
          const nextDraftState = draftStateFromPayload(nextPayload);
          setPayload(nextPayload);
          setEditorValue(nextDraftState.editorValue);
          setWalletAddress(nextDraftState.walletAddress);
          setError(null);
        })
        .catch((cause) => {
          if (cancelled) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "strategy-desk-load-failed",
          );
        });
    });

    return () => {
      cancelled = true;
    };
  }, [authenticated, ready, getAccessToken]);

  return (
    <StrategyDeskView
      authenticated={authenticated}
      loading={!ready || isPending}
      error={error}
      payload={payload}
      editorValue={editorValue}
      walletAddress={walletAddress}
      actionPending={actionPending}
      onRefresh={() => {
        startTransition(() => {
          void loadStrategyDesk(
            payload?.snapshot.selectedScenarioId ?? undefined,
          ).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "strategy-desk-refresh-failed",
            );
          });
        });
      }}
      onSelectScenario={(scenarioId) => {
        startTransition(() => {
          void loadStrategyDesk(scenarioId).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "strategy-desk-select-failed",
            );
          });
        });
      }}
      onEditorChange={setEditorValue}
      onTitleChange={(title) => {
        patchDraft((draft) => {
          draft.title = title;
          draft.updatedAt = new Date().toISOString();
        });
      }}
      onSummaryChange={(summary) => {
        patchDraft((draft) => {
          draft.summary = summary;
          draft.updatedAt = new Date().toISOString();
        });
      }}
      onWalletAddressChange={(nextWalletAddress) => {
        setWalletAddress(nextWalletAddress);
        patchDraft((draft) => {
          const metadata =
            draft.metadata &&
            typeof draft.metadata === "object" &&
            !Array.isArray(draft.metadata)
              ? (draft.metadata as Record<string, unknown>)
              : {};
          metadata.operatorWalletAddress = nextWalletAddress;
          draft.metadata = metadata;
          draft.updatedAt = new Date().toISOString();
        });
      }}
      onResetEditor={() => {
        const scenario = payload?.snapshot.selectedScenario;
        if (scenario) {
          const nextDraft = JSON.stringify(scenario, null, 2);
          setEditorValue(nextDraft);
          setWalletAddress(detectWalletAddressFromDraft(nextDraft));
          return;
        }
        const nextDraft = defaultScenarioDraft();
        setEditorValue(nextDraft);
        setWalletAddress(detectWalletAddressFromDraft(nextDraft));
      }}
      onSaveScenario={() => {
        startTransition(() => {
          let scenario: Record<string, unknown>;
          try {
            scenario = JSON.parse(editorValue) as Record<string, unknown>;
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "strategy-desk-editor-parse-failed",
            );
            return;
          }
          if (walletAddress) {
            const metadata =
              scenario.metadata &&
              typeof scenario.metadata === "object" &&
              !Array.isArray(scenario.metadata)
                ? (scenario.metadata as Record<string, unknown>)
                : {};
            metadata.operatorWalletAddress = walletAddress;
            scenario.metadata = metadata;
          }
          void runAction(
            {
              action: "upsert_scenario",
              scenario,
            },
            "upsert_scenario",
            String(scenario.scenarioId ?? ""),
          ).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "strategy-desk-save-failed",
            );
          });
        });
      }}
      onRunStudy={(
        runKind: StrategyDeskStudyRunKind,
        selectionMetric?: StrategyDeskStudySelectionMetric,
      ) => {
        const scenarioId = payload?.snapshot.selectedScenarioId;
        if (!scenarioId) return;
        startTransition(() => {
          void runAction(
            {
              action: "study_scenario",
              scenarioId,
              runKind,
              requestedBy,
              ...(selectionMetric ? { selectionMetric } : {}),
            },
            `study:${runKind}`,
            scenarioId,
          ).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "strategy-desk-study-failed",
            );
          });
        });
      }}
      onRunExecute={(runKind: StrategyDeskExecuteRunKind) => {
        const scenarioId = payload?.snapshot.selectedScenarioId;
        if (!scenarioId) return;
        startTransition(() => {
          void runAction(
            {
              action: "execute_scenario",
              scenarioId,
              runKind,
              requestedBy,
              walletAddress,
              trigger: {
                reason: "portal-strategy-desk",
              },
            },
            `execute:${runKind}`,
            scenarioId,
          ).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "strategy-desk-execute-failed",
            );
          });
        });
      }}
      onPrepareHandoff={() => {
        startTransition(() => {
          void prepareHandoff().catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "strategy-desk-handoff-prepare-failed",
            );
          });
        });
      }}
      onTransitionHandoff={(action) => {
        startTransition(() => {
          void transitionHandoff(action).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "strategy-desk-handoff-transition-failed",
            );
          });
        });
      }}
    />
  );
}
