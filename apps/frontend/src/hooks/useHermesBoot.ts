import { useCallback, useEffect, useState } from "react";
import { api, type User } from "../api";

export type HermesBootPhase = "idle" | "checking" | "preparing" | "ready" | "error";

const POLL_MS = 4000;
const MAX_POLLS = 90; // ~6 minutes (first provision can be slow)

export function useHermesBoot(user: User | null) {
  const [phase, setPhase] = useState<HermesBootPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) {
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
          if (!cancelled) setPhase("ready");
          return;
        }

        if (!cancelled) setPhase("preparing");

        for (let i = 0; i < MAX_POLLS; i++) {
          if (cancelled) return;
          const res = await api.ensureHermesInstance();
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
          setError("Your assistant is taking longer than expected. Please try again.");
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
  }, [user?.id, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { phase, error, retry };
}
