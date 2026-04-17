# Changelog

## 0.2.0

### Breaking changes

- `evermemos_forget` signature changed: added `scope` (`"project" | "global"`) and `mine_only` (`boolean`) parameters. Callers passing positional arguments must update to named args.

### New features

- **Dual-scope memory** — project scope (repo-specific facts) and global scope (cross-repo user preferences) via `ScopeContext` with `userId`, `projectGroupId`, and `globalGroupId`.
- `globalGroupId` is derived as `oc_global_v1_${sha256(userId).slice(0, 16)}` — stable per-user, not per-repo.
- `evermemos_recall` and `evermemos_remember` now accept a `scope` parameter (`"project"`, `"global"`, `"both"`).
- Automatic write classifier routes messages to project or global scope based on keyword heuristics with documented precedence (project cues checked before global).
- Preference promotion: repeated project profile memories auto-promote to global scope once seen in N repos.
- Ranked injection order in system prompt: project profile → episodic → foresight → global profile.
- Local fallback store upgraded to v2 with `project:` / `global:` space keys; v1 stores are migrated automatically on first load.

### Bug fixes

- Fixed health check endpoint: was checking `/v1/health` (non-existent); corrected to `/health`.
- Health gate changed from fail-closed to fail-open: OpenCode inference API being unavailable now logs a warning but does not disable memory hooks.
- `evermemos doctor` now checks the correct EverMemOS port (1995) and endpoint (`/health`).
- Removed dead `formatRecalledMemories` export from `memory.ts`.
- Removed emojis from `cli.ts` output (terminal compatibility).

## 0.1.1

Initial release with single-scope project memory.
