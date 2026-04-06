# Testing Guide

This document describes the full local end-to-end test flow for `opencode-evermemos-plugin`.
For the shortest OpenAI-only setup path, see `OPENAI_QUICKSTART.md`.

## Preconditions

- EverMemOS repo exists at `$HOME\Desktop\my_projects\EverMemOS-main`
- Plugin repo exists at `$HOME\Desktop\my_projects\opencode-evermemos-plugin`
- Docker Desktop is running
- OpenCode local build supports plugins
- You have a test git repository with an `origin` remote

## Known-good order (important)

Follow this order exactly:

1. Start EverMemOS and verify `/health`
2. Build this plugin (`npm run build`)
3. Configure OpenCode plugin loading in `~/.config/opencode/opencode.json`
4. Restart OpenCode
5. Verify tool IDs include `evermemos_*`
6. Run memory behavior tests

## 1) Start EverMemOS (correct way)

EverMemOS is a Python project (not npm at repo root).

```powershell
cd $HOME\Desktop\my_projects\EverMemOS-main

docker compose up -d

# Install uv once (skip if already installed)
py -m pip install --user uv

py -m uv sync
Copy-Item env.template .env
```

## 2) Set minimum required EverMemOS `.env` keys

Edit `$HOME\Desktop\my_projects\EverMemOS-main\.env` and set at least these values:

```dotenv
# LLM (memory extraction)
LLM_PROVIDER=openai
LLM_MODEL=x-ai/grok-4-fast
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-v1-REPLACE_ME

# Embedding
VECTORIZE_PROVIDER=deepinfra
VECTORIZE_API_KEY=REPLACE_ME
VECTORIZE_BASE_URL=https://api.deepinfra.com/v1/openai
VECTORIZE_MODEL=Qwen/Qwen3-Embedding-4B

# Rerank
RERANK_PROVIDER=deepinfra
RERANK_API_KEY=REPLACE_ME
RERANK_BASE_URL=https://api.deepinfra.com/v1/inference
RERANK_MODEL=Qwen/Qwen3-Reranker-4B
```

Notes:
- Keep database defaults from `env.template` (`MongoDB`, `Milvus`, `Elasticsearch`, `Redis`) since Docker compose starts them.
- If you already have compatible keys/providers, use those instead.

### OpenAI-only minimal variant (if you only have OpenAI key)

If you only have an OpenAI API key, use this simpler `.env` setup:

```dotenv
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-REPLACE_ME

VECTORIZE_FALLBACK_PROVIDER=none
RERANK_FALLBACK_PROVIDER=none
```

When using this variant, set plugin retrieval to keyword-only in `evermemos.jsonc`:

```json
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

## 3) Run EverMemOS API

```powershell
cd $HOME\Desktop\my_projects\EverMemOS-main
py -m uv run python src/run.py --port 1995
```

Health check in another terminal:

```powershell
curl http://localhost:1995/health
```

Expected result:
- Health endpoint returns a healthy response.

## 4) Create plugin config file

Point plugin to EverMemOS on port `1995`.

Open in Notepad (quick edit):

```powershell
notepad $HOME\.config\opencode\evermemos.jsonc
```

```powershell
$cfgDir = Join-Path $HOME ".config\opencode"
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$json = @"
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
"@
$json | Set-Content (Join-Path $cfgDir "evermemos.jsonc")
```

Optional override:
- Set `EVERMEMOS_CONFIG_PATH` to use a different config file path.

## 5) Build/typecheck plugin

```powershell
cd $HOME\Desktop\my_projects\opencode-evermemos-plugin
cmd /c npm run typecheck
cmd /c npm run build
```

Expected result:
- Both commands succeed.

## 6) Register plugin in OpenCode config (required)

Create or edit:
- `$HOME\.config\opencode\opencode.json`

Open in Notepad (quick edit):

```powershell
notepad $HOME\.config\opencode\opencode.json
```

Use this exact content:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///C:/Users/<your-user>/Desktop/my_projects/opencode-evermemos-plugin/dist/index.js"]
}
```

Then fully restart OpenCode.

Expected result:
- OpenCode starts without config parse errors.

## 7) Verify plugin tools are loaded before behavior testing

In OpenCode, ask:

`List all available tools by exact tool ID.`

Expected result includes:

- `default_api:evermemos_recall`
- `default_api:evermemos_remember`
- `default_api:evermemos_forget`

## 8) Core memory loop test

In a test repository with `origin`:

1. Send message:
   `Remember this: project uses Fastify + Prisma, prefer small focused patches.`
2. Send follow-up:
   `What stack are we using and what patch style do I prefer?`
3. Trigger at least one tool action (for example an edit).
4. Send a private tag message:
   `this is secret <private>abc123</private> done`

Expected result:
- Follow-up reflects recalled memory.
- Tool activity is summarized and stored.
- `<private>...</private>` content is redacted before storage.

### Exact prompts to send in OpenCode (copy-paste)

