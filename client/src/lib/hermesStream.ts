/** OpenAI-compatible SSE stream parser (pattern from Open WebUI streaming/index.ts). */

export type StreamUpdate = {
  done: boolean;
  content: string;
  error?: string;
};

export async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamUpdate> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        yield { done: true, content: "" };
        return;
      }

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) {
          const msg =
            typeof parsed.error === "string"
              ? parsed.error
              : parsed.error.message || JSON.stringify(parsed.error);
          yield { done: true, content: "", error: msg };
          return;
        }

        const delta =
          parsed.choices?.[0]?.delta?.content ??
          parsed.choices?.[0]?.message?.content ??
          "";
        if (typeof delta === "string" && delta) {
          yield { done: false, content: delta };
        }
      } catch {
        // ignore partial JSON lines
      }
    }
  }
}
