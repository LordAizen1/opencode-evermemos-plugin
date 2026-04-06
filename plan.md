# OpenCode EverMemOS Plugin Plan

## Goal

Provide durable, project-scoped memory for OpenCode sessions using EverMemOS while keeping chat latency low and failing open on network or service issues.

## Status

All phases from the original roadmap are now implemented.

### Implemented Hooks

In [src/index.ts](C:\Users\mohdk\Desktop\my_projects\opencode-evermemos-plugin\src\index.ts):

1. `chat.message`
- Extracts user text.
- Sanitizes content.
- Caches latest user message by `sessionID`.
- Performs fire-and-forget memory write to EverMemOS.

2. `experimental.chat.system.transform`
- Reads cached user query for the current session.
- Performs best-effort episodic memory search.
- Fetches profile memories from `/api/v1/memories` separately.
- Injects merged episodic + profile memory blocks into system prompt.

3. `tool.execute.after`
- Builds and sanitizes a summary of tool activity.
- Stores summary asynchronously as assistant memory.

4. `tool` (explicit tools)
- `evermemos_recall(query, top_k?)`
- `evermemos_remember(content, role?)`
- `evermemos_forget(event_id?, user_id?, current_project_only?)`

5. `experimental.session.compacting`
- Adds compact recalled memory context to compaction input.

6. `event`
- On `session.idle`, prunes expired session-cache entries.

### Implemented Core Modules

- [src/client.ts](C:\Users\mohdk\Desktop\my_projects\opencode-evermemos-plugin\src\client.ts)
  Typed EverMemOS client with search, profile-list fetch, memorize, and delete methods.
- [src/config.ts](C:\Users\mohdk\Desktop\my_projects\opencode-evermemos-plugin\src\config.ts)
  Config loading with precedence: env > JSONC file > defaults.
- [src/git.ts](C:\Users\mohdk\Desktop\my_projects\opencode-evermemos-plugin\src\git.ts)
  Stable `group_id` from git `origin` hash (fallback to directory basename hash).
- [src/memory.ts](C:\Users\mohdk\Desktop\my_projects\opencode-evermemos-plugin\src\memory.ts)
  Episodic/profile/compaction formatting and tool-summary shaping.
- [src/sanitize.ts](C:\Users\mohdk\Desktop\my_projects\opencode-evermemos-plugin\src\sanitize.ts)
  Privacy filtering and redaction.
- [src/session-cache.ts](C:\Users\mohdk\Desktop\my_projects\opencode-evermemos-plugin\src\session-cache.ts)
  Session cache and TTL pruning.
- [src/types.ts](C:\Users\mohdk\Desktop\my_projects\opencode-evermemos-plugin\src\types.ts)
  Shared type definitions.

## Runtime Characteristics

- Fail-open behavior for EverMemOS outages and timeout paths.
- Time-bounded reads/writes.
- Automatic repo-level memory isolation using computed `group_id`.
- Async write paths to avoid blocking chat responsiveness.

## Verification Checklist

1. `chat.message` caches and writes sanitized messages.
2. `system.transform` injects merged episodic + profile recall when available.
3. `experimental.session.compacting` adds compact recalled context.
4. Explicit memory tools work for recall/remember/forget.
5. `tool.execute.after` stores bounded summaries.
6. EverMemOS offline path does not break chat.
7. `<private>...</private>` and common secrets are redacted before writes.
8. `session.idle` prunes cache entries.
9. Typecheck passes.

## Next Focus (Optional)

- Add automated tests (unit + integration stubs for client and hook behavior).
- Add optional structured logging for operational observability.
- Add stricter response schema validation for EverMemOS endpoints.
