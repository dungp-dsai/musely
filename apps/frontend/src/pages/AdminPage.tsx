import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type WaitlistEntry } from "../api";

type Phase = "loading" | "login" | "ready" | "unconfigured";
type AdminTab = "waitlist" | "platform";
type PlatformSection = "config" | "skills" | "secrets";

type SecretRow = {
  id: string;
  key: string;
  value: string;
  hasValue: boolean;
  masked: string | null;
  isNew?: boolean;
  markedDelete?: boolean;
};

type SkillSummary = { id: string; hasSkillMd: boolean };

export default function AdminPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [tab, setTab] = useState<AdminTab>("waitlist");
  const [platformSection, setPlatformSection] = useState<PlatformSection>("config");
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const [platformRoot, setPlatformRoot] = useState("");
  const [platformFiles, setPlatformFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("config.yaml");
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");

  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [savedSkillContent, setSavedSkillContent] = useState("");

  const [secretRows, setSecretRows] = useState<SecretRow[]>([]);
  const [secretsNote, setSecretsNote] = useState("");

  const [platformLoading, setPlatformLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [syncBusySection, setSyncBusySection] = useState<PlatformSection | null>(null);
  const [syncResult, setSyncResult] = useState<Partial<Record<PlatformSection, string>>>({});
  const [syncDetails, setSyncDetails] = useState<
    Partial<Record<PlatformSection, { userId: number; email: string; ok: boolean; error?: string }[]>>
  >({});

  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const configDirty = creatingFile
    ? Boolean(newFilePath.trim()) || editorContent.length > 0
    : editorContent !== savedContent;
  const skillDirty = skillContent !== savedSkillContent;
  const hasUnsaved =
    (platformSection === "config" && configDirty) ||
    (platformSection === "skills" && skillDirty);

  const loadList = useCallback(async () => {
    const { entries: list, emailConfigured: ec } = await api.adminListWaitlist();
    setEntries(list);
    setEmailConfigured(ec);
  }, []);

  const loadConfig = useCallback(async (pickPath?: string) => {
    const { root, files } = await api.adminListPlatformFiles();
    setPlatformRoot(root);
    setPlatformFiles(files);
    setCreatingFile(false);
    setNewFilePath("");
    const path =
      pickPath && files.includes(pickPath)
        ? pickPath
        : files.includes("config.yaml")
          ? "config.yaml"
          : files[0] || "";
    setSelectedFile(path);
    if (path && files.includes(path)) {
      const { content } = await api.adminReadPlatformFile(path);
      setEditorContent(content);
      setSavedContent(content);
    } else {
      setEditorContent("");
      setSavedContent("");
    }
  }, []);

  const loadSkills = useCallback(async (pickId?: string) => {
    const files = await api.adminListPlatformFiles();
    setPlatformRoot(files.root);
    const { skills: list } = await api.adminListPlatformSkills();
    setSkills(list ?? []);
    if (pickId === "__new__") {
      setCreatingSkill(true);
      setSelectedSkill(null);
      setSkillName("");
      setSkillContent("");
      setSavedSkillContent("");
      return;
    }
    setCreatingSkill(false);
    const id = pickId && list?.some((s) => s.id === pickId) ? pickId : list?.[0]?.id ?? null;
    setSelectedSkill(id);
    if (id) {
      const { content } = await api.adminReadPlatformSkill(id);
      setSkillName(id);
      setSkillContent(content);
      setSavedSkillContent(content);
    } else {
      setSkillName("");
      setSkillContent("");
      setSavedSkillContent("");
    }
  }, []);

  const loadSecrets = useCallback(async () => {
    const files = await api.adminListPlatformFiles();
    setPlatformRoot(files.root);
    const data = await api.adminListPlatformSecrets();
    setSecretsNote(data.note);
    setSecretRows(
      data.entries.map((e) => ({
        id: e.key,
        key: e.key,
        value: "",
        hasValue: e.hasValue,
        masked: e.masked,
      }))
    );
  }, []);

  const loadPlatform = useCallback(async () => {
    setPlatformLoading(true);
    setError(null);
    try {
      if (platformSection === "config") await loadConfig();
      else if (platformSection === "skills") await loadSkills();
      else await loadSecrets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlatformLoading(false);
    }
  }, [platformSection, loadConfig, loadSkills, loadSecrets]);

  const init = useCallback(async () => {
    try {
      const { authenticated, configured } = await api.adminMe();
      if (!configured) return setPhase("unconfigured");
      if (!authenticated) return setPhase("login");
      await loadList();
      setPhase("ready");
    } catch (e) {
      setError((e as Error).message);
      setPhase("login");
    }
  }, [loadList]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (phase === "ready" && tab === "platform") loadPlatform();
  }, [phase, tab, platformSection, loadPlatform]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoggingIn(true);
    try {
      await api.adminLogin(username.trim(), password);
      await loadList();
      setPhase("ready");
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await api.adminLogout().catch(() => {});
    setPhase("login");
    setEntries([]);
  };

  const openFile = async (path: string) => {
    if (configDirty && !window.confirm("Discard unsaved changes?")) return;
    setCreatingFile(false);
    setNewFilePath("");
    setSelectedFile(path);
    setSaveMsg(null);
    const { content } = await api.adminReadPlatformFile(path);
    setEditorContent(content);
    setSavedContent(content);
  };

  const startNewFile = () => {
    if (configDirty && !window.confirm("Discard unsaved changes?")) return;
    setCreatingFile(true);
    setSelectedFile("");
    setNewFilePath("");
    setEditorContent("");
    setSavedContent("");
    setSaveMsg(null);
  };

  const openSkill = async (id: string) => {
    if (skillDirty && !window.confirm("Discard unsaved changes?")) return;
    setCreatingSkill(false);
    setSelectedSkill(id);
    setSaveMsg(null);
    const { content } = await api.adminReadPlatformSkill(id);
    setSkillName(id);
    setSkillContent(content);
    setSavedSkillContent(content);
  };

  const startNewSkill = () => {
    if (skillDirty && !window.confirm("Discard unsaved changes?")) return;
    setCreatingSkill(true);
    setSelectedSkill(null);
    setSkillName("");
    setSkillContent("");
    setSavedSkillContent("");
    setSaveMsg(null);
  };

  const handleSaveConfig = async () => {
    setSaveBusy(true);
    setSaveMsg(null);
    setError(null);
    try {
      if (creatingFile) {
        const path = newFilePath.trim().replace(/^\/+/, "").replace(/\\/g, "/");
        if (!path) throw new Error("File path is required");
        await api.adminCreatePlatformFile(path, editorContent);
        setSaveMsg(`Created ${path}`);
        await loadConfig(path);
      } else {
        await api.adminWritePlatformFile(selectedFile, editorContent);
        setSavedContent(editorContent);
        setSaveMsg(`Saved ${selectedFile}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  const handleDeleteFile = async () => {
    if (creatingFile || !selectedFile) return;
    if (!window.confirm(`Delete "${selectedFile}" from the platform directory?`)) return;
    setSaveBusy(true);
    setError(null);
    try {
      await api.adminDeletePlatformFile(selectedFile);
      setSaveMsg(`Deleted ${selectedFile}`);
      await loadConfig();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  const handleSaveSkill = async () => {
    setSaveBusy(true);
    setSaveMsg(null);
    setError(null);
    try {
      if (creatingSkill) {
        const name = skillName.trim().toLowerCase();
        if (!name) throw new Error("Skill name is required");
        await api.adminCreatePlatformSkill({ id: name, content: skillContent });
        setSaveMsg(`Created skill ${name}`);
        await loadSkills(name);
      } else if (selectedSkill) {
        await api.adminUpdatePlatformSkill(selectedSkill, skillContent);
        setSavedSkillContent(skillContent);
        setSaveMsg(`Saved ${selectedSkill}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  const handleDeleteSkill = async () => {
    if (!selectedSkill) return;
    if (!window.confirm(`Delete skill "${selectedSkill}"?`)) return;
    setSaveBusy(true);
    setError(null);
    try {
      await api.adminDeletePlatformSkill(selectedSkill);
      setSaveMsg(`Deleted ${selectedSkill}`);
      await loadSkills();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  const handleSaveSecrets = async () => {
    setSaveBusy(true);
    setSaveMsg(null);
    setError(null);
    try {
      const payload: { key: string; value?: string; delete?: boolean }[] = [];
      for (const row of secretRows) {
        const key = row.key.trim().toUpperCase();
        if (!key) continue;
        if (row.markedDelete) {
          payload.push({ key, delete: true });
          continue;
        }
        if (row.value.trim()) payload.push({ key, value: row.value.trim() });
      }
      if (payload.length === 0) {
        setError(
          "Nothing to save — type a value for each variable (existing keys show ••••; re-enter the value to update)."
        );
        return;
      }
      await api.adminSavePlatformSecrets(payload);
      setSaveMsg("Secrets saved");
      await loadSecrets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  const handleSyncSection = async (section: PlatformSection) => {
    if (section === "config" && (configDirty || creatingFile)) {
      setError("Save config files before syncing.");
      return;
    }
    if (section === "skills" && skillDirty) {
      setError("Save skill changes before syncing.");
      return;
    }
    setSyncBusySection(section);
    setSyncResult((prev) => ({ ...prev, [section]: undefined }));
    setSyncDetails((prev) => ({ ...prev, [section]: undefined }));
    setError(null);
    try {
      const res = await api.syncMuselyAgentPlatform({ sections: [section] });
      const label =
        section === "config" ? "Config" : section === "skills" ? "Skills" : "Env variables";
      setSyncResult((prev) => ({
        ...prev,
        [section]: `${label}: synced ${res.synced}/${res.total} agents (${res.failed} failed).`,
      }));
      setSyncDetails((prev) => ({ ...prev, [section]: res.results || [] }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncBusySection(null);
    }
  };

  const renderSyncBanner = (section: PlatformSection) => {
    const msg = syncResult[section];
    const details = syncDetails[section];
    if (!msg) return null;
    const hasErrors = details?.some((r) => !r.ok);
    return (
      <div className={`admin-warn ${hasErrors ? "admin-warn-error" : ""}`}>
        {msg}
        {hasErrors && (
          <ul className="admin-sync-errors">
            {details
              ?.filter((r) => !r.ok)
              .map((r) => (
                <li key={r.userId}>
                  <strong>{r.email}</strong>: {r.error}
                </li>
              ))}
          </ul>
        )}
      </div>
    );
  };

  const toggle = async (entry: WaitlistEntry) => {
    setBusyId(entry.id);
    setError(null);
    try {
      if (entry.approved) await api.adminRevoke(entry.id);
      else await api.adminApprove(entry.id);
      await loadList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (phase === "loading") {
    return (
      <div className="admin-page">
        <div className="admin-center">Loading…</div>
      </div>
    );
  }

  if (phase === "unconfigured") {
    return (
      <div className="admin-page">
        <div className="admin-login-card">
          <div className="admin-mark">M</div>
          <h1>Admin panel disabled</h1>
          <p className="admin-muted">
            Set <code>ADMIN_PASSWORD</code> in the backend environment to enable the admin panel.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="admin-page">
        <form className="admin-login-card" onSubmit={handleLogin}>
          <div className="admin-mark">M</div>
          <h1>Admin sign in</h1>
          <p className="admin-muted">Manage Musely waiting list and agent platform.</p>
          {error && <div className="admin-error">{error}</div>}
          <label className="admin-label">
            Username
            <input
              className="admin-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="admin-label">
            Password
            <input
              className="admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="admin-btn admin-btn-primary" type="submit" disabled={loggingIn}>
            {loggingIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  const approvedCount = entries.filter((e) => e.approved).length;
  const filtered = entries.filter((e) =>
    e.email.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="admin-page">
      <div className="admin-shell admin-shell-wide">
        <header className="admin-header">
          <div className="admin-brand">
            <span className="admin-mark admin-mark-sm">M</span>
            <div>
              <h1 className="admin-title">Musely Admin</h1>
              <p className="admin-sub">
                {tab === "waitlist"
                  ? `${entries.length} registered · ${approvedCount} approved`
                  : "Edit platform config, skills, and secrets — then sync to all agents"}
              </p>
            </div>
          </div>
          <button className="admin-btn admin-btn-ghost" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </header>

        <nav className="admin-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "waitlist"}
            className={`admin-tab ${tab === "waitlist" ? "active" : ""}`}
            onClick={() => setTab("waitlist")}
          >
            Waiting list
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "platform"}
            className={`admin-tab ${tab === "platform" ? "active" : ""}`}
            onClick={() => setTab("platform")}
          >
            Musely Agent Platform Setup
          </button>
        </nav>

        {!emailConfigured && tab === "waitlist" && (
          <div className="admin-warn">
            Email sending is off (no <code>RESEND_API_KEY</code>). Approvals still work, but users
            won't be notified automatically.
          </div>
        )}
        {error && <div className="admin-error admin-error-bar">{error}</div>}

        {tab === "waitlist" && (
          <>
            <div className="admin-toolbar">
              <input
                className="admin-search"
                placeholder="Search email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="admin-btn admin-btn-ghost" type="button" onClick={() => loadList()}>
                Refresh
              </button>
            </div>
            {filtered.length === 0 ? (
              <div className="admin-empty">
                {entries.length === 0 ? "No signups yet." : "No emails match your search."}
              </div>
            ) : (
              <div className="admin-table">
                <div className="admin-row admin-row-head">
                  <span>Email</span>
                  <span>Joined</span>
                  <span>Status</span>
                  <span className="admin-cell-action">Action</span>
                </div>
                {filtered.map((entry) => (
                  <div className="admin-row" key={entry.id}>
                    <span className="admin-cell-email">{entry.email}</span>
                    <span className="admin-cell-date">{formatDate(entry.createdAt)}</span>
                    <span>
                      <span
                        className={`admin-badge ${entry.approved ? "is-approved" : "is-pending"}`}
                      >
                        {entry.approved ? "Approved" : "Pending"}
                      </span>
                    </span>
                    <span className="admin-cell-action">
                      <button
                        className={`admin-btn ${entry.approved ? "admin-btn-ghost" : "admin-btn-primary"}`}
                        type="button"
                        onClick={() => toggle(entry)}
                        disabled={busyId === entry.id}
                      >
                        {busyId === entry.id ? "…" : entry.approved ? "Revoke" : "Approve"}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "platform" && (
          <div className="admin-platform">
            <p className="admin-muted admin-platform-intro">
              Platform storage: <code>{platformRoot || "…"}</code>. Save each section, then sync
              only what changed — config, skills, and env vars sync independently.
            </p>

            <nav className="admin-subtabs">
              {(["config", "skills", "secrets"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`admin-subtab ${platformSection === s ? "active" : ""}`}
                  onClick={() => {
                    if (hasUnsaved && !window.confirm("Discard unsaved changes?")) return;
                    setPlatformSection(s);
                    setSaveMsg(null);
                  }}
                >
                  {s === "config" ? "Config files" : s === "skills" ? "Skills" : "Env variables"}
                </button>
              ))}
            </nav>

            {saveMsg && <div className="admin-warn">{saveMsg}</div>}

            {platformSection === "config" && (
              <div className="admin-platform-layout">
                <aside className="admin-file-list">
                  <div className="admin-file-list-head admin-file-list-head-row">
                    <span>Files</span>
                    <button
                      type="button"
                      className="admin-btn admin-btn-ghost admin-btn-xs"
                      onClick={startNewFile}
                    >
                      + New
                    </button>
                  </div>
                  {platformLoading ? (
                    <p className="admin-muted admin-file-empty">Loading…</p>
                  ) : platformFiles.length === 0 && !creatingFile ? (
                    <p className="admin-muted admin-file-empty">No files yet.</p>
                  ) : (
                    platformFiles.map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={`admin-file-item ${f === selectedFile && !creatingFile ? "active" : ""}`}
                        onClick={() => openFile(f)}
                      >
                        {f}
                      </button>
                    ))
                  )}
                </aside>
                <div className="admin-editor-panel">
                  {creatingFile || selectedFile ? (
                    <>
                      <div className="admin-editor-toolbar">
                        {creatingFile ? (
                          <label className="admin-label admin-editor-new-path">
                            New file path
                            <input
                              className="admin-input"
                              placeholder="SOUL.md or notes/README.md"
                              value={newFilePath}
                              onChange={(e) => {
                                setNewFilePath(e.target.value);
                                setSaveMsg(null);
                              }}
                              autoFocus
                            />
                          </label>
                        ) : (
                          <span className="admin-editor-path">{selectedFile}</span>
                        )}
                        {configDirty && <span className="admin-badge is-pending">Unsaved</span>}
                        <button
                          type="button"
                          className="admin-btn admin-btn-ghost"
                          disabled={
                            saveBusy ||
                            (creatingFile ? !newFilePath.trim() : !configDirty)
                          }
                          onClick={handleSaveConfig}
                        >
                          {saveBusy ? "Saving…" : creatingFile ? "Create" : "Save"}
                        </button>
                        {!creatingFile && selectedFile && (
                          <button
                            type="button"
                            className="admin-btn admin-btn-ghost admin-btn-danger"
                            disabled={saveBusy}
                            onClick={handleDeleteFile}
                          >
                            Delete
                          </button>
                        )}
                        <button
                          type="button"
                          className="admin-btn admin-btn-primary"
                          disabled={
                            syncBusySection !== null || configDirty || creatingFile
                          }
                          onClick={() => handleSyncSection("config")}
                        >
                          {syncBusySection === "config" ? "Syncing…" : "Sync config"}
                        </button>
                      </div>
                      <textarea
                        className="admin-code-editor"
                        spellCheck={false}
                        value={editorContent}
                        onChange={(e) => {
                          setEditorContent(e.target.value);
                          setSaveMsg(null);
                        }}
                        placeholder={
                          creatingFile
                            ? "# New platform file…"
                            : undefined
                        }
                      />
                    </>
                  ) : (
                    <p className="admin-muted admin-file-empty">
                      No file selected. Click + New to add one.
                    </p>
                  )}
                </div>
              </div>
            )}
            {platformSection === "config" && renderSyncBanner("config")}

            {platformSection === "skills" && (
              <>
                <div className="admin-section-toolbar">
                  <p className="admin-muted">
                    Sync pushes <code>skills/musely/</code> to every user agent — including when
                    empty (removes Musely skills on user volumes).
                  </p>
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    disabled={syncBusySection !== null || skillDirty || creatingSkill}
                    onClick={() => handleSyncSection("skills")}
                  >
                    {syncBusySection === "skills" ? "Syncing…" : "Sync skills"}
                  </button>
                </div>
                <div className="admin-platform-layout">
                <aside className="admin-file-list">
                  <div className="admin-file-list-head admin-file-list-head-row">
                    <span>skills/musely/</span>
                    <button
                      type="button"
                      className="admin-btn admin-btn-ghost admin-btn-xs"
                      onClick={startNewSkill}
                    >
                      + New
                    </button>
                  </div>
                  {platformLoading ? (
                    <p className="admin-muted admin-file-empty">Loading…</p>
                  ) : skills.length === 0 && !creatingSkill ? (
                    <p className="admin-muted admin-file-empty">No skills yet.</p>
                  ) : (
                    skills.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`admin-file-item ${s.id === selectedSkill && !creatingSkill ? "active" : ""}`}
                        onClick={() => openSkill(s.id)}
                      >
                        {s.id}/
                      </button>
                    ))
                  )}
                </aside>
                <div className="admin-editor-panel">
                  {creatingSkill || selectedSkill ? (
                    <>
                      <label className="admin-label">
                        Skill name
                        <span className="admin-muted admin-label-hint">
                          → skills/musely/{skillName || "…"}/
                        </span>
                        <input
                          className="admin-input"
                          placeholder="feed-writer"
                          value={skillName}
                          disabled={!creatingSkill}
                          onChange={(e) =>
                            setSkillName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                          }
                        />
                      </label>
                      <label className="admin-label">
                        SKILL.md
                        {skillDirty && <span className="admin-badge is-pending">Unsaved</span>}
                        <textarea
                          className="admin-code-editor"
                          spellCheck={false}
                          value={skillContent}
                          onChange={(e) => {
                            setSkillContent(e.target.value);
                            setSaveMsg(null);
                          }}
                          placeholder="# My skill&#10;&#10;Write skill instructions in markdown…"
                        />
                      </label>
                      <div className="admin-editor-actions">
                        <button
                          type="button"
                          className="admin-btn admin-btn-primary"
                          disabled={
                            saveBusy ||
                            (creatingSkill ? !skillName.trim() : !skillDirty)
                          }
                          onClick={handleSaveSkill}
                        >
                          {saveBusy ? "Saving…" : creatingSkill ? "Create" : "Save"}
                        </button>
                        {!creatingSkill && selectedSkill && (
                          <button
                            type="button"
                            className="admin-btn admin-btn-ghost admin-btn-danger"
                            disabled={saveBusy}
                            onClick={handleDeleteSkill}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="admin-muted">Click + New or select a skill folder.</p>
                  )}
                </div>
              </div>
              </>
            )}
            {platformSection === "skills" && renderSyncBanner("skills")}

            {platformSection === "secrets" && (
              <div className="admin-secrets-panel">
                <p className="admin-muted">{secretsNote}</p>
                <p className="admin-muted">
                  Saved in the backend database, then written to each user agent at{" "}
                  <code>/opt/data/.env</code> on sync. Use <code>ls -la /opt/data</code> in the
                  agent container — <code>.env</code> is a hidden dotfile.
                </p>
                <div className="admin-secrets-table">
                  <div className="admin-secrets-row admin-secrets-head">
                    <span>Variable</span>
                    <span>Value</span>
                    <span />
                  </div>
                  {secretRows.map((row, idx) => (
                    <div
                      className={`admin-secrets-row ${row.markedDelete ? "is-deleted" : ""}`}
                      key={row.id}
                    >
                      <input
                        className="admin-input"
                        placeholder="MY_API_KEY"
                        value={row.key}
                        disabled={!row.isNew && row.hasValue}
                        onChange={(e) => {
                          setSecretRows((rows) => {
                            const next = [...rows];
                            next[idx] = { ...row, key: e.target.value };
                            return next;
                          });
                        }}
                      />
                      <input
                        className="admin-input"
                        type="password"
                        placeholder={row.hasValue ? row.masked || "••••" : "value"}
                        value={row.value}
                        onChange={(e) => {
                          setSecretRows((rows) => {
                            const next = [...rows];
                            next[idx] = { ...row, value: e.target.value };
                            return next;
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="admin-btn admin-btn-ghost admin-btn-xs"
                        onClick={() => {
                          setSecretRows((rows) => {
                            const next = [...rows];
                            next[idx] = { ...row, markedDelete: !row.markedDelete };
                            return next;
                          });
                        }}
                      >
                        {row.markedDelete ? "Undo" : "Remove"}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="admin-editor-actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn-ghost"
                    onClick={() =>
                      setSecretRows((rows) => [
                        ...rows,
                        {
                          id: `new-${Date.now()}`,
                          key: "",
                          value: "",
                          hasValue: false,
                          masked: null,
                          isNew: true,
                        },
                      ])
                    }
                  >
                    + Add variable
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    disabled={saveBusy}
                    onClick={handleSaveSecrets}
                  >
                    {saveBusy ? "Saving…" : "Save secrets"}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    disabled={syncBusySection !== null}
                    onClick={() => handleSyncSection("secrets")}
                  >
                    {syncBusySection === "secrets" ? "Syncing…" : "Sync env vars"}
                  </button>
                </div>
              </div>
            )}
            {platformSection === "secrets" && renderSyncBanner("secrets")}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
