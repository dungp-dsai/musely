type Props = {
  userId: number;
  onBack: () => void;
};

/** Minimal chat shell — full UI can be expanded later. */
export default function MuselyAgentChat({ onBack }: Props) {
  return (
    <div className="musely-agent-chat">
      <header className="chat-header">
        <button type="button" className="musely-agent-chat-link" onClick={onBack}>
          ← Back
        </button>
        <h1>Musely Agent</h1>
      </header>
      <p className="admin-muted">Chat UI loads against /api/musely-agent/chat.</p>
    </div>
  );
}
