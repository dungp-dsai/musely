import { useCallback, useEffect, useState } from "react";
import { api, type User } from "../api";

export type MuselyAgentBootPhase = "idle" | "checking" | "preparing" | "ready" | "error";
export type MuselyAgentBootMode = "first" | "wakeup";

/** Expected first boot ~60s; wake-up ~25s. Creeps toward 99% after that, never 100% while loading. */
export const BOOT_PROGRESS_CAP = 99;
const BOOT_EXPECTED_MS = { first: 60_000, wakeup: 25_000 } as const;

export function computeBootProgress(
  elapsedMs: number,
  mode: MuselyAgentBootMode = "first"
): number {
  const expectedMs = BOOT_EXPECTED_MS[mode];
  if (elapsedMs <= expectedMs) {
    const t = elapsedMs / expectedMs;
    return Math.min(BOOT_PROGRESS_CAP, Math.floor((1 - (1 - t) ** 2) * 85));
  }
  const extra = elapsedMs - expectedMs;
  const creep = 85 + 14 * (1 - Math.exp(-extra / 120_000));
  return Math.min(BOOT_PROGRESS_CAP, Math.floor(creep));
}

export function useMuselyAgentBoot(user: User | null, enabled = true) {
  const [phase, setPhase] = useState<MuselyAgentBootPhase>("idle");
  const [bootMode, setBootMode] = useState<MuselyAgentBootMode>("first");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user || !enabled) {
      setPhase("idle");
      setBootMode("first");
      setError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setPhase("checking");
      setError(null);

      try {
        const [config, instanceStatus] = await Promise.all([
          api.getConfig(),
          api.getInstanceStatus().catch(() => ({ orchestrator: true, state: "missing" as const })),
        ]);

        // The agent already exists for this user (i.e. any login after the very
        // first one). "missing" means it has never been provisioned.
        const agentExists =
          instanceStatus.orchestrator && instanceStatus.state !== "missing";

        if (!cancelled) setBootMode(agentExists ? "wakeup" : "first");

        if (!config.orchestratorEnabled) {
          const missing = (config as { orchestratorMissing?: string[] }).orchestratorMissing;
          if (missing?.length) {
            if (!cancelled) {
              setError(
                `Musely agent orchestrator is not configured (missing: ${missing.join(", ")}).`
              );
              setPhase("error");
            }
            return;
          }
          if (!cancelled) setPhase("ready");
          return;
        }

        // Returning users: don't eagerly wake the agent on login (no wake-up
        // screen). It's woken lazily by the first activity that needs it
        // (feed refresh, chat, …), which surfaces its own progress UI.
        if (agentExists) {
          if (!cancelled) setPhase("ready");
          return;
        }

        // First-time only: provision the brand-new agent now.
        if (!cancelled) setPhase("preparing");

        const res = await api.ensureMuselyAgentInstance();
        if (cancelled) return;
        if (res.ready) {
          setPhase("ready");
          return;
        }
        if (res.error) {
          setError(res.error);
          setPhase("error");
          return;
        }

        if (!cancelled) {
          setError("Your Musely agent is taking longer than expected. Please try again.");
          setPhase("error");
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, enabled, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { phase, bootMode, error, retry, attempt };
}
