# opencode-evermemos-plugin

Durable project and user memory for OpenCode using EverMemOS.

The plugin captures sanitized user and tool context, stores it in EverMemOS, and automatically recalls relevant memories into the system prompt on every turn — no explicit commands needed. Memory is split into project scope for repo-specific continuity and global scope for user-wide preferences.

## Why EverMemOS

Most OpenCode memory plugins (opencode-mem, opencode-supermemory, opencode-mem0) store raw text in a vector database and retrieve it by similarity. EverMemOS does something fundamentally different — it runs an LLM extraction pipeline over your conversations and produces structured memory types:

- **Episodic memory** — summarised past events with participants, timestamps, and key facts
- **Profile memory** — stable user traits and preferences extracted over time
- **Foresight** — forward-looking intentions and planned work
- **Event log** — atomic facts distilled from conversation history

This means recall isn't just "find similar text" — it's "here is what you've been working on, what you prefer, and what you planned to do next." That context is injected into the system prompt before every model response, making the assistant genuinely aware of your project history without you repeating yourself.

## How it works

### Passive (automatic, no user action required)

- Every user message is sanitized and stored in EverMemOS silently in the background.
- Before each model response, relevant memories from past sessions are recalled and injected into the system prompt automatically via `experimental.chat.system.transform`.
- Tool outcomes (file edits, bash results) are summarized and stored after execution.
- During session compaction (context overflow), recalled memories are added to the compaction context so nothing important is lost.
- Session cache is pruned on idle to prevent unbounded memory growth.

### Explicit (model-controlled tools)

The model can also call memory tools directly when the user asks for targeted recall, wants to save something explicitly, or wants to clean up memories:

- `evermemos_recall(query, top_k?, scope?)` — recall from project, global, or both scopes
- `evermemos_remember(content, role?, scope?)` — sanitize and store a memory entry explicitly in project, global, or auto-routed scope
- `evermemos_forget(event_id?, user_id?, scope?, mine_only?)` — delete by event or scoped filters, defaulting to your own memories

### Scoped memory model

Project memory is scoped per repository using a stable `group_id` derived from the git remote origin URL (SHA-256, first 16 chars). Renaming the local folder does not change the scope. Repos without a remote fall back to a hash of the directory name.

Global memory uses a stable per-user `group_id` derived from `userId`, allowing the plugin to carry user preferences across repositories without leaking project history between them.

### Local memory lane

Explicit `evermemos_remember` writes are also persisted locally at:

- Linux/macOS: `~/.config/opencode/evermemos-local.json`
- Windows: `%USERPROFILE%\.config\opencode\evermemos-local.json`
- Override: `EVERMEMOS_LOCAL_STORE_PATH`

This gives fast, deterministic recall even when EverMemOS retrieval is slow or noisy. Local hits are stored in scope-specific namespaces and merged with backend results during recall. Up to 300 entries are kept per scope; oldest entries are trimmed when the limit is reached.

### Profile recall

EverMemOS extracts **profile memories** — stable facts about you as a developer (preferences, conventions, working style) — separately from episodic memories. The plugin fetches project profile memories and global profile memories independently from the search endpoint and injects them alongside project episodic recall on every turn. Configure with `injectProfileRecall`, `profileRecallLimit`, and `globalProfileRecallLimit`.

### Preference promotion

When the same project-scoped profile preference is seen across multiple distinct repositories, the plugin can conservatively promote it into global profile memory. Promotion only applies to writes classified as project `profile`, requires repeated exact matches across separate project scopes, and can be disabled if you want fully manual global memory.

## Prerequisites

### 1. Set up the memory backend (EverMemOS)

Clone and configure EverMemOS:

```bash
git clone https://github.com/EverMind-AI/EverMemOS
cd EverMemOS
cp env.template .env
```

Edit `.env` and fill in your API keys:

```dotenv
# LLM extraction
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=sk-REPLACE_ME

# Embeddings
VECTORIZE_PROVIDER=vllm
VECTORIZE_BASE_URL=https://api.openai.com/v1
VECTORIZE_MODEL=text-embedding-3-small
VECTORIZE_API_KEY=sk-REPLACE_ME

VECTORIZE_FALLBACK_PROVIDER=none
RERANK_FALLBACK_PROVIDER=none
```

Start the memory backend with Docker:

```bash
docker compose up -d
```

> Add `restart: unless-stopped` to each service in `docker-compose.yml` so the backend starts automatically with Docker on every boot — you won't have to think about it again.

Then start the EverMemOS API server:

```bash
# Linux/macOS
uv run python src/run.py --port 1995

# Windows (PowerShell)
$env:PYTHONIOENCODING="utf-8"
py -m uv run python src/run.py --port 1995
```

**OpenAI compatibility note:** If using `LLM_BASE_URL=https://api.openai.com/v1`, ensure the `"provider"` field in `src/memory_layer/llm/openai_provider.py` is only sent for OpenRouter URLs. The OpenAI API rejects unknown fields with HTTP 400.

### 2. Install the plugin

```bash
npm install -g opencode-evermemos-plugin
```

### 3. Register with OpenCode

Find the global install path:

```bash
# Linux/macOS
npm root -g
# → e.g. /usr/local/lib/node_modules

# Windows (PowerShell)
npm root -g
# → e.g. C:\Users\you\AppData\Roaming\npm\node_modules
```

Add to your OpenCode config (`%USERPROFILE%\.config\opencode\opencode.json` on Windows, `~/.config/opencode/opencode.json` on Linux/macOS):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///path/from-npm-root-g/opencode-evermemos-plugin/dist/index.js"]
}
```

**Example (Windows):**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///C:/Users/you/AppData/Roaming/npm/node_modules/opencode-evermemos-plugin/dist/index.js"]
}
```

