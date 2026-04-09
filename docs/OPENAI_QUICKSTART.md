# OpenAI Quickstart (Windows)

This runbook is the shortest working path for your setup:
- EverMemOS at `$HOME\Desktop\my_projects\EverMemOS-main`
- Plugin at `$HOME\Desktop\my_projects\opencode-evermemos-plugin`
- OpenCode local desktop/CLI
- You have an OpenAI API key

## 1) Edit EverMemOS `.env`

Open `.env`:

```powershell
notepad $HOME\Desktop\my_projects\EverMemOS-main\.env
```

Set these values (replace `sk-...`):

```dotenv
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=sk-...

VECTORIZE_PROVIDER=vllm
VECTORIZE_BASE_URL=https://api.openai.com/v1
VECTORIZE_MODEL=text-embedding-3-small
VECTORIZE_API_KEY=sk-...

VECTORIZE_FALLBACK_PROVIDER=none
RERANK_FALLBACK_PROVIDER=none
```

Notes:
- `VECTORIZE_PROVIDER=vllm` is used as the OpenAI-compatible path in this codebase.
- You do not need local `localhost:8000` vLLM for this config.

## 2) Plugin config (`evermemos.jsonc`)

Open:

```powershell
notepad $HOME\.config\opencode\evermemos.jsonc
```

Use:

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

## 3) OpenCode plugin registration

Open:

```powershell
notepad $HOME\.config\opencode\opencode.json
```

Use:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///C:/Users/<your-user>/Desktop/my_projects/opencode-evermemos-plugin/dist/index.js"]
}
```

## 4) Build plugin

```powershell
cd $HOME\Desktop\my_projects\opencode-evermemos-plugin
cmd /c npm run build
```

## 5) Start EverMemOS and capture logs

```powershell
cd $HOME\Desktop\my_projects\EverMemOS-main
$env:PYTHONIOENCODING="utf-8"
py -m uv run python src/run.py --port 1995 *>&1 | Tee-Object -FilePath "$HOME\Desktop\my_projects\output.txt"
```

Health check (in another terminal):

```powershell
curl http://localhost:1995/health
```

## 6) Restart OpenCode

Fully close and reopen OpenCode after config/plugin/env changes.

## 7) Verify tools in OpenCode

Prompt:

`List all available tools by exact tool ID.`

You should see:
- `default_api:evermemos_recall`
- `default_api:evermemos_remember`
- `default_api:evermemos_forget`

## 8) Exact prompts to test memory

Run these in order:

1. `Use evermemos_remember to store: "MEMTEST_OPENAI_PATH"`
2. `Use evermemos_recall with query "MEMTEST_OPENAI_PATH" and show me the result.`
3. `Use evermemos_remember to store: "project stack React TypeScript Tailwind and patch style focused patches"`
4. `Use evermemos_recall with query "project stack and patch style" and show me the result.`

## 9) If recall still fails

Check `$HOME\Desktop\my_projects\output.txt` for:
- `HTTP Error 401` -> key invalid/wrong variable.
- connection errors to `localhost:8000` -> `.env` not applied or wrong provider settings still present.
- `No matching memories found` with no API errors -> memory inserted but query mismatch; retry with a more exact keyword query.

## 10) EverMemOS provider compatibility note

If your EverMemOS LLM path uses OpenAI base URL (`https://api.openai.com/v1`), ensure:
- `C:\Users\<your-user>\Desktop\my_projects\EverMemOS-main\src\memory_layer\llm\openai_provider.py`
- only sends `"provider"` in request body for OpenRouter URLs.

Reason:
- OpenAI API rejects unknown `provider` field with `400`.
