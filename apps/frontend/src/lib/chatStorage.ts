export type ChatRole = "user" | "assistant" | "system";
export type ChatMessage = { role: ChatRole; content: string };
export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
};

const LEGACY_KEY = "writer-app-hermes-chats";

function storageKey(userId: number) {
  return `musely-agent-chats-u${userId}`;
}

function legacyStorageKey(userId: number) {
  return `writer-app-hermes-chats-u${userId}`;
}

export function loadConversations(userId: number): Conversation[] {
  try {
    const raw =
      localStorage.getItem(storageKey(userId)) ??
      localStorage.getItem(legacyStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function saveConversations(userId: number, list: Conversation[]) {
  localStorage.setItem(storageKey(userId), JSON.stringify(list.slice(0, 50)));
}

/** Drop legacy shared key so older builds don't leak chats across users. */
export function clearLegacySharedChats() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

export function newConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    updatedAt: Date.now(),
  };
}

export function titleFromFirstMessage(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "New chat";
}
