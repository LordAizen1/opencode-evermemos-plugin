import { existsSync, readFileSync } from "node:fs"
import { homedir, userInfo } from "node:os"
import { join } from "node:path"
import type { PluginConfig } from "./types.js"

type RawConfig = Partial<Record<keyof PluginConfig, unknown>>

const DEFAULTS: PluginConfig = {
  baseUrl: "http://localhost:1995",
  userId: defaultUserId(),
  recallTimeoutMs: 300,
  writeTimeoutMs: 500,
  toolOutputMaxChars: 2048,
  maxInjectedChars: 3500,
  retrieveMethod: "hybrid",
  recallTopK: 5,
  injectProfileRecall: true,
  profileRecallLimit: 3,
  globalProfileRecallLimit: 4,
  enableGlobalScope: true,
  enablePreferencePromotion: true,
  promotionMinProjects: 2,
  senderId: defaultUserId(),
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "opencode", "evermemos.jsonc")

/**
 * Build a validated PluginConfig from defaults + optional JSONC file + env.
 * Precedence: env > file > defaults.
 */
export function loadConfig(): PluginConfig {
  const env = process.env
  const filePath = env.EVERMEMOS_CONFIG_PATH || DEFAULT_CONFIG_PATH
  const fileConfig = readJsoncConfig(filePath)

  return {
    baseUrl: normalizeBaseUrl(asString(env.EVERMEMOS_BASE_URL) ?? asString(fileConfig.baseUrl) ?? DEFAULTS.baseUrl),
    userId:
      asString(env.EVERMEMOS_USER_ID)
      ?? asString(env.EVERMEMOS_SENDER_ID)
      ?? asString(fileConfig.userId)
      ?? asString(fileConfig.senderId)
      ?? DEFAULTS.userId,
    recallTimeoutMs:
      positiveInt(env.EVERMEMOS_RECALL_TIMEOUT_MS)
      ?? asPositiveInt(fileConfig.recallTimeoutMs)
      ?? DEFAULTS.recallTimeoutMs,
    writeTimeoutMs:
      positiveInt(env.EVERMEMOS_WRITE_TIMEOUT_MS)
      ?? asPositiveInt(fileConfig.writeTimeoutMs)
      ?? DEFAULTS.writeTimeoutMs,
    toolOutputMaxChars:
      positiveInt(env.EVERMEMOS_TOOL_OUTPUT_MAX_CHARS)
      ?? asPositiveInt(fileConfig.toolOutputMaxChars)
      ?? DEFAULTS.toolOutputMaxChars,
    maxInjectedChars:
      positiveInt(env.EVERMEMOS_MAX_INJECTED_CHARS)
      ?? asPositiveInt(fileConfig.maxInjectedChars)
      ?? DEFAULTS.maxInjectedChars,
    retrieveMethod:
      validMethod(env.EVERMEMOS_RETRIEVE_METHOD)
      ?? asRetrieveMethod(fileConfig.retrieveMethod)
      ?? DEFAULTS.retrieveMethod,
    recallTopK:
      positiveInt(env.EVERMEMOS_RECALL_TOP_K)
      ?? asPositiveInt(fileConfig.recallTopK)
      ?? DEFAULTS.recallTopK,
    injectProfileRecall:
      parseBoolean(env.EVERMEMOS_INJECT_PROFILE_RECALL)
      ?? asBoolean(fileConfig.injectProfileRecall)
      ?? DEFAULTS.injectProfileRecall,
    profileRecallLimit:
      positiveInt(env.EVERMEMOS_PROFILE_RECALL_LIMIT)
      ?? asPositiveInt(fileConfig.profileRecallLimit)
      ?? DEFAULTS.profileRecallLimit,
    globalProfileRecallLimit:
      positiveInt(env.EVERMEMOS_GLOBAL_PROFILE_RECALL_LIMIT)
      ?? asPositiveInt(fileConfig.globalProfileRecallLimit)
      ?? DEFAULTS.globalProfileRecallLimit,
    enableGlobalScope:
      parseBoolean(env.EVERMEMOS_ENABLE_GLOBAL_SCOPE)
      ?? asBoolean(fileConfig.enableGlobalScope)
      ?? DEFAULTS.enableGlobalScope,
    enablePreferencePromotion:
      parseBoolean(env.EVERMEMOS_ENABLE_PREFERENCE_PROMOTION)
      ?? asBoolean(fileConfig.enablePreferencePromotion)
      ?? DEFAULTS.enablePreferencePromotion,
    promotionMinProjects:
      positiveInt(env.EVERMEMOS_PROMOTION_MIN_PROJECTS)
      ?? asPositiveInt(fileConfig.promotionMinProjects)
      ?? DEFAULTS.promotionMinProjects,
    senderId:
      asString(env.EVERMEMOS_USER_ID)
      ?? asString(env.EVERMEMOS_SENDER_ID)
      ?? asString(fileConfig.userId)
      ?? asString(fileConfig.senderId)
      ?? DEFAULTS.senderId,
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readJsoncConfig(path: string): RawConfig {
  try {
    if (!existsSync(path)) return {}
    const raw = readFileSync(path, "utf8")
    const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(raw)))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as RawConfig
  } catch {
    return {}
  }
}

function stripJsonComments(input: string): string {
  let out = ""
  let i = 0
  let inString = false
  let escaped = false

  while (i < input.length) {
    const ch = input[i]
    const next = input[i + 1]

    if (inString) {
      out += ch
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }

    if (ch === "/" && next === "/") {
      i += 2
      while (i < input.length && input[i] !== "\n") i++
      continue
    }

    if (ch === "/" && next === "*") {
      i += 2
      while (i < input.length - 1 && !(input[i] === "*" && input[i + 1] === "/")) i++
      i += 2
      continue
    }

    out += ch
    i++
  }

  return out
}

function stripTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, "$1")
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) return DEFAULTS.baseUrl
  try {
    // Validate URL shape, then keep normalized text without trailing slash.
    const url = new URL(trimmed)
    return url.toString().replace(/\/+$/, "")
  } catch {
    return DEFAULTS.baseUrl
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
  }
  if (typeof value === "string") return positiveInt(value)
  return undefined
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return parseBoolean(value)
  return undefined
}

function asRetrieveMethod(value: unknown): PluginConfig["retrieveMethod"] | undefined {
  return typeof value === "string" ? validMethod(value) : undefined
}

function positiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined
  const normalized = raw.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return undefined
}

const VALID_METHODS = new Set(["keyword", "vector", "hybrid", "rrf"])

function validMethod(raw: string | undefined): PluginConfig["retrieveMethod"] | undefined {
  if (raw && VALID_METHODS.has(raw)) return raw as PluginConfig["retrieveMethod"]
  return undefined
}

function defaultUserId(): string {
  try {
    const info = userInfo()
    return info.username?.trim() || "opencode-user"
  } catch {
    return "opencode-user"
  }
}
