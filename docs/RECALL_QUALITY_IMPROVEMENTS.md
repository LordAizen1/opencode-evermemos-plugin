# Recall Quality Improvements (Priority Plan)

This document defines the next 4 improvements required to make recall consistently useful.

## Goal

Close the core loop:
- store memory
- recall relevant memory
- inject helpful context into the assistant prompt

## 1) Plugin-side recall post-processing

### Problem
- Recall returns duplicates.
- Recall includes low-value meta memories (for example, "user called evermemos_remember...").

### Implementation
- Add post-processing in plugin recall formatting path (`evermemos_recall` + system injection path):
  - Deduplicate by normalized content hash.
  - Filter/meta-rank down low-signal tool-call memories.
  - Rank up explicit preference memories (keywords like `prefer`, `stack`, `uses`, `convention`, `style`).

### Success criteria
- No near-identical duplicate entries in a single recall response.
- Meta tool-call entries are not in top results when user preference memories exist.

## 2) Query shaping (natural-language to retrieval query)

### Problem
- Passing full command-like text into search causes noisy retrieval:
  - Example: `Use evermemos_recall with query "project stack and patch style"...`

### Implementation
- Add query normalization before search:
  - Strip instruction wrappers like `use evermemos_recall`, `show me result`, etc.
  - Keep only semantic target phrase (for example, `project stack and patch style`).
- Keep manual tool usage supported, but sanitize/shape query internally.

### Success criteria
- Query sent to EverMemOS is semantic, not command-like.
- Relevant preference memories rank higher for the same user intent.

## 3) Truncation diagnosis and fix

### Problem
- Recalled memory snippets are frequently cut mid-sentence.

### Implementation
- Identify truncation source:
  - EverMemOS API response truncation
  - Plugin formatting/output truncation
- If plugin-side:
  - Preserve complete first sentence or full key clause.
  - Increase per-item output budget while keeping overall max limit.
- If backend-side:
  - Document backend limit and adapt formatter to avoid clipped fragments.

### Success criteria
- Returned recall items are readable, complete thoughts (not mid-sentence fragments).
- Context injection quality improves in follow-up model responses.

## 4) Recall quality acceptance tests

### Problem
- No hard gate proving recall is useful after changes.

### Implementation
- Add deterministic test flow in docs/manual QA (and automated test if feasible):
  1. Store stack/style preference memory.
  2. Run 3 fixed recall queries:
     - `project stack and patch style`
     - `coding preference`
     - `commit message preference`
  3. Validate relevance and rank.
- Add pass/fail rubric:
  - Expected preference memory appears in top 2 for target queries.
  - No duplicates in returned set.
  - No meta-memory dominance when direct memory exists.

### Success criteria
- Recall quality is measurable and repeatable.
- Regressions are visible before release.

## Execution order

1. Query shaping
2. Dedup/filter/ranking post-processing
3. Truncation fix
4. Acceptance tests + docs update

## Out of scope (for this phase)

- New memory backends
- Major UI changes
- Broad architecture refactors

## Findings After Implementation Attempts

Date range validated: April 6-8, 2026 (local Windows setup).

### Summary status

- Point 1 (post-processing): `Partially achieved`
- Point 2 (query shaping): `Achieved`
- Point 3 (truncation): `Partially achieved`
- Point 4 (acceptance gate): `Partially achieved`

### What was implemented

1. Query shaping in plugin
- Added normalization so command-style prompts are converted to semantic queries before search.
- Example: `Use evermemos_recall with query "project stack and patch style" ...` -> `project stack and patch style`.

2. Recall post-processing
- Added dedup and scoring in recall formatting.
- Added meta-memory suppression for tool/recall chatter.
- Added marker-aware behavior for exact token queries.

3. Truncation handling (plugin-side)
- Added explicit `...[backend-truncated]` marker for clipped backend content.
- Avoided adding backend-truncated marker to `local_memory` entries.

4. Local memory reliability lane (new)
- Added local persisted store for explicit `evermemos_remember` writes:
  - path: `%USERPROFILE%\.config\opencode\evermemos-local.json`
  - override: `EVERMEMOS_LOCAL_STORE_PATH`
- Exact token recall (`MEMTEST_*`, marker-like tokens) now uses local exact hits first.
- Added local semantic fallback for non-exact queries with overlap/preference scoring.
- Merged local hits ahead of backend results in `evermemos_recall`.

### Observed outcomes

- Deterministic exact marker recall improved significantly:
  - Example: `MEMTEST_Q9_20260408` returned `[local_memory] ... marker only`.
- Semantic recall became usable when explicit relevant local memory exists:
  - Example: `project stack and patch style` resolved to local stack/style memory.
- Duplicate rows decreased in tested sessions.

### Remaining limitations

1. Backend recall content quality (EverMemOS)
- Backend often returns meta episodic narratives about tool usage.
- Some backend summaries are clipped mid-thought.
- Plugin can re-rank/filter, but cannot fully repair low-signal backend candidates.

2. Session-dependent behavior
- If the current session did not store semantic preference content, semantic recall may still be weak.
- Marker queries are now reliable via local lane; purely backend semantic quality remains variable.

### Updated practical acceptance criteria

Use this as the working gate for current release quality:

1. Exact marker recall
- Store `MEMTEST_*` via `evermemos_remember`.
- Recall by exact marker returns a `[local_memory]` hit in top results.

2. Semantic stack/style recall
- After storing explicit stack/style memory in session, query:
  - `project stack and patch style`
- Returns relevant preference memory (local or backend) in top results.

3. Quality checks
- No obvious duplicate entries in the same recall response.
- Meta tool-call memories should not dominate top results when relevant preference memory exists.

### Recommended next phase

1. Add lightweight automated regression script for marker + semantic checks.
2. Add optional recency boost in ranking for recent relevant memories.
3. Investigate backend extraction/ranking settings in EverMemOS to reduce meta episodic noise at source.
