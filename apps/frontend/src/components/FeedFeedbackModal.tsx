import { useEffect, useRef, useState } from "react";
import { setNeverShowFeedFeedbackPrompt } from "../lib/feedFeedbackStorage";

interface Props {
  postTitle: string;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
}

export default function FeedFeedbackModal({ postTitle, onClose, onSubmit }: Props) {
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!submitted) textareaRef.current?.focus();
  }, [submitted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    onSubmit(feedback.trim());
    setSubmitted(true);
  };

  const neverShowAgain = () => {
    setNeverShowFeedFeedbackPrompt();
    onClose();
  };

  return (
    <div className="feed-feedback-overlay" onClick={onClose} role="presentation">
      <div
        className="feed-feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feed-feedback-title"
        onClick={(e) => e.stopPropagation()}
      >
        {submitted ? (
          <>
            <header className="feed-feedback-head">
              <h3 id="feed-feedback-title">Thanks!</h3>
              <button type="button" className="feed-feedback-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </header>
            <div className="feed-feedback-body feed-feedback-thanks">
              <p>Thank you. We&apos;ll do our best to improve your feed.</p>
            </div>
            <footer className="feed-feedback-foot feed-feedback-foot-thanks">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="feed-feedback-head">
              <h3 id="feed-feedback-title">Help us improve your feed</h3>
              <button type="button" className="feed-feedback-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </header>

            <div className="feed-feedback-body">
              <p className="feed-feedback-lede">
                What wasn&apos;t helpful about <strong>{postTitle}</strong>?
              </p>
              <textarea
                ref={textareaRef}
                className="feed-feedback-input"
                rows={4}
                placeholder="e.g. not relevant to my interests, too generic, wrong sources…"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>

            <footer className="feed-feedback-foot">
              <button type="button" className="link-btn feed-feedback-never" onClick={neverShowAgain}>
                Don&apos;t ask again
              </button>
              <div className="feed-feedback-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={submit}>
                  Send feedback
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
