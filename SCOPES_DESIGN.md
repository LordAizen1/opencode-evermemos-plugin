# Global And Project Scope Design

This document defines the scope model for `opencode-evermemos-plugin`.

The goal is to support both:

- `project` memory for repo-specific knowledge
- `global` memory for user-wide preferences and habits

This is the model the plugin should implement going forward.

## Why Two Scopes Are Necessary

Project-only memory is too narrow:

- every repo has to relearn the same user preferences
- the agent feels forgetful across projects

Global-only memory is too noisy:

- architecture and stack from one repo contaminate another
- task history leaks between unrelated projects

The correct design is dual-scope:

- `project` for codebase-specific memory
- `global` for user-specific persistent preferences

## Scope Definitions

### Project Scope

Project scope stores memories that should remain isolated to one repository or worktree.

Examples:

- stack for this repo
- architecture decisions
- conventions used only here
- recent file changes
- bug fixes and their context
- future work for this codebase
- exact symbol or module knowledge

### Global Scope

Global scope stores memories that should follow the user across all repositories.

Examples:

- prefers small focused patches
- dislikes unrelated refactors
- prefers concise commit messages
- prefers TypeScript over JavaScript
- likes explanation before large changes
- testing preferences

## Scope Identity Model

Use an explicit `ScopeContext`:

```ts
type MemoryScope = "project" | "global"

type ScopeContext = {
  userId: string
  projectGroupId: string
  globalGroupId: string
}
```

### Project Group ID

Continue using the current repo-derived group ID:

```ts
projectGroupId = computeGroupId(directory)
```

This should remain based on git remote hash, with directory fallback.

### Global Group ID

Add a stable per-user global group ID:

```ts
globalGroupId = `oc_global_v1_${sha256(userId).slice(0, 16)}`
```

This avoids mixing all memories under raw `user_id` only, which would make retrieval too broad.

## EverMemOS Mapping

Every request should include `user_id` where possible.

### Writes

All memory writes should include:

- `sender = userId`
- `group_id = projectGroupId` for project memory
- `group_id = globalGroupId` for global memory

### Reads

All memory reads should include:

- `user_id = userId`
- `group_id = projectGroupId` or `globalGroupId`

This is critical for correctness.

Do not implement global memory as:

- `user_id = userId` with no group boundary for all memory types

That would cause project-specific episodic memory to leak into global recall.

## What Should Be Stored In Each Scope

| Signal | Scope | Memory Type | Why |
|---|---|---|---|
| "Prefer small focused patches" | global | profile | user habit across repos |
| "Avoid unrelated refactors" | global | profile | stable preference |
| "This repo uses Fastify + Prisma" | project | profile | repo fact |
| "Auth is middleware-first here" | project | profile | codebase convention |
| ordinary user message context | project | episodic_memory | task-local continuity |
| tool summary from edits | project | episodic_memory | project history |
| "Later add rate limiting here" | project | foresight | future work for this repo |
| "Always explain before big refactors" | global | profile | durable communication preference |

## Automatic Routing Rules

Automatic writes should be routed by a lightweight classifier.

### Routing Output

```ts
type RoutedWrite = {
  scope: "project" | "global"
  memoryType: "profile" | "episodic_memory" | "foresight"
  confidence: number
  reason: string
}
```

### Heuristics

#### Global Profile Cues

If content contains signals like:

- `prefer`
- `always`
- `never`
- `usually`
- `my style`
- `I like`
- `I prefer`
- `don't refactor`
- `commit style`
- `explain first`

Then route to:

- `scope = global`
- `memoryType = profile`

#### Project Profile Cues

If content contains signals like:

- `this repo`
- `this project`
- `this codebase`
- `we use`
- `architecture`
- `convention`
- `stack`
- `folder structure`

Then route to:

- `scope = project`
- `memoryType = profile`

#### Project Foresight Cues

If content contains signals like:

- `later`
- `next`
- `todo`
- `after this`
- `want to add`
- `next sprint`
- `eventually`

Then route to:

