import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import {
  DAY_LABELS,
  draftFromJob,
  draftToHermesJobs,
  draftToPayload,
  emptyScheduleDraft,
  formatTimeLabel,
  formatWhen,
  isJobPaused,
  newPickupId,
  summarizeDraft,
  summarizeJob,
  type Cadence,
  type CronJob,
  type DayPreset,
  type PickupTime,
  type ScheduleDraft,
} from "../lib/cronTypes";

interface Props {
  onBack: () => void;
  seed?: { name?: string; prompt?: string } | null;
}

type Mode = "list" | "editor";

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`sched-toggle ${checked ? "is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="sched-toggle-knob" />
    </button>
  );
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`sched-chip ${active ? "is-active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

export default function CronSettings({ onBack, seed }: Props) {
  const [mode, setMode] = useState<Mode>(seed?.prompt || seed?.name ? "editor" : "list");
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [instanceState, setInstanceState] = useState<{
    orchestrator: boolean;
    state?: string;
  } | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>(() => emptyScheduleDraft(seed));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fromQueue = Boolean(seed?.prompt);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, instance] = await Promise.all([
        api.listCronJobs(),
        api.getInstanceStatus().catch(() => null),
      ]);
      setJobs(list.jobs || []);
      setInstanceState(instance);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const summary = useMemo(() => summarizeDraft(draft), [draft]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyScheduleDraft(seed));
    setMode("editor");
    setSuccess(null);
    setError(null);
  };

  const openEdit = (job: CronJob) => {
    setEditingId(job.id);
    setDraft(draftFromJob(job));
    setMode("editor");
    setSuccess(null);
    setError(null);
  };

  const backToList = () => {
    setEditingId(null);
    setDraft(emptyScheduleDraft());
    setMode("list");
  };

  const updateTime = (id: string, next: Partial<PickupTime>) => {
    setDraft((d) => ({
      ...d,
      times: d.times.map((t) => (t.id === id ? { ...t, ...next } : t)),
    }));
  };

  const addTime = () => {
    setDraft((d) => {
      const last = d.times[d.times.length - 1];
      let next = "18:00";
      if (last) {
        const [h, m] = last.time.split(":").map(Number);
        const nh = Math.min(23, (h || 9) + 3);
        next = `${String(nh).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
      }
      return {
        ...d,
        times: [...d.times, { id: newPickupId(), time: next, enabled: true }],
      };
    });
  };

  const removeTime = (id: string) => {
    setDraft((d) => ({
      ...d,
      times: d.times.length <= 1 ? d.times : d.times.filter((t) => t.id !== id),
    }));
  };

  const toggleCustomDay = (day: number) => {
    setDraft((d) => {
      const has = d.customDays.includes(day);
      const customDays = has
        ? d.customDays.filter((x) => x !== day)
        : [...d.customDays, day].sort((a, b) => a - b);
      return { ...d, days: "custom", customDays };
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (editingId) {
        const payload = draftToPayload(draft);
        const res = await api.updateCronJob(editingId, payload);
        const current = jobs.find((j) => j.id === editingId);
        const wasPaused = current ? isJobPaused(current) : false;
        if (draft.enabled && wasPaused) await api.resumeCronJob(editingId);
        if (!draft.enabled && !wasPaused) await api.pauseCronJob(editingId);
        setSuccess(res.message || "Schedule updated");
        await load();
        setMode("list");
        setEditingId(null);
      } else {
        const before = new Set((await api.listCronJobs()).jobs.map((j) => j.id));
        const payloads = draftToHermesJobs(draft);
        for (const payload of payloads) {
          await api.createCronJob(payload);
        }
        if (!draft.enabled) {
          const after = (await api.listCronJobs()).jobs || [];
          for (const j of after) {
            if (!before.has(j.id) && !isJobPaused(j)) {
              await api.pauseCronJob(j.id);
            }
          }
        }
        setSuccess(
          payloads.length > 1
            ? `Created ${payloads.length} pickup schedules`
            : "Schedule created"
        );
        await load();
        setMode("list");
        setEditingId(null);
        setDraft(emptyScheduleDraft());
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleJob = async (job: CronJob) => {
    setBusy(true);
    setError(null);
    try {
      if (isJobPaused(job)) await api.resumeCronJob(job.id);
      else await api.pauseCronJob(job.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (job: CronJob) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.runCronJob(job.id);
      setSuccess(res.message || "Started");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeJob = async (job: CronJob) => {
    if (!window.confirm(`Remove “${job.name || "this schedule"}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteCronJob(job.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    draft.name.trim().length > 0 &&
    (draft.cadence === "interval"
      ? draft.everyHours > 0 || draft.everyMinutes > 0
      : draft.times.some((t) => t.enabled));

  return (
    <div className="sched-shell">
      <header className="sched-top">
        <button
          type="button"
          className="sched-back"
          onClick={() => (mode === "editor" && !fromQueue ? backToList() : onBack())}
        >
          ← Back
        </button>
        <div className="sched-top-copy">
          <h1>{mode === "editor" ? (editingId ? "Edit schedule" : "New schedule") : "Schedules"}</h1>
          <p>
            {mode === "editor"
              ? "Name it, pick when Musely should show up, then save."
              : "Let Musely pick up your writing queue on a rhythm you choose."}
          </p>
        </div>
        {mode === "list" && (
          <button type="button" className="sched-primary" onClick={openCreate}>
            + New
          </button>
        )}
      </header>

      {fromQueue && mode === "editor" && (
        <div className="sched-banner">
          From your AI queue — choose when Musely should work these tasks, then come back later to
          review.
        </div>
      )}

      {instanceState?.orchestrator && instanceState.state !== "running" && (
        <div className="sched-banner soft">
          Your agent is idle to save resources. Creating or running a schedule will wake it.
        </div>
      )}

      {error && (
        <div className="error-bar settings-flash" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {success && (
        <div className="success-bar settings-flash" onClick={() => setSuccess(null)}>
          {success}
        </div>
      )}

      {mode === "list" && (
        <section className="sched-list">
          {loading ? (
            <p className="sched-muted">Loading schedules…</p>
          ) : jobs.length === 0 ? (
            <div className="sched-empty">
              <div className="sched-empty-mark" aria-hidden>
                ✦
              </div>
              <h2>No schedules yet</h2>
              <p>Set pickup times so Musely can work your queue while you&apos;re away.</p>
              <button type="button" className="sched-primary" onClick={openCreate}>
                Create a schedule
              </button>
            </div>
          ) : (
            jobs.map((job) => {
              const paused = isJobPaused(job);
              return (
                <article key={job.id} className={`sched-card ${paused ? "is-off" : ""}`}>
                  <div className="sched-card-main">
                    <div className="sched-card-text">
                      <h3>{job.name || "Untitled schedule"}</h3>
                      <p className="sched-card-when">{summarizeJob(job)}</p>
                      <p className="sched-card-meta">
                        Next {formatWhen(job.next_run_at)}
                        {job.last_status ? ` · last ${job.last_status}` : ""}
                      </p>
                    </div>
                    <Toggle
                      checked={!paused}
                      disabled={busy}
                      label={paused ? "Turn on" : "Turn off"}
                      onChange={() => void toggleJob(job)}
                    />
                  </div>
                  <div className="sched-card-actions">
                    <button type="button" className="sched-link" onClick={() => openEdit(job)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="sched-link"
                      disabled={busy}
                      onClick={() => void runNow(job)}
                    >
                      Run now
                    </button>
                    <button
                      type="button"
                      className="sched-link danger"
                      disabled={busy}
                      onClick={() => void removeJob(job)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      )}

      {mode === "editor" && (
        <section className="sched-editor">
          <div className="sched-block">
            <div className="sched-block-head">
              <label className="sched-label" htmlFor="sched-name">
                Name
              </label>
              <div className="sched-onoff">
                <span>{draft.enabled ? "On" : "Off"}</span>
                <Toggle
                  checked={draft.enabled}
                  label="Enable schedule"
                  onChange={(v) => patch("enabled", v)}
                />
              </div>
            </div>
            <input
              id="sched-name"
              className="sched-input"
              value={draft.name}
              onChange={(e) => {
                patch("name", e.target.value);
                patch("nameTouched", true);
              }}
              placeholder="Morning assist"
            />
          </div>

          <div className="sched-block">
            <span className="sched-label">How often</span>
            <div className="sched-chip-row">
              {(
                [
                  ["times_of_day", "Pickup times"],
                  ["interval", "Every…"],
                ] as [Cadence, string][]
              ).map(([id, label]) => (
                <Chip key={id} active={draft.cadence === id} onClick={() => patch("cadence", id)}>
                  {label}
                </Chip>
              ))}
            </div>

            {draft.cadence === "times_of_day" ? (
              <>
                <div className="sched-times">
                  {draft.times.map((t) => (
                    <div key={t.id} className={`sched-time-row ${t.enabled ? "" : "is-off"}`}>
                      <Toggle
                        checked={t.enabled}
                        label={`Enable ${formatTimeLabel(t.time)}`}
                        onChange={(v) => updateTime(t.id, { enabled: v })}
                      />
                      <input
                        type="time"
                        className="sched-time-input"
                        value={t.time}
                        disabled={!t.enabled}
                        onChange={(e) => updateTime(t.id, { time: e.target.value || "09:00" })}
                      />
                      <span className="sched-time-hint">{formatTimeLabel(t.time)}</span>
                      <button
                        type="button"
                        className="sched-time-remove"
                        title="Remove time"
                        disabled={draft.times.length <= 1}
                        onClick={() => removeTime(t.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className="sched-add-time" onClick={addTime}>
                  + Add another time
                </button>

                <span className="sched-label tight">On these days</span>
                <div className="sched-chip-row">
                  {(
                    [
                      ["every_day", "Every day"],
                      ["weekdays", "Weekdays"],
                      ["weekends", "Weekends"],
                      ["custom", "Custom"],
                    ] as [DayPreset, string][]
                  ).map(([id, label]) => (
                    <Chip key={id} active={draft.days === id} onClick={() => patch("days", id)}>
                      {label}
                    </Chip>
                  ))}
                </div>
                {draft.days === "custom" && (
                  <div className="sched-days">
                    {DAY_LABELS.map((label, i) => (
                      <button
                        key={label}
                        type="button"
                        className={`sched-day ${draft.customDays.includes(i) ? "is-active" : ""}`}
                        onClick={() => toggleCustomDay(i)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="sched-interval">
                <label>
                  Hours
                  <input
                    type="number"
                    min={0}
                    max={168}
                    className="sched-input narrow"
                    value={draft.everyHours}
                    onChange={(e) => patch("everyHours", Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label>
                  Minutes
                  <input
                    type="number"
                    min={0}
                    max={59}
                    className="sched-input narrow"
                    value={draft.everyMinutes}
                    onChange={(e) =>
                      patch("everyMinutes", Math.min(59, Math.max(0, Number(e.target.value) || 0)))
                    }
                  />
                </label>
              </div>
            )}
          </div>

          <div className="sched-block">
            <span className="sched-label">Repeat</span>
            <div className="sched-chip-row">
              <Chip
                active={draft.repeatMode === "forever"}
                onClick={() => patch("repeatMode", "forever")}
              >
                Forever
              </Chip>
              <Chip
                active={draft.repeatMode === "count"}
                onClick={() => patch("repeatMode", "count")}
              >
                Limited
              </Chip>
            </div>
            {draft.repeatMode === "count" && (
              <label className="sched-inline">
                Stop after
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="sched-input narrow"
                  value={draft.repeatCount}
                  onChange={(e) =>
                    patch("repeatCount", Math.max(1, Number(e.target.value) || 1))
                  }
                />
                runs
              </label>
            )}
          </div>

          <div className="sched-preview">
            <span className="sched-preview-label">Musely will run</span>
            <strong>{summary}</strong>
          </div>

          <div className="sched-editor-actions">
            {!fromQueue && (
              <button type="button" className="sched-ghost" onClick={backToList} disabled={busy}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="sched-primary wide"
              disabled={busy || !canSave}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : editingId ? "Save schedule" : "Create schedule"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
