import { createHash } from "node:crypto"
import type { MemoryScope, ScopeContext } from "./types.js"

export function createScopeContext(userId: string, projectGroupId: string): ScopeContext {
  return {
    userId,
    projectGroupId,
    // v1 is a version token — increment it to invalidate all existing global group IDs (breaking schema change only)
    globalGroupId: `oc_global_v1_${shortHash(userId)}`,
  }
}

export function groupIdForScope(context: ScopeContext, scope: MemoryScope): string {
  return scope === "global" ? context.globalGroupId : context.projectGroupId
}

export function localScopeKey(context: ScopeContext, scope: MemoryScope): string {
  return `${scope}:${groupIdForScope(context, scope)}`
}

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}