1. `Remember this for future coding sessions: This portfolio uses React + TypeScript + Tailwind CSS. I prefer small, focused patches and no unrelated refactors.`
2. `What project stack and patch style did I just tell you?`
3. `Create a tiny change: add a short HTML comment in the main page file saying "Memory plugin test marker", then tell me which file you changed.`
4. `this is secret <private>my_api_key_123456789</private> do not store raw secret`
5. `Use evermemos_recall with query "project stack and patch style" and show me the result.`
6. `Use evermemos_remember to store: "User prefers concise commit messages."`
7. `Use evermemos_recall with query "commit message preference" and show me the result.`
8. Optional cleanup: `Use evermemos_forget with current_project_only=true and tell me the result.`

## 9) Explicit tools test

Ask the model to run:

1. `evermemos_recall` with query like `stack and patch preference`
2. `evermemos_remember` with manual note content
3. `evermemos_forget` with either:
   - specific `event_id`, or
   - `current_project_only=true`

Expected result:
- Each tool returns success/failure text without crashing session.
- `evermemos_forget` refuses broad delete without scope.

## 10) Fail-open test

1. Stop EverMemOS while OpenCode session is active.
2. Continue chatting and executing tools.

Expected result:
- Session continues normally.
- Recall/storage may be skipped, but no hard failure occurs.

## 11) Recovery test

1. Restart EverMemOS.
2. Send a new remember message.
3. Run a recall query.

Expected result:
- Memory operations recover and continue working.

## Quick Pass/Fail Checklist

- [ ] EverMemOS health endpoint is reachable on `http://localhost:1995/health`
- [ ] Plugin typecheck passes
- [ ] Plugin build passes
- [ ] OpenCode config has plugin entry using `file:///.../dist/index.js`
- [ ] Tool list includes `default_api:evermemos_recall`
- [ ] Tool list includes `default_api:evermemos_remember`
- [ ] Tool list includes `default_api:evermemos_forget`
- [ ] Auto recall works in `experimental.chat.system.transform`
- [ ] Profile recall is injected from `/api/v1/memories`
- [ ] Compaction context added in `experimental.session.compacting`
- [ ] Tool summary storage works in `tool.execute.after`
- [ ] Explicit tools (`recall`, `remember`, `forget`) work
- [ ] `<private>...</private>` content is redacted
- [ ] EverMemOS outage does not break chat (fail-open)
- [ ] Recovery after EverMemOS restart works

## Troubleshooting: OpenCode Plugin Config and Tool Visibility

If OpenCode says `evermemos_recall` (or other EverMemOS tools) is unavailable, use this flow.

### A) Verify OpenCode config file location

Run:

```powershell
Get-ChildItem -Force $HOME\.config\opencode
Get-ChildItem -Force $HOME\AppData\Roaming\opencode
```

Find plugin references:

```powershell
rg -n "plugin|opencode-evermemos-plugin" $HOME\.config\opencode $HOME\AppData\Roaming\opencode -S
```

### B) Verify plugin entry in OpenCode config

Open:

`$HOME\.config\opencode\opencode.json`

Use this known-good value:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///C:/Users/<your-user>/Desktop/my_projects/opencode-evermemos-plugin/dist/index.js"]
}
```

### C) Rebuild plugin and restart OpenCode

```powershell
cd $HOME\Desktop\my_projects\opencode-evermemos-plugin
cmd /c npm run typecheck
cmd /c npm run build
```

Then fully close and reopen OpenCode.

### D) Confirm tools are registered

In OpenCode, ask:

`List all available tools by exact tool ID.`

Expected to include:

- `default_api:evermemos_recall`
- `default_api:evermemos_remember`
- `default_api:evermemos_forget`

### E) If tools still do not appear

- Confirm you restarted the same OpenCode profile/config where plugin is enabled.
- Confirm `opencode.json` is valid JSONC (no broken URL line wrapping).
- Continue validating auto hooks (`chat.message`, `system.transform`, `tool.execute.after`) while fixing tool registration.
- Re-check plugin path for typos and escaping issues.

### F) PowerShell pitfalls seen in practice

- If `rg` is not installed, use `Get-ChildItem` + `Select-String` instead.
- For npm `--prefix` in PowerShell:
  - Use `cmd /c npm --prefix "%USERPROFILE%\.config\opencode" install`
  - or use native form: `npm --prefix "$HOME\.config\opencode" install`
- If JSON becomes invalid due to wrapped lines, edit with Notepad and paste exact JSON.

### G) EverMemOS OpenAI provider patch

If using OpenAI base URL in EverMemOS (`https://api.openai.com/v1`), ensure:
- `C:\Users\<your-user>\Desktop\my_projects\EverMemOS-main\src\memory_layer\llm\openai_provider.py`
- includes `"provider"` in request payload only when base URL is OpenRouter.

Otherwise OpenAI may return `400` for unknown `provider` field.
