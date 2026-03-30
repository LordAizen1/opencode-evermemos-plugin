import type { PluginConfig } from "./types.js"

const DEFAULTS: PluginConfig = {
  baseUrl: "http://localhost:8000",
  recallTimeoutMs: 300,
  writeTimeoutMs: 500,
  toolOutputMaxChars: 2048,
  retrieveMethod: "hybrid",
  recallTopK: 5,
  senderId: "opencode-user",
}

/**
 * Build a validated PluginConfig from environment variables.
 * Every value has a safe default so the plugin always starts.
 */
export function loadConfig(): PluginConfig {
  const env = process.env

  return {
    baseUrl:
      env.EVERMEMOS_BASE_URL?.replace(/\/+$/, "") ?? DEFAULTS.baseUrl,
    recallTimeoutMs:
      positiveInt(env.EVERMEMOS_RECALL_TIMEOUT_MS) ?? DEFAULTS.recallTimeoutMs,
    writeTimeoutMs:
      positiveInt(env.EVERMEMOS_WRITE_TIMEOUT_MS) ?? DEFAULTS.writeTimeoutMs,
    toolOutputMaxChars:
      positiveInt(env.EVERMEMOS_TOOL_OUTPUT_MAX_CHARS) ?? DEFAULTS.toolOutputMaxChars,
    retrieveMethod:
      validMethod(env.EVERMEMOS_RETRIEVE_METHOD) ?? DEFAULTS.retrieveMethod,
    recallTopK:
      positiveInt(env.EVERMEMOS_RECALL_TOP_K) ?? DEFAULTS.recallTopK,
    senderId:
      env.EVERMEMOS_SENDER_ID ?? DEFAULTS.senderId,
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function positiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const VALID_METHODS = new Set(["keyword", "vector", "hybrid", "rrf"])

function validMethod(raw: string | undefined): PluginConfig["retrieveMethod"] | undefined {
  if (raw && VALID_METHODS.has(raw)) return raw as PluginConfig["retrieveMethod"]
  return undefined
}