Open any repository with a git `origin` remote in OpenCode and start chatting — the plugin activates automatically.

## Configuration

Configuration precedence: **env vars > JSONC file > built-in defaults**

Default config file path:

- Linux/macOS: `~/.config/opencode/evermemos.jsonc`
- Windows: `%USERPROFILE%\.config\opencode\evermemos.jsonc`
- Override: `EVERMEMOS_CONFIG_PATH`

Recommended JSONC config (local EverMemOS on `:1995`):

```jsonc
{
  "baseUrl": "http://localhost:1995",
  "userId": "opencode-user",
  "retrieveMethod": "keyword",
  "recallTopK": 5,
  "injectProfileRecall": true,
  "profileRecallLimit": 3,
  "globalProfileRecallLimit": 4,
  "enableGlobalScope": true,
  "enablePreferencePromotion": true,
  "promotionMinProjects": 2,
  "recallTimeoutMs": 20000,
  "writeTimeoutMs": 20000,
  "toolOutputMaxChars": 2048,
  "maxInjectedChars": 3500,
  "senderId": "opencode-user"
}
```

> Built-in `baseUrl` default is `http://localhost:8000`. For local EverMemOS set `http://localhost:1995`.

Supported env vars:

| Variable | Default | Description |
|---|---|---|
| `EVERMEMOS_BASE_URL` | `http://localhost:8000` | EverMemOS server URL |
| `EVERMEMOS_CONFIG_PATH` | — | Override path to JSONC config |
| `EVERMEMOS_RECALL_TIMEOUT_MS` | `300` | Timeout for recall requests (ms) |
| `EVERMEMOS_WRITE_TIMEOUT_MS` | `500` | Timeout for write requests (ms) |
| `EVERMEMOS_TOOL_OUTPUT_MAX_CHARS` | `2048` | Max chars per stored tool summary |
| `EVERMEMOS_MAX_INJECTED_CHARS` | `3500` | Hard cap for total injected memory context |
| `EVERMEMOS_RETRIEVE_METHOD` | `hybrid` | `keyword\|vector\|hybrid\|rrf` |
| `EVERMEMOS_RECALL_TOP_K` | `5` | Number of memories to recall |
| `EVERMEMOS_INJECT_PROFILE_RECALL` | `true` | Fetch and inject profile memories |
| `EVERMEMOS_PROFILE_RECALL_LIMIT` | `3` | Max profile memories to inject |
| `EVERMEMOS_GLOBAL_PROFILE_RECALL_LIMIT` | `4` | Max global profile memories to inject |
| `EVERMEMOS_ENABLE_GLOBAL_SCOPE` | `true` | Enable global user-wide memory scope |
| `EVERMEMOS_ENABLE_PREFERENCE_PROMOTION` | `true` | Promote repeated project preferences into global profile memory |
| `EVERMEMOS_PROMOTION_MIN_PROJECTS` | `2` | Distinct project scopes required before promotion |
| `EVERMEMOS_USER_ID` | OS username | Stable user identity for scoped reads/writes |
| `EVERMEMOS_SENDER_ID` | `opencode-user` | Sender ID written to EverMemOS |
| `EVERMEMOS_LOCAL_STORE_PATH` | `~/.config/opencode/evermemos-local.json` | Override path for local memory store |

Windows PowerShell example:

```powershell
$env:EVERMEMOS_BASE_URL = "http://localhost:1995"
$env:EVERMEMOS_RETRIEVE_METHOD = "keyword"
$env:EVERMEMOS_RECALL_TOP_K = "5"
```

## Validated behavior

### Cross-session passive recall (confirmed)

In a fresh session with no prior context, asking *"what's my coding preference for this project?"* returned the correct answer from memories stored in a previous session — without any explicit tool call. The model answered naturally from injected system prompt context.

### Explicit tool round-trip (confirmed)

```
User: evermemos_remember "User prefers small focused patches and TypeScript strict mode"
→ Memory stored successfully.

User: evermemos_recall query "coding preference"
→ ## Recalled project memories
  1. [episodic_memory] ... React, TypeScript, Tailwind CSS preferences ...
  2. [local_memory] User prefers small focused patches and TypeScript strict mode
```

### Meta-noise prevention (confirmed)

Plugin tool calls (`evermemos_recall`, `evermemos_remember`, `evermemos_forget`) are never stored as memories. User messages that look like plugin invocations are also skipped. This prevents recall results from being polluted with entries like *"User called evermemos_remember..."*.

## Manual E2E test plan

1. Start EverMemOS locally.
2. Build the plugin (`npm run build`) and register it in OpenCode config.
3. Open a repo with a git `origin` remote in OpenCode.
4. Send a message with project-specific context (e.g. stack preferences).
5. Close the session. Open a new session in the same repo.
6. Ask naturally — e.g. *"what's my preferred stack?"* — without any tool calls.
7. Verify the model answers correctly from injected recalled memories.
8. Test explicit tools: `evermemos_remember`, `evermemos_recall`, `evermemos_forget`.
9. Send a message containing `<private>secret</private>` and confirm it is not stored.
10. Stop EverMemOS and verify chat continues without crashing (fail-open).

## Privacy behavior

All content sent to EverMemOS passes through `sanitize()`:

- Strips `<private>...</private>` blocks
- Redacts API keys, tokens, bearer credentials, PEM private keys, and credential URLs
- Truncates oversized content to configured max length

Plugin tool invocations and messages referencing plugin tools are never stored, preventing meta-noise accumulation over time.
