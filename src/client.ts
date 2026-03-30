import type {
  PluginConfig,
  MemorizeMessagePayload,
  MemorizeResponse,
  SearchMemoriesPayload,
  SearchMemoriesResponse,
  DeleteMemoriesPayload,
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
    return this.post<SearchMemoriesResponse>(
      "/api/v1/memories/search",
      payload,
      this.recallTimeoutMs,
    )
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
  async deleteMemories(payload: DeleteMemoriesPayload): Promise<unknown | null> {
    return this.request<unknown>(
      "/api/v1/memories",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.writeTimeoutMs),
      },
    )
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
