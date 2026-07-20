/** OpenAI-compatible SSE stream parser (pattern from Open WebUI streaming/index.ts).
 *  Also surfaces Hermes `event: hermes.tool.progress` for tool UX. */

export type AgentToolProgress = {
  tool: string;
  emoji?: string;
  label?: string;
  toolCallId?: string;
  status?: "running" | "completed" | string;
};

export type StreamUpdate = {
  done: boolean;
  content: string;
  error?: string;
  tool?: AgentToolProgress;
};

function parseToolProgress(payload: string): AgentToolProgress | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const tool =
      (typeof parsed.tool === "string" && parsed.tool) ||
      (typeof parsed.name === "string" && parsed.name) ||
      "";
    if (!tool) return null;
    const statusRaw = typeof parsed.status === "string" ? parsed.status : "running";
    const status =
      statusRaw === "completed" || statusRaw === "done" || statusRaw === "complete"
        ? "completed"
        : statusRaw === "running" || statusRaw === "start" || statusRaw === "started"
          ? "running"
          : statusRaw;
    return {
      tool,
      emoji: typeof parsed.emoji === "string" ? parsed.emoji : undefined,
      label:
        (typeof parsed.label === "string" && parsed.label) ||
        (typeof parsed.preview === "string" && parsed.preview) ||
        undefined,
      toolCallId:
        (typeof parsed.toolCallId === "string" && parsed.toolCallId) ||
        (typeof parsed.tool_call_id === "string" && parsed.tool_call_id) ||
        (typeof parsed.id === "string" && parsed.id) ||
        undefined,
      status,
    };
  } catch {
    return null;
  }
}

function parseContentDelta(payload: string): { content: string; error?: string; done?: boolean } {
  if (!payload || payload === "[DONE]") return { content: "", done: payload === "[DONE]" };
  try {
    const parsed = JSON.parse(payload);
    if (parsed.error) {
      const msg =
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error.message || JSON.stringify(parsed.error);
      return { content: "", error: msg, done: true };
    }

    const delta = parsed.choices?.[0]?.delta;
    const message = parsed.choices?.[0]?.message;
    const content =
      (typeof delta?.content === "string" ? delta.content : "") ||
      (typeof delta?.text === "string" ? delta.text : "") ||
      (typeof message?.content === "string" ? message.content : "") ||
      (typeof parsed.choices?.[0]?.text === "string" ? parsed.choices[0].text : "");
    return { content };
  } catch {
    return { content: "" };
  }
}

export async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamUpdate> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      yield { done: true, content: "" };
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trimEnd();

      // Blank line ends an SSE event; reset event type to default.
      if (!trimmed) {
        eventName = "message";
        continue;
      }

      if (trimmed.startsWith("event:")) {
        eventName = trimmed.slice(6).trim() || "message";
        continue;
      }

      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload) continue;

      if (eventName === "hermes.tool.progress") {
        const tool = parseToolProgress(payload);
        if (tool) yield { done: false, content: "", tool };
        continue;
      }

      // Named events we don't understand — ignore (SSE clients must).
      if (eventName !== "message") continue;

      if (payload === "[DONE]") {
        yield { done: true, content: "" };
        return;
      }

      const parsed = parseContentDelta(payload);
      if (parsed.error) {
        yield { done: true, content: "", error: parsed.error };
        return;
      }
      if (parsed.done) {
        yield { done: true, content: "" };
        return;
      }
      if (parsed.content) {
        yield { done: false, content: parsed.content };
      }
    }
  }
}
