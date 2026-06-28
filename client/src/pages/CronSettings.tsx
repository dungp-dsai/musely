import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import {
  cronFormFromJob,
  emptyCronForm,
  formToPayload,
  formatRepeat,
  formatSchedule,
  formatWhen,
  isJobPaused,
  type CronJob,
  type CronJobForm,
} from "../lib/cronTypes";

interface Props {
  onBack: () => void;
}

type Tab = "jobs" | "create";

export default function CronSettings({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>("jobs");
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<string>("");
  const [instanceState, setInstanceState] = useState<{ orchestrator: boolean; state?: string } | null>(null);
  const [deliveryOptions, setDeliveryOptions] = useState<{ value: string; label: string }[]>([]);
  const [scheduleExamples, setScheduleExamples] = useState<string[]>([]);
  const [form, setForm] = useState<CronJobForm>(emptyCronForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meta, list, status, instance] = await Promise.all([
        api.getCronMeta(),
        api.listCronJobs(),
        api.getCronStatus().catch(() => ({ status: "" })),
        api.getInstanceStatus().catch(() => null),
      ]);
      setDeliveryOptions(meta.deliveryOptions);
      setScheduleExamples(meta.scheduleExamples);
      setJobs(list.jobs || []);
      setSchedulerStatus(status.status || "");
      setInstanceState(instance);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = <K extends keyof CronJobForm>(key: K, value: CronJobForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const resetForm = () => {
    setForm(emptyCronForm());
    setEditingId(null);
    setTab("create");
  };

  const startEdit = (job: CronJob) => {
    setEditingId(job.id);
    setForm(cronFormFromJob(job));
    setTab("create");
    setSuccess(null);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = formToPayload(form);
      if (editingId) {
        const res = await api.updateCronJob(editingId, payload);
        setSuccess(res.message || "Job updated");
      } else {
        const res = await api.createCronJob(payload);
        setSuccess(res.message || "Job created");
        resetForm();
      }
      await load();
      if (editingId) setTab("jobs");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const action = async (fn: () => Promise<{ message?: string }>) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fn();
      setSuccess(res.message || "Done");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const promptRequired = !form.noAgent || !form.script.trim();

  return (
    <div className="settings-shell">
      <header className="settings-header">
        <button type="button" className="settings-back" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1>Settings</h1>
          <p className="settings-sub">Hermes scheduled tasks (cron)</p>
        </div>
        {instanceState?.orchestrator && (
          <span
            className={`cron-badge ${instanceState.state === "running" ? "active" : "paused"}`}
            title="Scheduled jobs run only while your Hermes instance is active"
          >
            Instance: {instanceState.state || "unknown"}
          </span>
        )}
        <button type="button" className="btn btn-ghost" onClick={load} disabled={loading || busy}>
          Refresh
        </button>
      </header>

      {instanceState?.orchestrator && instanceState.state !== "running" && (
        <div className="settings-note">
          Your Hermes instance is currently stopped to save resources. Scheduled jobs run only while
          it is active; creating or running a job will start it.
        </div>
      )}

      {schedulerStatus && (
        <div className="settings-status">
          <span className="settings-status-label">Scheduler</span>
          <pre>{schedulerStatus}</pre>
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

      <div className="settings-tabs">
        <button
          type="button"
          className={`settings-tab ${tab === "jobs" ? "active" : ""}`}
          onClick={() => setTab("jobs")}
        >
          Jobs ({jobs.length})
        </button>
        <button
          type="button"
          className={`settings-tab ${tab === "create" ? "active" : ""}`}
          onClick={() => {
            if (!editingId) setForm(emptyCronForm());
            setTab("create");
          }}
        >
          {editingId ? "Edit job" : "New job"}
        </button>
      </div>

      {tab === "jobs" && (
        <section className="settings-panel">
          {loading ? (
            <p className="settings-muted">Loading jobs…</p>
          ) : jobs.length === 0 ? (
            <div className="settings-empty">
              <p>No scheduled jobs yet.</p>
              <button type="button" className="btn btn-primary" onClick={resetForm}>
                Create your first job
              </button>
            </div>
          ) : (
            <div className="cron-job-list">
              {jobs.map((job) => {
                const paused = isJobPaused(job);
                return (
                <article key={job.id} className={`cron-job-card ${paused ? "paused" : ""}`}>
                  <div className="cron-job-head">
                    <div>
                      <h3>{job.name || job.id}</h3>
                      <code className="cron-job-id">{job.id}</code>
                    </div>
                    <span className={`cron-badge ${paused ? "paused" : "active"}`}>
                      {paused ? "Paused" : job.state || "Active"}
                    </span>
                  </div>
                  <dl className="cron-job-meta">
                    <div>
                      <dt>Schedule</dt>
                      <dd>{formatSchedule(job)}</dd>
                    </div>
                    <div>
                      <dt>Deliver</dt>
                      <dd>{job.deliver || "local"}</dd>
                    </div>
                    <div>
                      <dt>Next run</dt>
                      <dd>{formatWhen(job.next_run_at)}</dd>
                    </div>
                    {formatRepeat(job) !== "—" ? (
                      <div>
                        <dt>Repeat</dt>
                        <dd>{formatRepeat(job)}</dd>
                      </div>
                    ) : null}
                    {job.last_run_at ? (
                      <div>
                        <dt>Last run</dt>
                        <dd>
                          {formatWhen(job.last_run_at)}
                          {job.last_status ? ` · ${job.last_status}` : ""}
                        </dd>
                      </div>
                    ) : null}
                    {job.skills?.length ? (
                      <div>
                        <dt>Skills</dt>
                        <dd>{job.skills.join(", ")}</dd>
                      </div>
                    ) : null}
                    {job.script ? (
                      <div>
                        <dt>Script</dt>
                        <dd>{job.script}</dd>
                      </div>
                    ) : null}
                    {job.no_agent ? (
                      <div>
                        <dt>Mode</dt>
                        <dd>No-agent (script only)</dd>
                      </div>
                    ) : null}
                  </dl>
                  {job.prompt && <p className="cron-job-prompt">{job.prompt}</p>}
                  <div className="cron-job-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => startEdit(job)}>
                      Edit
                    </button>
                    {paused ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => action(() => api.resumeCronJob(job.id))}
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => action(() => api.pauseCronJob(job.id))}
                      >
                        Pause
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => action(() => api.runCronJob(job.id))}
                    >
                      Run now
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-ghost"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove job "${job.name || job.id}"?`)) {
                          action(() => api.deleteCronJob(job.id));
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === "create" && (
        <section className="settings-panel settings-form-panel">
          <div className="settings-form-grid">
            <label className="field">
              <span>
                Schedule <span className="req">*</span>
              </span>
              <input
                className="input"
                placeholder="every 2h · 0 9 * * * · 30m"
                value={form.schedule}
                onChange={(e) => setField("schedule", e.target.value)}
                list="cron-schedule-examples"
              />
              <datalist id="cron-schedule-examples">
                {scheduleExamples.map((ex) => (
                  <option key={ex} value={ex} />
                ))}
              </datalist>
              <small>
                One-shot: <code>30m</code>, <code>2h</code> · Recurring: <code>every 2h</code> ·
                Cron: <code>0 9 * * *</code>
              </small>
            </label>

            <label className="field">
              <span>Name</span>
              <input
                className="input"
                placeholder="Morning digest"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </label>

            <label className="field field-full">
              <span>
                Prompt / task {promptRequired && <span className="req">*</span>}
              </span>
              <textarea
                className="input textarea"
                rows={5}
                placeholder="Self-contained instruction for Hermes. Include everything the agent needs — cron runs in a fresh session with no chat history."
                value={form.prompt}
                onChange={(e) => setField("prompt", e.target.value)}
              />
              <small>Must be self-contained. Bad: “check that server”. Good: full SSH + commands.</small>
            </label>

            <label className="field">
              <span>Deliver to</span>
              <input
                className="input"
                list="cron-deliver-options"
                placeholder="local"
                value={form.deliver}
                onChange={(e) => setField("deliver", e.target.value)}
              />
              <datalist id="cron-deliver-options">
                {deliveryOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </datalist>
              <small>Examples: <code>telegram:123456</code>, <code>origin,all</code></small>
            </label>

            <label className="field">
              <span>Repeat</span>
              <input
                className="input"
                type="number"
                min={1}
                placeholder="forever (default for intervals)"
                value={form.repeat}
                onChange={(e) => setField("repeat", e.target.value)}
              />
            </label>

            <label className="field field-full">
              <span>Skills</span>
              <input
                className="input"
                placeholder="blogwatcher, maps"
                value={form.skills}
                onChange={(e) => setField("skills", e.target.value)}
              />
              <small>Comma-separated. Loaded before the prompt runs.</small>
            </label>

            <label className="field">
              <span>Pre-run script</span>
              <input
                className="input"
                placeholder="my-check.sh"
                value={form.script}
                onChange={(e) => setField("script", e.target.value)}
              />
              <small>File under <code>~/.hermes/scripts/</code></small>
            </label>

            <label className="field">
              <span>Working directory</span>
              <input
                className="input"
                placeholder="/absolute/path/to/project"
                value={form.workdir}
                onChange={(e) => setField("workdir", e.target.value)}
              />
              <small>Loads AGENTS.md / CLAUDE.md from that folder.</small>
            </label>

            <label className="field field-check field-full">
              <input
                type="checkbox"
                checked={form.noAgent}
                onChange={(e) => setField("noAgent", e.target.checked)}
              />
              <span>
                <strong>No-agent mode</strong> — run script only, deliver stdout verbatim (watchdog /
                alerts). Requires a script; empty stdout = silent tick.
              </span>
            </label>
          </div>

          <div className="settings-form-actions">
            {editingId && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyCronForm());
                  setTab("jobs");
                }}
              >
                Cancel edit
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !form.schedule.trim() || (promptRequired && !form.prompt.trim())}
              onClick={submit}
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Create job"}
            </button>
          </div>

          <details className="settings-help">
            <summary>Schedule & delivery reference</summary>
            <ul>
              <li>
                <strong>Gateway required</strong> — cron runs inside <code>hermes gateway</code> (already
                running in Docker).
              </li>
              <li>
                <strong>Delivery</strong> — <code>local</code> saves to{" "}
                <code>~/.hermes/cron/output/</code>; use <code>telegram</code>, <code>discord</code>, etc.
                when configured.
              </li>
              <li>
                <strong>Silent runs</strong> — prompt Hermes to reply with <code>[SILENT]</code> when
                nothing to report.
              </li>
            </ul>
            <a
              href="https://hermes-agent.nousresearch.com/docs/user-guide/features/cron"
              target="_blank"
              rel="noreferrer"
            >
              Full Hermes cron docs →
            </a>
          </details>
        </section>
      )}
    </div>
  );
}
