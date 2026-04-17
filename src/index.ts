import { tool, type Plugin } from "@opencode-ai/plugin"
import { writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { EverMemOSClient } from "./client.js"
import { classifyWrite } from "./classify.js"
import { loadConfig } from "./config.js"
import { computeGroupId } from "./git.js"
import { rememberLocal } from "./local-memory.js"
import {
  clipBlock,
  mergeRecallBlocks,
  buildToolSummary,
  shapeRecallQuery,
} from "./memory.js"
import {
  recallCompactionBlock,
  recallGlobalBlocks,
  recallProjectContext,
} from "./retrieval.js"
import { maybePromoteProjectProfile } from "./promotion.js"
import { createScopeContext, groupIdForScope, localScopeKey } from "./scope.js"
import { sanitize } from "./sanitize.js"
import {
  cacheUserMessage,
  getCachedUserMessage,
  pruneExpired,
} from "./session-cache.js"
import type { MemoryScope } from "./types.js"

const z = tool.schema

// Write to log file instead of stderr to avoid corrupting OpenCode's TUI.
const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin-debug.log")
function pluginLog(msg: string): void {
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* fail silent */ }
}

// Tools that must never be stored as memories — they'd pollute recall with meta-noise.
const SKIP_TOOLS = new Set(["evermemos_recall", "evermemos_remember", "evermemos_forget", "evermemos_backend_status"])

// Messages that look like plugin tool invocations shouldn't be stored either.
const PLUGIN_INVOCATION_RE = /\bevermemos_(recall|remember|forget)\b/i

/**
 * OpenCode EverMemOS Plugin
 *
 * Gives the OpenCode model durable, per-project memory powered by EverMemOS.
 *
 * Hook wiring:
 *  - chat.message -> cache sanitized user message; fire-and-forget store
 *  - experimental.chat.system.transform -> recall memories, inject into system prompt
 *  - experimental.session.compacting -> add compact recall context for compaction
 *  - tool.execute.after -> fire-and-forget store of tool summaries
 *  - event (session.idle) -> prune expired session cache entries
 */