- `scope = project`
- `memoryType = foresight`

#### Default

If none of the above apply:

- `scope = project`
- `memoryType = episodic_memory`

### Tool Writes

`tool.execute.after` should always write:

- `scope = project`
- `memoryType = episodic_memory`

Tool activity should never become global automatically.

## Manual Tool API

The explicit tools should become scope-aware.

### `evermemos_recall`

```ts
evermemos_recall(query, scope = "both", top_k?)
```

Supported scopes:

- `project`
- `global`
- `both`

Behavior:

- `project` recalls project profile + project episodic + project foresight
- `global` recalls global profile
- `both` merges both, with project ranked above global

### `evermemos_remember`

```ts
evermemos_remember(content, scope = "auto", type = "auto", role?)
```

Behavior:

- `scope = auto` runs the classifier
- `scope = global` forces global write
- `scope = project` forces project write
- `type = auto` infers `profile`, `episodic_memory`, or `foresight`

### `evermemos_forget`

```ts
evermemos_forget(scope, event_id?, mine_only = true, confirm_broad = false)
```

Behavior:

- defaults to `mine_only = true`
- broad repo-wide or global delete requires explicit confirmation
- should include both `user_id` and `group_id` whenever possible

## Recall Strategy

Automatic recall before model calls should merge scopes in a fixed order.

### Automatic Recall Order

1. project profile
2. project episodic
3. project foresight
4. global profile

By default, do not automatically inject global episodic memory.

That can be added later, but it is too noisy for an initial design.

### Why This Order

- project facts matter most for current coding tasks
- recent project history helps continuity
- project foresight helps with follow-up planning
- global profile should shape behavior without overwhelming repo context

## Conflict Resolution

When memories conflict:

1. current user instruction wins
2. project memory beats global memory
3. newer memory beats older memory within the same scope/type
4. exact lexical matches beat semantic matches

Example:

- global: `prefer concise commit messages`
- project: `for this repo, use Conventional Commits`

The project memory should win during work in that repo.

## Injection Format

Merged recall should remain structured and compact.

Recommended injected format:

```md
## Memory Context

### Project Facts
- This repo uses Fastify + Prisma.
- Auth is middleware-first.

### Project History
- Added JWT expiry validation in `src/auth.ts`.

### Upcoming Work
- User wants rate limiting next.

### Global Preferences
- Prefer small focused patches.
- Avoid unrelated refactors.
```

### Size Limits

Automatic injection must be capped.

Recommended defaults:

- total injected chars: `3500`
- project profile: up to `3` items
- project episodic: up to `5` items
- project foresight: up to `2` items
- global profile: up to `4` items

## Local Fallback Design

The current local fallback should become scope-aware.

### Current Problem

Local fallback currently stores only by group ID namespace.

That is not enough once global scope exists.

### New Local Store Shape

```ts
type LocalMemoryStore = {
  version: 2
  spaces: Record<string, LocalMemoryEntry[]>
}
```

Local keys:

- `project:${projectGroupId}`
- `global:${globalGroupId}`

### Local Write Behavior

Whenever a memory is stored:

1. write to local scoped store first
2. attempt EverMemOS network write
3. fail open if network write fails

### Local Recall Behavior

Recall should only search within the requested scope namespace.

Never merge local project and local global memories before ranking logic.

## Config Design

Extend config with explicit scope settings.

```jsonc
{
  "baseUrl": "http://localhost:1995",
  "userId": "irfan",
  "retrieveMethod": "rrf",
  "recallTimeoutMs": 300,
  "writeTimeoutMs": 500,
  "toolOutputMaxChars": 2048,
  "maxInjectedChars": 3500,
  "scopes": {
    "project": {
      "enabled": true,
      "episodicTopK": 5,
      "foresightTopK": 2,
      "profileLimit": 3
    },
    "global": {
      "enabled": true,
      "profileLimit": 4,
      "autoWriteProfile": true,
      "autoRecallProfile": true
    }
  }
}
```

### Required Config Changes

