# opencode-evermemos-plugin — TODO & Roadmap

Project: https://github.com/LordAizen1/opencode-evermemos-plugin

---

## 🔴 High Priority

### 1. Simplify EverMemOS Setup in README
The biggest friction point for new users is the two-repo setup. The current README documents the plugin well but doesn't walk the user through EverMemOS setup at all — they hit a wall immediately.

**What to do:**
- Add a "Prerequisites" section at the top of the README that walks through the full EverMemOS setup:
  ```bash
  git clone https://github.com/EverMind-AI/EverMemOS
  cd EverMemOS
  cp env.template .env       # add LLM_API_KEY and VECTORIZE_API_KEY
  docker compose up -d       # starts MongoDB, Elasticsearch, Milvus, Redis
  uv run python src/run.py --port 1995
  ```
- Frame it as "setting up the memory backend" not "cloning a different project" — framing matters for perception.
- Make it feel like one unified setup flow, not two separate things.

---

### 2. ~~Publish to npm~~ ✅ Done
Published as `opencode-evermemos-plugin@0.1.0`. README updated with `npm install -g` instructions.

---

## 🟡 Medium Priority

### 3. Add `.env.example`
The README references `cp .env.example .env` but there may not be an actual `.env.example` file in the repo. Add one with placeholder values so users know exactly what keys they need without reading through the full README.

```dotenv
# LLM extraction (required by EverMemOS)
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=sk-REPLACE_ME

# Embeddings (required by EverMemOS)
VECTORIZE_PROVIDER=vllm
VECTORIZE_BASE_URL=https://api.openai.com/v1
VECTORIZE_MODEL=text-embedding-3-small
VECTORIZE_API_KEY=sk-REPLACE_ME
```

---

### 4. Support EverMemOS Cloud as an Alternative Backend
EverMemOS now has a cloud offering. Supporting it as an option would let users get started with just an API key — no local server, no Docker, no cloning EverMemOS at all.

**What to do:**
- Add a `baseUrl` config option pointing to the EverMemOS Cloud endpoint.
- Document both paths in README: "Local (self-hosted)" and "Cloud (API key only)".
- This doesn't replace the local path — it gives users a choice based on their comfort level.

---

### 5. Add `restart: unless-stopped` to EverMemOS Docker Guidance
Once Docker is set up, users shouldn't have to think about it again. Document that adding a restart policy to the EverMemOS compose file means it starts automatically with Docker on boot.

---

## 🟢 Outreach / Visibility

### 6. Reach Out to the OpenCode Team
The plugin is good enough to put in front of them. Do this after the README and setup story are clean.

**How to reach them:**
- Open a GitHub Discussion or Issue in the OpenCode repo as a plugin showcase.
- Check if they have a Discord — post in the plugins or community channel.
- Tag the OpenCode maintainers on X/Twitter when you post about the release.

**What to prepare first:**
- Clean README with full setup flow (see #1 above).
- Published npm package (see #2 above).
- A short demo GIF or video showing cross-session memory recall in action — this is the most convincing thing you can show.

### 7. Reach Out to the EverMind Team
They have incentive to amplify any plugin built on their backend. A native OpenCode plugin is exactly the kind of ecosystem integration they want.

**How to reach them:**
- GitHub: https://github.com/EverMind-AI/EverMemOS — open an issue or discussion.
- Discord: https://discord.com/invite/gYep5nQRZJ
- They may feature it, link to it from their docs, or connect you with the OpenCode team directly.

---

## 🔵 Nice to Have (Future)

- **Add a demo GIF to README** — showing passive recall working across two sessions is the single most convincing thing for potential users.
- **Windows setup guide** — the README has a PowerShell env var example but no full Windows walkthrough. OpenCode users on Windows are underserved.
- **Health check on startup** — ping EverMemOS on plugin load and warn the user gracefully if it's not running, instead of silently failing.
- **Configurable sanitization rules** — let users add custom redaction patterns beyond the built-in ones (API keys, tokens, PEM keys).
