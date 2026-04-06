# opencode-evermemos-plugin

Durable project memory for OpenCode using EverMemOS.

This plugin captures sanitized user/tool context, stores it in EverMemOS, and recalls relevant memories into the system prompt on later turns.

## What it currently does

- Captures user text in `chat.message`, sanitizes it, caches by session, and stores it in EverMemOS.
- Recalls memories in `experimental.chat.system.transform` using the cached latest user message.
- Fetches profile memories through a separate `/api/v1/memories` path and merges them into recall injection.
- Adds compact recalled context during `experimental.session.compacting`.
- Captures tool outcomes in `tool.execute.after` as bounded summaries.
- Prunes stale session cache entries on `session.idle`.
- Exposes explicit memory tools for manual recall, store, and delete operations.
- Fails open for network/timeouts so chat flow is not blocked by EverMemOS issues.

## Explicit tools

- `evermemos_recall(query, top_k?)`
  Recall memories for the current project scope and return a compact summary block.
- `evermemos_remember(content, role?)`
  Sanitize and store a memory entry (`role`: `user` or `assistant`).
- `evermemos_forget(event_id?, user_id?, current_project_only?)`
  Delete by `event_id`, by `user_id`, or by current project scope.

## Requirements

- Node.js 22+
- OpenCode with plugin support
- Running EverMemOS server

## Install

```bash
npm install
npm run typecheck
```

## Configuration

Configuration is loaded with precedence:

1. Environment variables
2. JSONC config file
3. Built-in defaults

Default config file path:

- Linux/macOS: `~/.config/opencode/evermemos.jsonc`
- Windows: `%USERPROFILE%\.config\opencode\evermemos.jsonc`
- Optional override path: `EVERMEMOS_CONFIG_PATH`

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

- Built-in `baseUrl` fallback is `http://localhost:8000`, but for EverMemOS local API you should set `http://localhost:1995`.

Supported env vars:

- `EVERMEMOS_BASE_URL` (fallback default: `http://localhost:8000`)
- `EVERMEMOS_CONFIG_PATH` (optional, path to JSONC config file)
- `EVERMEMOS_RECALL_TIMEOUT_MS` (default: `300`)
- `EVERMEMOS_WRITE_TIMEOUT_MS` (default: `500`)
- `EVERMEMOS_TOOL_OUTPUT_MAX_CHARS` (default: `2048`)
- `EVERMEMOS_RETRIEVE_METHOD` (default: `hybrid`, allowed: `keyword|vector|hybrid|rrf`)
- `EVERMEMOS_RECALL_TOP_K` (default: `5`)
- `EVERMEMOS_INJECT_PROFILE_RECALL` (default: `true`)
- `EVERMEMOS_PROFILE_RECALL_LIMIT` (default: `3`)
- `EVERMEMOS_SENDER_ID` (default: `opencode-user`)

Windows PowerShell example:

```powershell
$env:EVERMEMOS_BASE_URL = "http://localhost:1995"
$env:EVERMEMOS_RETRIEVE_METHOD = "keyword"
$env:EVERMEMOS_RECALL_TOP_K = "5"
$env:EVERMEMOS_INJECT_PROFILE_RECALL = "true"
$env:EVERMEMOS_PROFILE_RECALL_LIMIT = "3"
```

OpenCode plugin registration (`%USERPROFILE%\.config\opencode\opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///C:/Users/<your-user>/Desktop/my_projects/opencode-evermemos-plugin/dist/index.js"]
}
```

Known-good EverMemOS `.env` block (OpenAI-only path):

```dotenv
# LLM extraction
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=sk-REPLACE_ME

# Embeddings (OpenAI-compatible endpoint through EverMemOS vllm provider path)
VECTORIZE_PROVIDER=vllm
VECTORIZE_BASE_URL=https://api.openai.com/v1
VECTORIZE_MODEL=text-embedding-3-small
VECTORIZE_API_KEY=sk-REPLACE_ME

# Keep fallbacks disabled for this minimal path
VECTORIZE_FALLBACK_PROVIDER=none
RERANK_FALLBACK_PROVIDER=none
```

EverMemOS OpenAI compatibility note:
- If EverMemOS uses `LLM_BASE_URL=https://api.openai.com/v1`, ensure in
  `C:\Users\<your-user>\Desktop\my_projects\EverMemOS-main\src\memory_layer\llm\openai_provider.py`
  that request body field `"provider"` is only sent for OpenRouter URLs.
- OpenAI API may reject unknown `provider` with HTTP 400.

## Load in local OpenCode

1. Build or run OpenCode from your local source checkout.
2. Add this plugin to your OpenCode plugin configuration using the local path of this repository.
3. Start OpenCode and open a repo directory with a git `origin` remote.

The plugin computes `group_id` from `git remote get-url origin` (SHA-256 short hash), with directory-name fallback when no remote exists.

## Manual E2E test plan

1. Start EverMemOS locally.
2. Start local OpenCode with this plugin enabled.
3. In a test repository, send a project-specific user message.
4. Ask a follow-up question that should benefit from recall.
5. Perform a tool action (for example, an edit) and verify a tool summary is stored.
6. Send text containing `<private>secret</private>` and confirm private block redaction.
7. Stop EverMemOS and continue chatting; verify plugin fails open (no chat crash, recall may be skipped).
8. Re-enable EverMemOS and verify writes/recall recover.

## Real Session Example (Sanitized)

A full exported run is included at:
- `session-ses_29db.md`

In this run, the plugin tools were used successfully end-to-end:

1. `evermemos_remember` stored project preferences:
   - "React + TypeScript + Tailwind CSS"
   - "small, focused patches; no unrelated refactors"
2. `evermemos_recall` returned recalled episodic memories for:
   - query: `"project stack and patch style"`
   - query: `"commit message preference"`
3. `evermemos_remember` stored:
   - `"User prefers concise commit messages."`
4. `evermemos_forget` with `current_project_only=true` returned:
   - `Delete request sent successfully.`

The session also includes a privacy test message using `<private>...</private>` to validate secret-safe handling behavior.

Expected output (sample):

```text
Tool: evermemos_remember
Input:  {"content":"User prefers concise commit messages."}
Output: Memory stored successfully.

Tool: evermemos_recall
Input:  {"query":"commit message preference"}
Output:
## Recalled project memories
1. [episodic_memory] ... user instructed evermemos_remember ...
2. [episodic_memory] ... coding preferences for portfolio project ...

Tool: evermemos_forget
Input:  {"current_project_only":true}
Output: Delete request sent successfully.
```

## Privacy behavior

All outbound memory content goes through `sanitize()`:

- strips `<private>...</private>` blocks
- redacts common secret/token patterns
- truncates oversized content

Use conservative review when storing command output or logs that may include sensitive values.

## Current limitations

Not implemented yet:

- no major planned gaps from the original roadmap remain