- add `userId`
- add `maxInjectedChars`
- add nested `scopes`
- keep `senderId` only as a deprecated alias to `userId`

If `userId` is missing:

- disable global scope
- keep project scope working
- log or surface a warning in docs

## Required Type Changes

Update the request and config types in:

- `src/types.ts`

Add:

```ts
type MemoryScope = "project" | "global"

interface ScopeConfig {
  enabled: boolean
}

interface ProjectScopeConfig extends ScopeConfig {
  episodicTopK: number
  foresightTopK: number
  profileLimit: number
}

interface GlobalScopeConfig extends ScopeConfig {
  profileLimit: number
  autoWriteProfile: boolean
  autoRecallProfile: boolean
}
```

Also extend read payloads to support:

- `user_id`

That applies to:

- search payloads
- list/fetch payloads
- delete payloads

## Required Client Changes

Update:

- `src/client.ts`

Add dedicated methods:

- `searchProjectEpisodic(query, scopeContext)`
- `searchProjectForesight(query, scopeContext)`
- `listProjectProfile(scopeContext, limit)`
- `listGlobalProfile(scopeContext, limit)`
- `memorizeScoped(payload, scope)`
- `deleteScoped(payload, scope, mineOnly)`

All of these should pass `user_id`.

## Required Plugin Hook Changes

Update:

- `src/index.ts`

### `chat.message`

New behavior:

1. sanitize content
2. classify scope + memory type
3. cache the shaped recall query
4. write locally in chosen scope
5. fire-and-forget EverMemOS write in chosen scope

### `experimental.chat.system.transform`

New behavior:

1. derive project/global scope context
2. recall project profile
3. recall project episodic
4. recall project foresight
5. recall global profile
6. merge, rank, and clip
7. inject one bounded block

### `experimental.session.compacting`

New behavior:

- use the same scope-aware recall strategy, but with tighter limits

### `tool.execute.after`

New behavior:

- always route to project episodic
- keep existing self-tool skip logic
- add more aggressive filtering of noisy read/search tools

## Required New Modules

Add:

- `src/scope.ts`
- `src/classify.ts`
- `src/retrieval.ts`

### `scope.ts`

Owns:

- `projectGroupId`
- `globalGroupId`
- `userId`
- `ScopeContext`

### `classify.ts`

Owns:

- routing heuristics
- `scope = auto`
- `type = auto`

### `retrieval.ts`

Owns:

- multi-scope recall orchestration
- merging
- de-duplication
- ranking
- clipping to budget

## Ranking Rules

The merger should score memories roughly like this:

- project profile: high priority
- project episodic: medium-high priority
- project foresight: medium priority
- global profile: medium priority
- local fallback: lower than successful remote exact matches, but still usable

Additional boosts:

- lexical overlap with current query
- exact symbol matches
- recency
- complete sentences over clipped fragments

Additional penalties:

- plugin meta chatter
- tool noise
- read/search boilerplate
- duplicate content across scopes

## Migration Strategy

This should be implemented in two phases.

### Phase 1

Ship:

- explicit project/global scope model
- global profile only
- project profile + episodic + foresight
- scope-aware tools
- scope-aware local fallback
- safe delete semantics using both `user_id` and `group_id`

### Phase 2

Ship later:

- promotion of repeated project preferences to global profile
- optional global episodic recall
- stronger write classifiers
- evaluation automation

## Safety Requirements

These are non-negotiable:

1. project and global recall must be separated before merge
2. global profile fetches must include `user_id`
3. tool memories must remain project-scoped
4. delete must default to `mine only`
5. injection must remain hard-capped
6. current instruction always overrides memory

## Implementation Summary

The target design is:

- project memory for repo-specific facts, actions, and future work
- global memory for user-wide preferences
- explicit scope IDs for both
- explicit `user_id` on reads and writes
- scoped local fallback
- scope-aware tools
- bounded merged injection with project priority

This design gives the plugin the right balance:

- strong repo continuity
- durable personal preference memory
- low cross-project contamination
- safer and more predictable retrieval behavior
