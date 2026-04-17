import { EverMemOSClient } from "./client.js"
import { countProjectSpacesWithMemory, hasLocalMemory, rememberLocal } from "./local-memory.js"
import { groupIdForScope, localScopeKey } from "./scope.js"
import type { PluginConfig, RoutedWrite, ScopeContext } from "./types.js"

export function maybePromoteProjectProfile(
  client: EverMemOSClient,
  config: PluginConfig,
  scopeContext: ScopeContext,
  content: string,
  role: "user" | "assistant",
  routed: RoutedWrite,
): boolean {
  if (!config.enableGlobalScope || !config.enablePreferencePromotion) return false
  if (routed.scope !== "project" || routed.memoryType !== "profile") return false
  if (countProjectSpacesWithMemory(content, "profile") < config.promotionMinProjects) return false

  const globalSpace = localScopeKey(scopeContext, "global")
  if (hasLocalMemory(globalSpace, content, "profile")) return false

  rememberLocal(globalSpace, content, role, "profile")
  client
    .memorize({
      message_id: `promoted-${Date.now()}`,
      create_time: new Date().toISOString(),
      sender: config.userId,
      content,
      group_id: groupIdForScope(scopeContext, "global"),
      role,
    })
    .catch(() => {
      /* fail open */
    })

  return true
}
