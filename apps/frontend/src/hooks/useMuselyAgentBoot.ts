import { useCallback, useEffect, useState } from "react";
import { api, type User } from "../api";

export type MuselyAgentBootPhase = "idle" | "checking" | "preparing" | "ready" | "error";

const POLL_MS = 4000;
const MAX_POLLS = 90;

export function useMuselyAgentBoot(user: User | null, enabled = true) {
  const [phase, setPhase] = useState<MuselyAgentBootPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user || !enabled) {
      setPhase("idle");
      setError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setPhase("checking");
      setError(null);

      try {
        const config = await api.getConfig();
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

        if (!cancelled) setPhase("preparing");

        for (let i = 0; i < MAX_POLLS; i++) {
          if (cancelled) return;
          const res = await api.ensureMuselyAgentInstance();
          if (res.ready) {
            if (!cancelled) setPhase("ready");
            return;
          }
          if (res.error) {
            if (!cancelled) {
              setError(res.error);
              setPhase("error");
            }
            return;
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
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

  return { phase, error, retry };
}
