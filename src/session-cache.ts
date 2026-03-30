import type { SessionCacheEntry } from "./types.js"

/**
 * Lightweight in-memory cache keyed by sessionID.
 *
 * Used to carry the sanitized user message from `chat.message`
 * into `experimental.chat.system.transform` (which doesn't receive it).
 *
 * Entries auto-expire after TTL_MS to prevent unbounded growth in
 * long-running OpenCode sessions.
 */
const TTL_MS = 10 * 60 * 1000 // 10 minutes

const store = new Map<string, SessionCacheEntry>()

export function cacheUserMessage(sessionId: string, message: string): void {
  store.set(sessionId, { userMessage: message, updatedAt: Date.now() })
}

export function getCachedUserMessage(sessionId: string): string | undefined {
  const entry = store.get(sessionId)
  if (!entry) return undefined
  if (Date.now() - entry.updatedAt > TTL_MS) {
    store.delete(sessionId)
    return undefined
  }
  return entry.userMessage
}

/** Evict expired entries. Call periodically from session.idle. */
export function pruneExpired(): void {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now - entry.updatedAt > TTL_MS) {
      store.delete(key)
    }
  }
}
