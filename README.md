# opencode-evermemos-plugin

Durable project memory for OpenCode using EverMemOS.

The plugin captures sanitized user and tool context, stores it in EverMemOS, and automatically recalls relevant memories into the system prompt on every turn — no explicit commands needed. Memory is scoped per repository and persists across sessions.

## How it works

### Passive (automatic, no user action required)

- Every user message is sanitized and stored in EverMemOS silently in the background.
- Before each model response, relevant memories from past sessions are recalled and injected into the system prompt automatically via `experimental.chat.system.transform`.
- Tool outcomes (file edits, bash results) are summarized and stored after execution.
- During session compaction (context overflow), recalled memories are added to the compaction context so nothing important is lost.
- Session cache is pruned on idle to prevent unbounded memory growth.

### Explicit (model-controlled tools)

The model can also call memory tools directly when the user asks for targeted recall, wants to save something explicitly, or wants to clean up memories:

- `evermemos_recall(query, top_k?)` — recall relevant memories for the current project and return a compact summary
- `evermemos_remember(content, role?)` — sanitize and store a memory entry explicitly
- `evermemos_forget(event_id?, user_id?, current_project_only?)` — delete by event, user, or wipe the current project scope

### Project isolation

Memory is scoped per repository using a stable `group_id` derived from the git remote origin URL (SHA-256, first 16 chars). Renaming the local folder does not change the scope. Repos without a remote fall back to a hash of the directory name.

### Local memory lane

Explicit `evermemos_remember` writes are also persisted locally at:

- Linux/macOS: `~/.config/opencode/evermemos-local.json`
- Windows: `%USERPROFILE%\.config\opencode\evermemos-local.json`
- Override: `EVERMEMOS_LOCAL_STORE_PATH`

This gives fast, deterministic recall for explicitly stored preferences even when EverMemOS retrieval is slow or noisy. Local hits are merged ahead of backend results in recall output.

## Requirements

- Node.js 22+
- OpenCode with plugin support
- Running EverMemOS server

## Install

```bash
npm install
npm run build
```

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
  "retrieveMethod": "keyword",
  "recallTopK": 5,
  "injectProfileRecall": true,
  "profileRecallLimit": 3,
  "recallTimeoutMs": 20000,
  "writeTimeoutMs": 20000,
  "toolOutputMaxChars": 2048,
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
| `EVERMEMOS_RETRIEVE_METHOD` | `hybrid` | `keyword\|vector\|hybrid\|rrf` |
| `EVERMEMOS_RECALL_TOP_K` | `5` | Number of memories to recall |
| `EVERMEMOS_INJECT_PROFILE_RECALL` | `true` | Fetch and inject profile memories |
| `EVERMEMOS_PROFILE_RECALL_LIMIT` | `3` | Max profile memories to inject |
| `EVERMEMOS_SENDER_ID` | `opencode-user` | Sender ID written to EverMemOS |

Windows PowerShell example:

```powershell
$env:EVERMEMOS_BASE_URL = "http://localhost:1995"
$env:EVERMEMOS_RETRIEVE_METHOD = "keyword"
$env:EVERMEMOS_RECALL_TOP_K = "5"
```

## Load in OpenCode

Build the plugin:

```bash
npm run build
```

Register in OpenCode config (`%USERPROFILE%\.config\opencode\opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///C:/Users/<your-user>/Desktop/my_projects/opencode-evermemos-plugin/dist/index.js"]
}
```

Open any repository with a git `origin` remote and start chatting — the plugin activates automatically.

## EverMemOS setup

Start EverMemOS locally (Windows):

```powershell
$env:PYTHONIOENCODING="utf-8"
py -m uv run python src/run.py --port 1995
```

Known-good `.env` block (OpenAI-only path):

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

**OpenAI compatibility note:** If using `LLM_BASE_URL=https://api.openai.com/v1`, ensure the `"provider"` field in `openai_provider.py` is only sent for OpenRouter URLs. The OpenAI API rejects unknown fields with HTTP 400.

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
