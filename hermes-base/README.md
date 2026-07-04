# Optional Hermes template — seed new user volumes with shared LLM config.

**You do not need this folder for local dev.** Musely provisions per-user Hermes
containers with empty volumes; Hermes bootstraps on first run.

To pre-seed LLM keys for every new user (optional):

1. Run a throwaway agent container and complete `hermes setup` inside it.
2. Copy `/opt/data/config.yaml` and/or `/opt/data/.env` into this directory.
3. Restart `./scripts/dev.sh` — new user volumes copy from here on first provision.
