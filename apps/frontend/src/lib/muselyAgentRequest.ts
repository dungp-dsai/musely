import { parseOpenAIStream } from "./muselyAgentStream";
import {
  AGENT_START_TIMEOUT,
  AGENT_TASK_INCOMPLETE,
  toUserFacingError,
} from "./userFacingErrors";

const MAX_WARM_ATTEMPTS = 40;
const WARM_POLL_MS = 3000;

export type MuselyAgentStreamOptions = {
  apiBase?: string;
  path: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onWarming?: () => void;
};

/** POST to a Musely agent stream endpoint; retries on 202 while the instance starts. */
export async function streamMuselyAgentRequest({
  apiBase = "",
  path,
  body,
  signal,
  onWarming,
}: MuselyAgentStreamOptions): Promise<string> {
  let warmAttempts = 0;

  for (;;) {
    const res = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal,
      body: JSON.stringify(body),
    });

    if (res.status === 202) {
      warmAttempts += 1;
      if (warmAttempts > MAX_WARM_ATTEMPTS) {
        throw new Error(AGENT_START_TIMEOUT);
      }
      onWarming?.();
      await new Promise((r) => setTimeout(r, WARM_POLL_MS));
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      continue;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(
        toUserFacingError((errBody as { error?: string }).error, "Something went wrong. Please try again.")
      );
    }

    if (!res.body) throw new Error(AGENT_TASK_INCOMPLETE);

    let text = "";
    for await (const chunk of parseOpenAIStream(res.body)) {
      if (chunk.error) throw new Error(toUserFacingError(chunk.error, AGENT_TASK_INCOMPLETE));
      if (chunk.done) break;
      if (chunk.content) text += chunk.content;
    }

    if (!text.trim()) {
      throw new Error(AGENT_TASK_INCOMPLETE);
    }

    return text.trim();
  }
}
