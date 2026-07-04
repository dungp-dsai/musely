import { useEffect, useRef, useState } from "react";
import type { User } from "../api";

interface Props {
  user: User;
  onOpenProfile: () => void;
  onOpenChat: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export default function UserMenu({
  user,
  onOpenProfile,
  onOpenChat,
  onOpenSettings,
  onLogout,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const firstName = user.name.trim().split(/\s+/)[0] || user.name;
  const initial = (firstName[0] || user.email[0] || "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className={`user-menu-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.name} · ${user.email}`}
      >
        <span className="home-avatar">
          {user.picture ? <img src={user.picture} alt="" /> : initial}
        </span>
      </button>

      {open && (
        <div className="user-menu-pop" role="menu">
          <div className="user-menu-id">
            <span className="home-avatar user-menu-id-avatar">
              {user.picture ? <img src={user.picture} alt="" /> : initial}
            </span>
            <div className="user-menu-id-text">
              <div className="user-menu-id-name">{user.name}</div>
              <div className="user-menu-id-email">{user.email}</div>
            </div>
          </div>

          <div className="user-menu-sep" />

          <button type="button" role="menuitem" className="user-menu-item" onClick={pick(onOpenProfile)}>
            <span className="user-menu-ico" aria-hidden>👤</span>
            Profile &amp; preferences
          </button>
          <button type="button" role="menuitem" className="user-menu-item" onClick={pick(onOpenChat)}>
            <span className="user-menu-ico" aria-hidden>💬</span>
            Chat with Hermes
          </button>
          <button type="button" role="menuitem" className="user-menu-item" onClick={pick(onOpenSettings)}>
            <span className="user-menu-ico" aria-hidden>🗓️</span>
            Scheduled tasks
          </button>

          <div className="user-menu-sep" />

          <button
            type="button"
            role="menuitem"
            className="user-menu-item danger"
            onClick={pick(onLogout)}
          >
            <span className="user-menu-ico" aria-hidden>↪</span>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