const plugin: Plugin = async (input) => {
  const config = loadConfig()
  const client = new EverMemOSClient(config)
  const projectGroupId = await computeGroupId(
    input.$ as any, // BunShell tagged-template callable
    input.directory,
  )
  const scopeContext = createScopeContext(config.userId, projectGroupId)

  // ------------------------------------------------------------------
  // Pre-flight setup: Gracefully halt the plugin if systems are down
  // ------------------------------------------------------------------
  const opencodePort = input.serverUrl?.port || process.env.OPENCODE_PORT || 3000
  const opencodePassword = input.serverUrl?.password || process.env.OPENCODE_SERVER_PASSWORD
  const opencodeUrl = input.serverUrl ? `http://${input.serverUrl.hostname}:${opencodePort}` : `http://127.0.0.1:${opencodePort}`
  
  const hdrs: Record<string, string> = {}
  if (opencodePassword) {
    hdrs["Authorization"] = "Basic " + Buffer.from(`opencode:${opencodePassword}`).toString('base64')
  }

  // --- Auto-Setup / Auto-Discovery of EverMemOS .env ---
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    // We are inside opencode-evermemos-plugin/dist or opencode-evermemos-plugin/src
    // so ../../EverMemOS-main resolves to the right place relative to the plugin itself.
    const memDir = resolve(__dirname, "../../EverMemOS-main")
    const envDest = join(memDir, ".env")
    
    pluginLog(`[DEBUG] Auto-setup initiated.`)
    pluginLog(`[EverMemOS Plugin DEBUG] PORT=${opencodePort}, hasPassword=${!!opencodePassword}`)
    pluginLog(`[EverMemOS Plugin DEBUG] memDir resolved to: ${memDir}`)
    pluginLog(`[EverMemOS Plugin DEBUG] envDest resolved to: ${envDest}`)
    pluginLog(`[EverMemOS Plugin DEBUG] existsSync(memDir): ${existsSync(memDir)}`)
    pluginLog(`[EverMemOS Plugin DEBUG] existsSync(envDest): ${existsSync(envDest)}`)

    if (existsSync(memDir) && !existsSync(envDest)) {
      pluginLog("[EverMemOS Plugin] Auto-configuring EverMemOS .env via OpenCode Provider...")
      let template = ""
      const templatePath = join(memDir, "env.template")
      if (existsSync(templatePath)) {
        template = readFileSync(templatePath, "utf8")
        pluginLog(`[EverMemOS Plugin DEBUG] Read env.template successfully.`)
      } else {
        pluginLog(`[EverMemOS Plugin DEBUG] Warning: env.template NOT FOUND at ${templatePath}`)
      }
      
      pluginLog(`[EverMemOS Plugin DEBUG] Fetching models from ${opencodeUrl}/internal/inference/models`)
      const modRes = await fetch(`${opencodeUrl}/internal/inference/models`, { headers: hdrs }).catch((err) => {
        pluginLog(`[EverMemOS Plugin DEBUG] Fetch error: ${err.message}`)
        return null
      })
      
      if (modRes && modRes.ok) {
        pluginLog(`[EverMemOS Plugin DEBUG] Model API hit successfully.`)
        const data = await modRes.json() as any
        const providerStr = data.providers?.length > 0 ? "opencode" : "openai"
        const defaultModelStr = data.defaultModel || "gpt-4o"
        // In OpenCode, model format is usually provider:model (e.g. openai:gpt-4o)
        // We will just replace the exact lines in the template
        
        const envContent = template
          .replace(/^LLM_PROVIDER=.*/m, `LLM_PROVIDER=${providerStr}`)
          .replace(/^LLM_MODEL=.*/m, `LLM_MODEL=${defaultModelStr}`)
          .replace(/^LLM_BASE_URL=.*/m, `LLM_BASE_URL=${opencodeUrl}/internal/inference`)
          // Switch Vectorization to Google Gemini natively
          .replace(/^VECTORIZE_PROVIDER=.*/m, `VECTORIZE_PROVIDER=openai`) // Gemini exposes an OpenAI-compatible endpoint
          .replace(/^VECTORIZE_BASE_URL=.*/m, `VECTORIZE_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`)
          .replace(/^VECTORIZE_MODEL=.*/m, `VECTORIZE_MODEL=gemini-embedding-2-preview`)
          .replace(/^LLM_API_KEY=.*/m, `LLM_API_KEY=${opencodePassword || 'EMPTY'}`)
          .replace(/^VECTORIZE_API_KEY=.*/m, `VECTORIZE_API_KEY=YOUR_GEMINI_API_KEY`)

        writeFileSync(envDest, envContent)
        pluginLog("[EverMemOS Plugin] ✅ Auto-configured .env!")
      } else {
        pluginLog(`[EverMemOS Plugin DEBUG] Failed to fetch models. Status: ${modRes?.status}`)
      }
    } else {
       pluginLog(`[EverMemOS Plugin DEBUG] Skipping creation. Either memDir does not exist, or .env already exists.`)
    }
  } catch(e: any) {
    pluginLog(`ERROR: Auto-setup failed: ${e.message}`)
  }

  let isHealthy = false
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2500)

    const [memHealth, infHealth] = await Promise.all([
      fetch(`${config.baseUrl}/health`, { signal: controller.signal }).catch(() => null),
      fetch(`${opencodeUrl}/internal/inference/health`, { headers: hdrs, signal: controller.signal }).catch(() => null)
    ])
    clearTimeout(timeout)

    if (memHealth?.ok) {
      isHealthy = true
      if (!infHealth?.ok) {
        pluginLog(`[WARN] OpenCode internal inference API unavailable — auto-setup disabled, memory hooks active.`)
      }
    } else {
      pluginLog(`[FAIL] EverMemOS backend at ${config.baseUrl} is unreachable. Memory features disabled for this session.`)
    }
  } catch (e: any) {
    pluginLog(`[FAIL] Startup diagnostics failed: ${e.message}`)
  }

  const evermemos_backend_status = tool({
    description: "Check the status of EverMemOS and the OpenCode inference endpoints.",
    args: {},
    execute: async () => {
      const results = {
        evermemos_backend: "unknown",
        opencode_inference: "unknown",
        opencode_models: "unknown"
      }
      
      try {
        const memRes = await fetch(`${config.baseUrl}/health`)
        results.evermemos_backend = memRes.ok ? "healthy" : `error: ${memRes.status}`
      } catch (e: any) {
        results.evermemos_backend = `unreachable: ${e.message}`
      }

      try {
        const infRes = await fetch(`${opencodeUrl}/internal/inference/health`, { headers: hdrs })
        results.opencode_inference = infRes.ok ? "healthy" : `error: ${infRes.status}`
      } catch (e: any) {
        results.opencode_inference = `unreachable: ${e.message}`
      }

      try {
        const modRes = await fetch(`${opencodeUrl}/internal/inference/models`, { headers: hdrs })
        if (modRes.ok) {
          const data = await modRes.json() as any
          results.opencode_models = `Default Chat: ${data.defaultModel}, Configured Providers: ${data.providers?.length || 0}`
        } else {
          results.opencode_models = `error: ${modRes.status}`
        }
      } catch (e: any) {
         results.opencode_models = `unreachable: ${e.message}`
      }

      return JSON.stringify(results, null, 2)
    }
  })

  // If the checks fail, we ONLY expose the diagnostic tool. 
  // No hooks, no recall, no remember - we halt gracefully internally.
  if (!isHealthy) {
    return {
      tool: {
        evermemos_backend_status
      }
    } as any
  }

  return {
    tool: {
      evermemos_backend_status,
      evermemos_recall: tool({
        description:
          "Recall relevant memories from EverMemOS for project, global, or both scopes.",
        args: {
          query: z.string().min(1).describe("What to recall"),
          top_k: z.number().int().positive().max(20).optional(),
          scope: z.enum(["project", "global", "both"]).optional(),
        },
        execute: async (args) => {
          const query = shapeRecallQuery(
            sanitize(args.query, { maxLength: 1024 }),
          )
          if (!query) return "No query provided after sanitization."
          const topK = args.top_k ?? config.recallTopK
          const scope = args.scope ?? "both"
          const blocks: string[] = []
          let projectHits = [] as Awaited<ReturnType<typeof recallProjectContext>>["allHits"]

          if (scope === "project" || scope === "both") {
            const projectContext = await recallProjectContext(client, config, scopeContext, query, topK)
            projectHits = projectContext.allHits
            blocks.push(...projectContext.blocks)
          }
          if (scope === "global" || scope === "both") {
            const globalBlock = await recallGlobalBlocks(client, config, scopeContext, query, topK, projectHits)
            if (globalBlock) blocks.push(globalBlock)
          }

          const block = mergeRecallBlocks(...blocks)
          if (!block) return "No matching memories found."
          return clipBlock(block, config.maxInjectedChars)
        },
      }),

      evermemos_remember: tool({
        description:
          "Store a durable memory entry in EverMemOS for project or global scope.",
        args: {
          content: z.string().min(1).describe("Memory content to store"),
          role: z.enum(["user", "assistant"]).optional(),
          scope: z.enum(["auto", "project", "global"]).optional(),
        },
        execute: async (args) => {
          const content = sanitize(args.content, { maxLength: config.toolOutputMaxChars })
          if (!content) return "Nothing to store after sanitization."
          const role = args.role ?? "user"
          const routed = classifyWrite(content, {
            requestedScope: args.scope,
            enableGlobalScope: config.enableGlobalScope,
            source: "manual",
          })
          rememberLocal(localScopeKey(scopeContext, routed.scope), content, role, routed.memoryType)

          const result = await client.memorize({
            message_id: `manual-${Date.now()}`,
            create_time: new Date().toISOString(),
            sender: config.userId,
            content,
            group_id: groupIdForScope(scopeContext, routed.scope),
            role,
          })

          if (!result) return "Failed to store memory (EverMemOS unavailable or timed out)."
          const promoted = maybePromoteProjectProfile(
            client,
            config,
            scopeContext,
            content,
            role,
            routed,
          )
          return promoted
            ? `Memory stored in ${routed.scope} scope as ${routed.memoryType}, and promoted to global profile. ${routed.reason}`
            : `Memory stored in ${routed.scope} scope as ${routed.memoryType}. ${routed.reason}`
        },
      }),

      evermemos_forget: tool({
        description:
          "Delete memories in EverMemOS by event_id or by scoped filters.",
        args: {
          event_id: z.string().optional(),
          user_id: z.string().optional(),
          scope: z.enum(["project", "global"]).optional(),
          mine_only: z.boolean().optional(),
          current_project_only: z.boolean().optional(),
        },
        execute: async (args) => {
          const resolvedScope: MemoryScope | undefined =
            args.scope ?? (args.current_project_only ? "project" : undefined)
          const mineOnly = args.mine_only !== false
          const payload = {
            event_id: args.event_id,
            user_id: args.user_id ?? (mineOnly ? scopeContext.userId : undefined),
            group_id: resolvedScope ? groupIdForScope(scopeContext, resolvedScope) : undefined,
          }

          if (!payload.event_id && !payload.user_id && !payload.group_id) {
            return "Refusing broad delete: provide event_id or an explicit scoped filter."
          }

          const result = await client.deleteMemories(payload)
          if (!result) return "Failed to delete memories (EverMemOS unavailable or timed out)."
          if (result.ok && result.notFound) return "No memories matched the delete criteria (already clean)."
          if (!result.ok) return "Failed to delete memories."
          return "Delete request sent successfully."
        },
      }),
    },

    // ------------------------------------------------------------------
    // chat.message - cache the user message for recall; store it async
    // ------------------------------------------------------------------
    "chat.message": async (_hookInput, output) => {
      const text = extractUserText(output)
      if (!text) return

      const sessionId = _hookInput.sessionID
      const sanitized = sanitize(text)
      cacheUserMessage(sessionId, shapeRecallQuery(sanitized) || sanitized)

      // Skip storing plugin tool invocations — they create meta-noise in recall
      if (PLUGIN_INVOCATION_RE.test(sanitized)) return
      const routed = classifyWrite(sanitized, {
        requestedScope: "auto",
        enableGlobalScope: config.enableGlobalScope,
        source: "chat",
      })
      rememberLocal(localScopeKey(scopeContext, routed.scope), sanitized, "user", routed.memoryType)
      maybePromoteProjectProfile(client, config, scopeContext, sanitized, "user", routed)

      // Fire-and-forget: store user message in EverMemOS
      client
        .memorize({
          message_id: `${sessionId}-${Date.now()}`,
          create_time: new Date().toISOString(),
          sender: config.userId,
          content: sanitized,
          group_id: groupIdForScope(scopeContext, routed.scope),
          role: "user",
        })
        .catch(() => {
          /* fail open - never crash the chat */
        })
    },

    // ------------------------------------------------------------------
    // experimental.chat.system.transform - recall and inject memories
    // ------------------------------------------------------------------
    "experimental.chat.system.transform": async (hookInput, output) => {
      const sessionId = hookInput.sessionID
      if (!sessionId) return

      const query = shapeRecallQuery(getCachedUserMessage(sessionId)) || "project context preferences stack technology"
      const projectContext = await recallProjectContext(client, config, scopeContext, query, config.recallTopK)
      const globalBlock = await recallGlobalBlocks(
        client,
        config,
        scopeContext,
        query,
        config.recallTopK,
        projectContext.allHits,
      )
      const projectBlocks = projectContext.blocks
      const merged = mergeRecallBlocks(...projectBlocks, globalBlock)

      if (merged) output.system.push(clipBlock(merged, config.maxInjectedChars))
    },

    // ------------------------------------------------------------------
    // experimental.session.compacting - add concise recall context
    // ------------------------------------------------------------------
    "experimental.session.compacting": async (hookInput, output) => {
      const query = shapeRecallQuery(getCachedUserMessage(hookInput.sessionID))
      if (!query) return

      const compactBlock = await recallCompactionBlock(client, config, scopeContext, query)
      if (compactBlock) {
        output.context.push(compactBlock)
      }
    },

    // ------------------------------------------------------------------
    // tool.execute.after - store a summary of tool results as memory
    // ------------------------------------------------------------------
    "tool.execute.after": async (hookInput, output) => {
      // Never store the plugin's own tool calls — primary source of meta-noise
      if (SKIP_TOOLS.has(hookInput.tool)) return

      const summary = buildToolSummary(
        hookInput.tool,
        hookInput.args,
        output.title,
        output.output,
        config.toolOutputMaxChars,
      )
      const sanitized = sanitize(summary, { maxLength: config.toolOutputMaxChars })
      const routed = classifyWrite(sanitized, {
        requestedScope: "project",
        enableGlobalScope: config.enableGlobalScope,
        source: "tool",
      })
      rememberLocal(localScopeKey(scopeContext, routed.scope), sanitized, "assistant", routed.memoryType)

      client
        .memorize({
          message_id: `tool-${hookInput.callID}`,
          create_time: new Date().toISOString(),
          sender: config.userId,
          content: sanitized,
          group_id: groupIdForScope(scopeContext, routed.scope),
          role: "assistant",
        })
        .catch(() => {
          /* fail open */
        })
    },

    // ------------------------------------------------------------------
    // event - listen for session.idle to prune cache
    // ------------------------------------------------------------------
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        pruneExpired()
      }
    },
  }
}

export default plugin

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function extractUserText(
  output: { message: { content: string } | unknown; parts: unknown[] },
): string {
  // UserMessage has a `content` field with the raw user text
  const msg = output.message as Record<string, unknown> | undefined
  if (msg && typeof msg.content === "string") {
    return msg.content
  }
  // Fallback: concatenate text parts
  if (Array.isArray(output.parts)) {
    return output.parts
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
  }
  return ""
}
