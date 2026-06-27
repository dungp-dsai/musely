# DungPham Writer — Docker & VPS Setup

Run the Writer app as a single container: React UI + Express API + SQLite on **port 8080**.

## Requirements

- Docker 24+ and Docker Compose v2
- VPS with 1 GB+ RAM (512 MB may work for light use)
- Optional: domain + reverse proxy (Caddy or nginx) for HTTPS

---

## Quick start (local or VPS)

```bash
cd writer-app

# 1. Configure secrets (task chat needs an LLM key)
cp .env.docker.example .env
# Edit .env — set OPENROUTER_API_KEY or OPENAI_API_KEY

# 2. Build and run
docker compose up -d --build

# 3. Open the app
# http://YOUR_VPS_IP:8080
```

Health check:

```bash
curl -s http://localhost:8080/api/health
# {"ok":true,"db":"/app/data/hermes_writer.db"}
```

Logs:

```bash
docker compose logs -f writer
```

Stop:

```bash
docker compose down
```

Data persists in the Docker volume `writer-data` (SQLite at `/app/data/hermes_writer.db`).

---

## VPS setup (step by step)

### 1. Install Docker on Ubuntu/Debian

```bash
sudo apt update && sudo apt install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in so group membership applies
```

Verify:

```bash
docker --version
docker compose version
```

### 2. Copy the project to the VPS

From your Mac:

```bash
rsync -avz --exclude node_modules --exclude 'data/*.db*' \
  ~/Documents/writer-app/ user@YOUR_VPS_IP:~/writer-app/
```

Or clone/upload the folder any way you prefer.

### 3. Configure and start on the VPS

```bash
ssh user@YOUR_VPS_IP
cd ~/writer-app
cp .env.docker.example .env
nano .env   # add OPENROUTER_API_KEY or OPENAI_API_KEY

docker compose up -d --build
sudo ufw allow 8080/tcp   # if using UFW firewall
```

Visit `http://YOUR_VPS_IP:8080`.

### 4. HTTPS with Caddy (recommended)

Install Caddy on the VPS, then `/etc/caddy/Caddyfile`:

```
writer.yourdomain.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

Point DNS `writer.yourdomain.com` → VPS IP. Caddy provisions TLS automatically.

### 5. Updates

```bash
cd ~/writer-app
# pull/rsync new files, then:
docker compose up -d --build
```

Your posts stay in the `writer-data` volume across rebuilds.

---

## Build image only (no compose)

```bash
docker build -t dungpham-writer:latest .
docker run -d \
  --name dungpham-writer \
  -p 8080:8080 \
  -v writer-data:/app/data \
  -e OPENROUTER_API_KEY=sk-or-... \
  dungpham-writer:latest
```

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port inside container |
| `HOST` | `0.0.0.0` | Bind address |
| `HERMES_WRITER_DB` | `/app/data/hermes_writer.db` | SQLite path |
| `OPENROUTER_API_KEY` | — | LLM for task chat |
| `OPENAI_API_KEY` | — | Alternative LLM provider |
| `WRITER_CHAT_MODEL` | `anthropic/claude-sonnet-4` | Chat model name |

---

## Agent CLI (Hermes on your Mac)

The web app in Docker uses its **own** database inside the volume. Your local Hermes agent (`hw` CLI) talks to `~/.hermes/writer-app/data/` by default — **not** the VPS DB unless you point it there.

To collaborate from Hermes against the VPS DB you would need to sync or mount that file separately. For most setups: **write in the browser on VPS**, use Hermes locally only when developing on your Mac.

---

## Troubleshooting

**Container exits immediately**

```bash
docker compose logs writer
```

**Port in use** — change `WRITER_PORT=9090` in `.env`.

**Task chat returns LLM error** — confirm API key in `.env` and restart: `docker compose up -d`.

**Empty app after rebuild** — data is in volume `writer-data`; don't run `docker compose down -v` unless you intend to wipe posts.
