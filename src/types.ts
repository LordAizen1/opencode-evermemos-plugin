// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

export interface PluginConfig {
  /** EverMemOS server base URL (e.g. "http://localhost:8000") */
  baseUrl: string
  /** Timeout in ms for recall (search) requests. Default: 300 */
  recallTimeoutMs: number
  /** Timeout in ms for write (memorize) requests. Default: 500 */
  writeTimeoutMs: number
  /** Max characters kept per tool output summary before truncation */
  toolOutputMaxChars: number
  /** Retrieval method passed to EverMemOS search. Default: "hybrid" */
  retrieveMethod: RetrieveMethod
  /** Number of memories to recall per query. Default: 5 */
  recallTopK: number
  /** Whether to fetch profile memories separately from search. Default: true */
  injectProfileRecall: boolean
  /** Maximum number of profile memories to inject. Default: 3 */
  profileRecallLimit: number
  /** Stable sender ID written into EverMemOS messages */
  senderId: string
}

export type RetrieveMethod =
  | "keyword"
  | "vector"
  | "hybrid"
  | "rrf"

// ---------------------------------------------------------------------------
// EverMemOS request / response payloads
// ---------------------------------------------------------------------------

/** POST /api/v1/memories — store a single message */
export interface MemorizeMessagePayload {
  message_id: string
  create_time: string            // ISO 8601
  sender: string                 // maps to user_id in EverMemOS
  sender_name?: string
  content: string
  group_id: string
  group_name?: string
  role: "user" | "assistant"
  refer_list?: string[]
}

/** GET /api/v1/memories/search query payload */
export interface SearchMemoriesPayload {
  query: string
  group_id: string
  retrieve_method: RetrieveMethod
  top_k: number
  memory_types?: string[]
  include_metadata?: boolean
}

/** Shape of a single memory returned by search (subset we care about) */
export interface RecalledMemory {
  memory_type: string
  summary?: string
  content?: string
  timestamp?: string
  user_id?: string
  group_id?: string
  atomic_fact?: string           // event_log type
}

/** Envelope returned by GET /api/v1/memories/search */
export interface SearchMemoriesResponse {
  status: string
  message: string
  result: {
    memories: Array<Record<string, RecalledMemory[]>>
    scores?: Array<Record<string, number[]>>
    total_count: number
    has_more: boolean
    pending_messages?: unknown[]
  }
}

/** Envelope returned by POST /api/v1/memories */
export interface MemorizeResponse {
  status: string
  message: string
  result: {
    saved_memories: unknown[]
    count: number
    status_info: "extracted" | "accumulated"
  }
}

/** DELETE /api/v1/memories */
export interface DeleteMemoriesPayload {
  event_id?: string
  user_id?: string
  group_id?: string
}

// ---------------------------------------------------------------------------
// Session cache
// ---------------------------------------------------------------------------

export interface SessionCacheEntry {
  /** Sanitized user message text cached from chat.message hook */
  userMessage: string
  /** Timestamp of last update */
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

export interface SanitizeOptions {
  /** Max characters to keep. Content beyond this is truncated. */
  maxLength?: number
  /** Whether to strip <private>…</private> blocks. Default: true */
  stripPrivateBlocks?: boolean
  /** Whether to redact common secret patterns. Default: true */
  redactSecrets?: boolean
}

