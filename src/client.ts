import type {
  PluginConfig,
  RecalledMemory,
  MemorizeMessagePayload,
  MemorizeResponse,
  SearchMemoriesPayload,
  SearchMemoriesResponse,
  ListMemoriesPayload,
  DeleteMemoriesPayload,
  DeleteMemoriesResult,
} from "./types.js"

/**
 * Typed HTTP wrapper around EverMemOS /api/v1/memories endpoints.
 * Every call is guarded by AbortSignal timeouts so that a slow or
 * offline EverMemOS instance never blocks the chat path.
 */
export class EverMemOSClient {
  private readonly baseUrl: string
  private readonly recallTimeoutMs: number
  private readonly writeTimeoutMs: number

  constructor(config: PluginConfig) {
    this.baseUrl = config.baseUrl
    this.recallTimeoutMs = config.recallTimeoutMs
    this.writeTimeoutMs = config.writeTimeoutMs
  }

  /** Search memories — used during recall before LLM prompt. */
  async search(payload: SearchMemoriesPayload): Promise<SearchMemoriesResponse | null> {
    const params = new URLSearchParams({
      query: payload.query,
      retrieve_method: payload.retrieve_method,
      top_k: String(payload.top_k),
    })
    if (payload.user_id) params.set("user_id", payload.user_id)
    if (payload.group_id) params.set("group_id", payload.group_id)
    if (payload.include_metadata !== undefined) {
      params.set("include_metadata", String(payload.include_metadata))
    }
    for (const t of payload.memory_types ?? []) {
      params.append("memory_types", t)
    }

    return this.request<SearchMemoriesResponse>(
      `/api/v1/memories/search?${params.toString()}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(this.recallTimeoutMs),
      },
    )
  }

  /** Fetch profile memories separately from search endpoint. */
  async listMemories(payload: ListMemoriesPayload): Promise<RecalledMemory[]> {
    const params = new URLSearchParams({
      memory_type: payload.memory_type,
      limit: String(payload.limit),
    })
    if (payload.user_id) params.set("user_id", payload.user_id)
    if (payload.group_id) params.set("group_id", payload.group_id)
    if (payload.offset !== undefined) params.set("offset", String(payload.offset))

    const response = await this.request<unknown>(`/api/v1/memories?${params.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(this.recallTimeoutMs),
    })
    return extractMemories(response)
  }

  async listProfileMemories(
    userId: string,
    groupId: string,
    limit: number,
  ): Promise<RecalledMemory[]> {
    return this.listMemories({
      user_id: userId,
      group_id: groupId,
      memory_type: "profile",
      limit,
    })
  }

  /** Store a single message as memory. */
  async memorize(payload: MemorizeMessagePayload): Promise<MemorizeResponse | null> {
    return this.post<MemorizeResponse>(
      "/api/v1/memories",
      payload,
      this.writeTimeoutMs,
    )
  }

  /** Soft-delete memories matching the given filters. */
  async deleteMemories(payload: DeleteMemoriesPayload): Promise<DeleteMemoriesResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/memories`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.writeTimeoutMs),
      })

      if (res.ok) {
        return { ok: true, message: "Delete request sent successfully." }
      }

      if (res.status === 404) {
        return { ok: true, notFound: true, message: "No memories matched the delete criteria." }
      }

      return { ok: false }
    } catch {
      // Timeout/network failure â€” fail open
      return null
    }
  }

  // -----------------------------------------------------------------------
  // internals
  // -----------------------------------------------------------------------

  private async post<T>(
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T | null> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  private async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, init)
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      // Timeout, network error, JSON parse failure — fail open
      return null
    }
  }
}

function extractMemories(value: unknown): RecalledMemory[] {
  const out: RecalledMemory[] = []

  const visit = (node: unknown): void => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node !== "object") return

    const obj = node as Record<string, unknown>
    const memoryType = typeof obj.memory_type === "string" ? obj.memory_type : undefined
    const content = typeof obj.content === "string" ? obj.content : undefined
    const summary = typeof obj.summary === "string" ? obj.summary : undefined
    const atomicFact = typeof obj.atomic_fact === "string" ? obj.atomic_fact : undefined

    if (memoryType && (content || summary || atomicFact)) {
      out.push({
        memory_type: memoryType,
        content,
        summary,
        atomic_fact: atomicFact,
        timestamp: typeof obj.timestamp === "string" ? obj.timestamp : undefined,
        user_id: typeof obj.user_id === "string" ? obj.user_id : undefined,
        group_id: typeof obj.group_id === "string" ? obj.group_id : undefined,
      })
    }

    for (const child of Object.values(obj)) {
      visit(child)
    }
  }

  visit(value)
  return out
}
