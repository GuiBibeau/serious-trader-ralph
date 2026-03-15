"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState, useTransition } from "react";
import { RuntimeOperatorView } from "./runtime-operator-view";
import type {
  RuntimeControlAction,
  RuntimeOperatorApiPayload,
  RuntimeOperatorReadinessCanaryInput,
  RuntimeOperatorSubjectControlInput,
  RuntimeOperatorVenueTxSmokeInput,
} from "./types";

async function readJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

async function fetchRuntimeOperatorPayload(input: {
  accessToken: string;
  deploymentId?: string;
}): Promise<RuntimeOperatorApiPayload> {
  const query = input.deploymentId
    ? `?deploymentId=${encodeURIComponent(input.deploymentId)}`
    : "";
  const response = await fetch(`/api/runtime/operator${query}`, {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
    },
    cache: "no-store",
  });
  const body = await readJson<RuntimeOperatorApiPayload & { error?: string }>(
    response,
  );
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error ?? `http-${response.status}`);
  }
  return body;
}

export function RuntimeOperatorClient() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [payload, setPayload] = useState<RuntimeOperatorApiPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function loadOperatorView(deploymentId?: string) {
    const token = await getAccessToken();
    if (!token) {
      setPayload(null);
      setError("operator-auth-token-unavailable");
      return;
    }
    const body = await fetchRuntimeOperatorPayload({
      accessToken: token,
      deploymentId,
    });
    setPayload(body);
    setError(null);
  }

  async function runOperatorAction(
    requestBody: Record<string, unknown>,
    actionKey: string,
  ) {
    const token = await getAccessToken();
    if (!token) {
      setError("operator-auth-token-unavailable");
      return;
    }

    setActionPending(actionKey);
    try {
      const response = await fetch("/api/runtime/operator", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const responseBody = await readJson<{ ok?: boolean; error?: string }>(
        response,
      );
      if (!response.ok || responseBody?.ok === false) {
        setError(responseBody?.error ?? `http-${response.status}`);
        return;
      }
      await loadOperatorView(payload?.selectedDeploymentId ?? undefined);
    } finally {
      setActionPending(null);
    }
  }

  async function runControl(action: RuntimeControlAction) {
    const deploymentId = payload?.selectedDeploymentId;
    if (!deploymentId) return;
    await runOperatorAction(
      {
        deploymentId,
        action,
      },
      action,
    );
  }

  async function runSubjectControl(input: RuntimeOperatorSubjectControlInput) {
    const actionKey = `subject-control:${input.subjectKind}:${input.subjectKey}:${
      input.killSwitchEnabled === true
        ? "kill-on"
        : input.killSwitchEnabled === false
          ? "kill-off"
          : input.liveAllowed === true
            ? "live-on"
            : "live-off"
    }`;
    await runOperatorAction(
      {
        action: "update_subject_control",
        ...input,
      },
      actionKey,
    );
  }

  async function runReadinessCanary(
    input: RuntimeOperatorReadinessCanaryInput,
  ) {
    await runOperatorAction(
      {
        action: "run_readiness_canary",
        ...input,
      },
      `readiness-canary:${input.subjectKind}:${input.subjectKey}`,
    );
  }

  async function runVenueTxSmoke(input: RuntimeOperatorVenueTxSmokeInput) {
    await runOperatorAction(
      {
        action: "run_venue_tx_smoke",
        ...input,
      },
      `venue-tx-smoke:${input.subjectKey}`,
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
          return fetchRuntimeOperatorPayload({ accessToken: token });
        })
        .then((nextPayload) => {
          if (cancelled || !nextPayload) return;
          setPayload(nextPayload);
          setError(null);
        })
        .catch((cause) => {
          if (cancelled) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "runtime-operator-load-failed",
          );
        });
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, ready, getAccessToken]);

  return (
    <RuntimeOperatorView
      authenticated={authenticated}
      loading={!ready || isPending}
      error={error}
      payload={payload}
      actionPending={actionPending}
      onRefresh={() => {
        startTransition(() => {
          void loadOperatorView(
            payload?.selectedDeploymentId ?? undefined,
          ).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "runtime-operator-refresh-failed",
            );
          });
        });
      }}
      onSelectDeployment={(deploymentId) => {
        startTransition(() => {
          void loadOperatorView(deploymentId).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "runtime-operator-select-failed",
            );
          });
        });
      }}
      onControl={(action) => {
        startTransition(() => {
          void runControl(action).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "runtime-operator-control-failed",
            );
          });
        });
      }}
      onSubjectControl={(input) => {
        startTransition(() => {
          void runSubjectControl(input).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "runtime-operator-subject-control-failed",
            );
          });
        });
      }}
      onReadinessCanary={(input) => {
        startTransition(() => {
          void runReadinessCanary(input).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "runtime-operator-readiness-canary-failed",
            );
          });
        });
      }}
      onVenueTxSmoke={(input) => {
        startTransition(() => {
          void runVenueTxSmoke(input).catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "runtime-operator-venue-tx-smoke-failed",
            );
          });
        });
      }}
    />
  );
}
