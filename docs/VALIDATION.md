# Plugin Validation — End-to-End Test Results

Tested on: 2026-04-09  
Plugin version: 0.1.1 (local build)  
Memory backend: EverMemOS running locally on `:1995`  
OpenCode project: `iiitd-grade-dash` (Next.js + Tailwind + Drizzle ORM)

---

## Test 1 — Passive recall on first message of a fresh session

**What we tested:** Does the model answer from recalled memories when the very first message of a new session asks about something stored in a previous session?

**Session 1** — planted three memories:
1. TypeScript preference (via `evermemos_remember`): "prefers `const` over `let`, avoids `any`, TypeScript strict mode"
2. Known bug (via passive `chat.message` hook): auth flow bug — users logged out after 30 minutes despite 7-day session intent
3. Schema constraint (via `evermemos_remember`): "database schema is at `src/db/schema.ts`, don't touch `users` table without asking"

**Session 2** — fresh session, no prior context, three questions asked cold:

| Question | Expected | Result |
|---|---|---|
| "What TypeScript conventions should you follow in this project?" | const, no any, strict mode | ✅ Answered correctly from memory, no file browsing |
| "Is there any known bug I should be aware of?" | Auth flow, 30-min logout | ✅ Answered correctly from memory, no file browsing |
| "Where's the database schema and are there any tables I should be careful with?" | src/db/schema.ts, users table needs permission | ✅ Answered correctly from memory, no file browsing |

**Model's own reasoning (from session 2, Q1 thinking log):**
> "I'm cross-referencing recalled memories to formulate the recommendations."

**Verdict: PASS** — passive recall fired on the first message of a fresh session across all three memory types.

---

## Test 2 — Cross-session recall confirmed (earlier run)

In a prior test session, the model was asked *"What stack is this project using?"* as the first message of a completely fresh session.

**Model's thinking log:**
> "I've streamlined the answer by prioritizing the **recalled memory** about the tech stack... I considered verifying this with package.json, but the effort seemed unnecessary given the certainty of the memory."

**Result:** Answered Next.js, Tailwind CSS, Drizzle ORM, TypeScript strict mode — correctly, without browsing any files.

**Verdict: PASS**

---

## Bug fixed during testing

**Bug:** Passive recall never fired on the first message of a new session.

**Root cause:** `experimental.chat.system.transform` relies on `getCachedUserMessage(sessionId)`. In a fresh session the cache is empty, so `if (!query) return` exited early — zero memories injected on the first message.

**Fix:** Fall back to a broad default query (`"project context preferences stack technology"`) when the cache is empty, so recall always fires. Also added local memory lane hits to the system prompt injection (previously only available through the explicit `evermemos_recall` tool).

**Verified:** Re-ran the cross-session test after the fix — recall fired correctly on the first message.

---

## What's working

- **Passive storage** — user messages stored to EverMemOS automatically via `chat.message` hook
- **Explicit storage** — `evermemos_remember` tool stores to both EverMemOS backend and local memory lane
- **Passive recall** — memories injected into system prompt before every model response via `experimental.chat.system.transform`
- **First-message recall** — fallback query ensures recall fires even when session cache is cold
- **Local memory lane** — explicitly stored memories recalled locally, merged ahead of backend results
- **Meta-noise prevention** — plugin's own tool calls never stored as memories
- **Project isolation** — memory scoped per repo via SHA-256 hash of git remote URL
- **Fail-open** — EverMemOS being down does not crash or block the chat
