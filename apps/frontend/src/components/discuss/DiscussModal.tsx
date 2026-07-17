import { useEffect, useRef, type ReactNode, type Ref } from "react";

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M3.4 20.6 21 12 3.4 3.4l.1 6.8L15 12 3.5 13.8z" />
    </svg>
  );
}

export type DiscussModalProps = {
  title: string;
  onClose: () => void;
  /** Optional actions in the header (left of close), e.g. mark done. */
  headerActions?: ReactNode;
  /** Sticky-ish context above the thread (post preview / task + findings). */
  context?: ReactNode;
  sectionLabel?: string;
  messageCount?: number;
  loading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  empty?: ReactNode;
  children: ReactNode;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  placeholder?: string;
  inputDisabled?: boolean;
  scrollRef?: Ref<HTMLDivElement>;
  endRef?: Ref<HTMLDivElement>;
};

/** Shared Facebook-style discuss shell used by Feed and Write task chat. */
export default function DiscussModal({
  title,
  onClose,
  headerActions,
  context,
  sectionLabel = "Discussion",
  messageCount,
  loading,
  loadingLabel = "Loading…",
  error,
  empty,
  children,
  input,
  onInputChange,
  onSend,
  sending,
  placeholder = "Write a comment…",
  inputDisabled,
  scrollRef,
  endRef,
}: DiscussModalProps) {
  const localScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = Boolean(input.trim()) && !sending && !inputDisabled;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="feed-discuss-overlay" onClick={onClose} role="presentation">
      <div
        className="feed-discuss-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discuss-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="feed-discuss-head">
          <h2 id="discuss-modal-title" className="feed-discuss-head-title">
            {title}
          </h2>
          <div className="feed-discuss-head-actions">
            {headerActions}
            <button
              type="button"
              className="feed-discuss-close"
              onClick={onClose}
              aria-label="Close discussion"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="feed-discuss-scroll" ref={scrollRef ?? localScrollRef}>
          {context}

          <div className="feed-discuss-section-label">
            {sectionLabel}
            {messageCount != null && messageCount > 0 ? (
              <span className="feed-discuss-count">{messageCount}</span>
            ) : null}
          </div>

          {loading && <p className="feed-discuss-status">{loadingLabel}</p>}
          {error && <p className="feed-discuss-error">{error}</p>}
          {!loading && empty}

          <div className="feed-discuss-thread">
            {children}
            <div ref={endRef} />
          </div>
        </div>

        <footer className="feed-discuss-composer">
          <div className="feed-discuss-avatar feed-discuss-composer-avatar" aria-hidden>
            You
          </div>
          <div className="feed-discuss-composer-shell">
            <textarea
              ref={inputRef}
              className="feed-discuss-input"
              rows={1}
              placeholder={placeholder}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={Boolean(sending || inputDisabled)}
            />
            <button
              type="button"
              className="feed-discuss-send"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Post comment"
            >
              <SendIcon />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
